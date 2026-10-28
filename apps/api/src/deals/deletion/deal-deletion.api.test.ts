import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { JwtIdentityVerifier } from '../../auth/identity';
import { InMemoryObjectStore } from '../../documents/testing';
import { SignatureMalwareScanner } from '../../documents/upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

describe('deleting a deal', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const store = new InMemoryObjectStore();
  const tokens: Record<string, string> = {};
  let dealName = '';

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: 'GET' | 'POST' | 'DELETE', path: string, payload?: Body) {
    const response = await app.inject({ method, url: path, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  }
  const upload = (fileName: string, retentionClass = 'DEAL_TERM') =>
    call('lead', 'POST', `/v1/deals/${a.dealId}/documents`, { fileName, contentType: 'text/plain', contentBase64: Buffer.from(`${fileName} (synthetic)`).toString('base64'), retentionClass });

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    const analyst = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    tokens['analyst'] = await token(analyst.subject, a.auth0OrganizationId);
    dealName = ((await call('lead', 'GET', `/v1/deals/${a.dealId}`)).body['name'] as string) ?? '';
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('only the deal lead can delete, and only by typing the deal name', async () => {
    // My deals tells each person their role, so only the lead is offered Delete.
    const roleOf = async (who: string) => ((await call(who, 'GET', '/v1/deals')).body as unknown as { items?: { id: string; myRole: string }[] } & { id?: string }[]);
    const leadList = await roleOf('lead');
    const analystList = await roleOf('analyst');
    const find = (list: unknown) => (Array.isArray(list) ? list : ((list as { items?: unknown[] }).items ?? [])).find((deal) => (deal as { id: string }).id === a.dealId) as { myRole: string } | undefined;
    expect(find(leadList)?.myRole).toBe('DEAL_LEAD');
    expect(find(analystList)?.myRole).toBe('ANALYST');
    await upload('Teaser.txt');
    await upload('Litigation file.txt', 'LEGAL_HOLD');
    expect((await call('analyst', 'DELETE', `/v1/deals/${a.dealId}`, { confirmName: dealName })).status).toBe(403);
    expect((await call('lead', 'DELETE', `/v1/deals/${a.dealId}`, { confirmName: 'Some other deal' })).status).toBe(422);
    expect((await call('lead', 'GET', `/v1/deals/${a.dealId}`)).status).toBe(200);
  });

  it('purges stored files except legal hold, and the deal disappears for everyone', async () => {
    expect(store.objects.size).toBe(2);
    const deleted = await call('lead', 'DELETE', `/v1/deals/${a.dealId}`, { confirmName: dealName });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ status: 'DELETED', filesPurged: 1, keptOnLegalHold: 1 });
    expect(store.objects.size).toBe(1);

    for (const who of ['lead', 'analyst']) {
      const listed = await call(who, 'GET', '/v1/deals');
      expect(JSON.stringify(listed.body)).not.toContain(a.dealId);
      expect([403, 404]).toContain((await call(who, 'GET', `/v1/deals/${a.dealId}`)).status);
    }
  });

  it('keeps the record: audited, every membership revoked, and it cannot be restored', async () => {
    const row = (await db.owner.query(`SELECT status, deleted_at IS NOT NULL AS deleted, deleted_by FROM deals WHERE id = $1`, [a.dealId])) as { rows: { status: string; deleted: boolean; deleted_by: string }[] };
    expect(row.rows[0]).toMatchObject({ status: 'DELETED', deleted: true, deleted_by: a.userId });
    const members = (await db.owner.query(`SELECT DISTINCT status::text FROM deal_memberships WHERE deal_id = $1`, [a.dealId])) as { rows: { status: string }[] };
    expect(members.rows).toEqual([{ status: 'REVOKED' }]);
    const audit = (await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'deal.deleted' AND outcome = 'SUCCEEDED'`, [a.dealId])) as { rows: { n: number }[] };
    expect(audit.rows[0]?.n).toBe(1);
    const pages = (await db.owner.query(`SELECT count(*)::int AS n FROM document_pages p JOIN documents d ON d.id = p.document_id WHERE d.deal_id = $1 AND d.status = 'PURGED' AND p.text IS NOT NULL`, [a.dealId])) as { rows: { n: number }[] };
    expect(pages.rows[0]?.n).toBe(0);
    await expect(db.owner.query(`UPDATE deals SET status = 'ACTIVE', deleted_at = NULL WHERE id = $1`, [a.dealId])).rejects.toThrow(/cannot be restored/);
  });
});
