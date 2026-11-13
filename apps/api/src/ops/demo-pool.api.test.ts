import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { FixturePropertyProvider } from '@pactlab/connectors';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { demoModelResponse } from '../demo-seed/seed';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { generatedDemoData } from './demo-data.testing';
import { pactName } from './demo-org';
import { DEMO_POOL_SIZE, demoPoolSpec, sweepDemoPool } from './demo-pool';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'demo-pool-test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-113 acceptance: five demo slots, lent through links, closed to outward actions, rebuilt when the share ends. */
describe('shareable demo pool', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operatorTenant: SyntheticTenant;
  let key: CryptoKey;
  let operator: string;
  const mail = new CapturingEmailSender();
  const demoData = generatedDemoData();
  const types = ['SOFTWARE_SAAS'] as const;
  const sweep = () => sweepDemoPool(app as never, db.owner as never, db.prisma, { types, data: demoData.source });
  const rows = async <T = Body>(sql: string, params: unknown[] = []) => ((await db.owner.query(sql, params)) as { rows: T[] }).rows;

  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, bearer: string | null, payload?: Body) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const openLink = async (url: string) => call('POST', '/v1/auth/demo-link', null, { token: new URL(url).pathname.split('/').pop() ?? '' });

  beforeAll(async () => {
    db = await startTestDatabase();
    operatorTenant = await createSyntheticTenant(db.owner, 'Operators');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operatorTenant.userId]);
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    const store = new InMemoryObjectStore();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
      documents: {
        objectStore: store,
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
      },
      property: new FixturePropertyProvider(),
      signing: { fixture: false, docusign: null },
    });
    operator = await new SignJWT({ org_id: operatorTenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(operatorTenant.subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(key);
    const first = await sweep();
    expect(first.filter((line) => line.includes('FAILED'))).toEqual([]);
  }, 900_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    rmSync(demoData.dir, { recursive: true, force: true });
  });

  it('builds five slots from the demo data, all available', async () => {
    const pool = (await call('GET', '/v1/admin/demos', operator)).body['items'] as { slot: number; status: string; share: unknown }[];
    expect(pool.map((slot) => [slot.slot, slot.status, slot.share])).toEqual(Array.from({ length: DEMO_POOL_SIZE }, (_, index) => [index + 1, 'AVAILABLE', null]));
    for (let slot = 1; slot <= DEMO_POOL_SIZE; slot += 1) {
      const deals = await rows(`SELECT name FROM deals WHERE organization_id = $1 AND status <> 'DELETED'`, [demoPoolSpec(slot).id]);
      expect(deals.map((deal) => deal['name']).sort(), `slot ${slot}`).toEqual([pactName('SOFTWARE_SAAS', true), pactName('SOFTWARE_SAAS')].sort());
    }
  });

  it('only operators manage the pool', async () => {
    const member = await createSyntheticTenant(db.owner, 'Not operators');
    const token = await new SignJWT({ org_id: member.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(member.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
    expect((await call('GET', '/v1/admin/demos', token)).status).toBe(403);
    expect((await call('POST', '/v1/admin/demos', token, { sharedWith: 'Sneaky', hours: 24 })).status).toBe(403);
  });

  it('a share gives buyer and seller links that sign in with no code, inside that slot only', async () => {
    const shared = await call('POST', '/v1/admin/demos', operator, { sharedWith: 'Acme Capital (synthetic)', hours: 72, recipientEmail: 'jane@acme.example', recipientName: 'Jane', note: 'As promised.' });
    expect(shared.status).toBe(201);
    // Pactlab emails both links with how to start; the same message comes back to paste.
    expect(shared.body['emailed']).toBe('SENT');
    const sent = mail.sent.at(-1)!;
    expect(sent.to).toBe('jane@acme.example');
    expect(sent.text).toContain((shared.body as { buyerUrl: string }).buyerUrl);
    expect(sent.text).toContain((shared.body as { sellerUrl: string }).sellerUrl);
    expect((shared.body['inviteText'] as { body: string }).body).toBe(sent.text);
    mail.sent.length = 0;
    const { buyerUrl, sellerUrl, slot } = shared.body as { buyerUrl: string; sellerUrl: string; slot: number };
    expect(buyerUrl).toMatch(/\/demo\/[A-Za-z0-9_-]{43}$/);
    expect(slot).toBe(1);
    const buyer = await openLink(buyerUrl);
    expect(buyer.status).toBe(200);
    const buyerToken = buyer.body['token'] as string;
    const deals = (await call('GET', '/v1/deals', buyerToken)).body['items'] as { name: string }[];
    expect(deals.map((deal) => deal.name)).toContain(pactName('SOFTWARE_SAAS'));
    const seller = await openLink(sellerUrl);
    expect(seller.status).toBe(200);
    expect(mail.sent).toHaveLength(0);
    // Nothing of slot 2 is visible.
    const other = (await rows<{ id: string }>(`SELECT id FROM deals WHERE organization_id = $1 LIMIT 1`, [demoPoolSpec(2).id]))[0]!;
    expect((await call('GET', `/v1/deals/${other.id}`, buyerToken)).status).toBe(404);
    expect((await call('POST', '/v1/auth/demo-link', null, { token: 'x'.repeat(43) })).status).toBe(401);
  });

  it('refuses outward actions in a shared demo, and allows the rest', async () => {
    const pool = (await call('GET', '/v1/admin/demos', operator)).body['items'] as { slot: number; share: { id: string } | null }[];
    expect(pool[0]?.share).not.toBeNull();
    const shared = await call('POST', '/v1/admin/demos', operator, { sharedWith: 'Birch Partners (synthetic)', hours: 24 });
    const token = (await openLink((shared.body as { buyerUrl: string }).buyerUrl)).body['token'] as string;
    const deal = (await rows<{ id: string }>(`SELECT id FROM deals WHERE organization_id = $1 AND name = $2`, [demoPoolSpec(2).id, pactName('SOFTWARE_SAAS')]))[0]!;
    const invite = await call('POST', `/v1/deals/${deal.id}/invitations`, token, { email: 'someone@example.test', side: 'BUYER', role: 'ANALYST' });
    expect(invite).toMatchObject({ status: 422, body: { code: 'DEMO_NOT_AVAILABLE' } });
    expect((await call('DELETE', `/v1/deals/${deal.id}`, token, { confirmName: pactName('SOFTWARE_SAAS') })).body['code']).toBe('DEMO_NOT_AVAILABLE');
    expect((await call('POST', '/v1/billing/checkout', token, { plan: 'PACT' })).body['code']).toBe('DEMO_NOT_AVAILABLE');
    // Inside the pact, anything goes: it resets.
    const claim = await call('POST', `/v1/deals/${deal.id}/claims`, token, { statement: 'A visitor’s own claim (synthetic).', source: null });
    expect(claim.status, JSON.stringify(claim.body)).toBe(201);
  });

  it('ending a share closes its links and sessions; the next sweep rebuilds the slot and frees it', { timeout: 600_000 }, async () => {
    const pool = (await call('GET', '/v1/admin/demos', operator)).body['items'] as { slot: number; share: { id: string } | null; organizationId: string }[];
    const slot2 = pool.find((slot) => slot.slot === 2)!;
    const visitor = await rows<{ id: string }>(`SELECT id FROM deal_claims WHERE organization_id = $1 AND statement LIKE 'A visitor%'`, [slot2.organizationId]);
    expect(visitor).toHaveLength(1);
    expect((await call('POST', `/v1/admin/demos/shares/${slot2.share!.id}/end`, operator)).status).toBe(200);
    const sessions = await rows(`SELECT 1 FROM auth_sessions WHERE demo_share_id = $1 AND revoked_at IS NULL`, [slot2.share!.id]);
    expect(sessions).toHaveLength(0);
    const report = await sweep();
    expect(report).toContain('slot 2: rebuilt and available');
    expect(await rows(`SELECT id FROM deal_claims WHERE organization_id = $1 AND statement LIKE 'A visitor%' AND deal_id IN (SELECT id FROM deals WHERE status <> 'DELETED')`, [slot2.organizationId])).toHaveLength(0);
    expect((await call('GET', '/v1/admin/demos', operator)).body['items']).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 2, status: 'AVAILABLE', share: null })]));
  });

  it('a share whose time is up ends on the next sweep, and the pool fills up', { timeout: 600_000 }, async () => {
    await db.owner.query(`UPDATE demo_shares SET ends_at = now() - interval '1 minute' WHERE ended_at IS NULL`);
    const report = await sweep();
    expect(report).toContain('share for Acme Capital (synthetic): ended (time up)');
    expect(report).toContain('slot 1: rebuilt and available');
    for (let index = 0; index < DEMO_POOL_SIZE; index += 1) expect((await call('POST', '/v1/admin/demos', operator, { sharedWith: `Prospect ${index} (synthetic)`, hours: 24 })).status).toBe(201);
    expect(await call('POST', '/v1/admin/demos', operator, { sharedWith: 'One too many', hours: 24 })).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
    const audit = await rows<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE action LIKE 'demo.%' OR action = 'login.demo_link' ORDER BY action`);
    expect(audit.map((row) => row.action)).toEqual(['demo.ended', 'demo.expired', 'demo.shared', 'login.demo_link']);
  });
});
