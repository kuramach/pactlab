import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { RINSED_FIXTURE_MANIFEST, RINSED_FIXTURE_ROOM, type FixtureRoom } from '@pactlab/connectors';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { zipSync } from 'fflate';
import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { RINSE_MANIFEST_FILE } from '@pactlab/contracts';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';

const SECRET = 'test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: (OutboundEmail & { code: string })[] = [];
  async send(message: OutboundEmail) {
    this.sent.push({ ...message, code: /\b(\d{6})\b/.exec(message.text)?.[1] ?? '' });
  }
}

/**
 * Pactlab Rinse preparers end to end (T-178b, ADR 0059): the pact's own side sends a prep invite; the
 * preparer signs in from it in the desktop (a new account or an existing one) and is bound to that pact
 * only; AI rinse jobs run under the binding and are recorded on the pact; a revoked binding stops them;
 * a set bound to another pact, or by a binding no longer live, is refused at import.
 */
describe('rinse preparers (T-178b)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const org = { id: newId(), lead: newId(), seller: newId(), colleague: newId() };
  let dealId = '';
  let otherDealId = '';
  const tokens: Record<string, string> = {};
  const transport = new ScriptedModelTransport(() =>
    JSON.stringify({ category: 'MULTIFAMILY_RENT_ROLL', confidence: 0.95, reason: 'headers: Unit, Tenant, Rent', alternatives: [], entity: null, counterparty: null, question: null }),
  );

  async function call(method: 'GET' | 'POST', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  async function nextCode(before: number): Promise<string> {
    for (let i = 0; i < 100 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = mail.sent.at(-1)?.code;
    if (!code || mail.sent.length === before) throw new Error('No code sent');
    return code;
  }
  async function signIn(email: string): Promise<string> {
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    const verified = await call('POST', '/v1/auth/email/verify', { email, code: await nextCode(before) });
    expect(verified.status).toBe(200);
    return verified.body['token'] as string;
  }
  async function invite(email: string): Promise<string> {
    const created = await call('POST', `/v1/deals/${dealId}/rinse/prep-invites`, { email }, tokens['lead']);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return new URL(created.body['link'] as string).searchParams.get('invite') ?? '';
  }
  async function prepare(token: string, email: string, displayName: string) {
    const before = mail.sent.length;
    expect(await call('POST', '/v1/rinse/sign-in/start', { token, email, displayName })).toEqual({ status: 202, body: { sent: true } });
    return call('POST', '/v1/rinse/sign-in/verify', { token, email, code: await nextCode(before), device: 'Pactlab Rinse on macOS' });
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Rinse Buyers (synthetic)', $2, 'EMAIL_CODE', now())`, [org.id, `rinse-buyers-${org.id.slice(-8)}`]);
    for (const [id, email, role] of [[org.lead, 'lead@rinse-buyers.example', 'ORG_ADMIN'], [org.seller, 'seller@harbour.example', 'MEMBER'], [org.colleague, 'colleague@rinse-buyers.example', 'MEMBER']] as const) {
      await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [id, `pactlab|${id}`, `${email} (synthetic)`, email]);
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), org.id, id, role]);
    }
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: 'https://pactlab-test.example/', audience: 'https://api.pactlab.test', keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() }) },
      rinse: { siteOrigin: 'https://pactlab.test', limits: { perTenMinutes: 3, perDay: 100 } },
    });
    tokens['lead'] = await signIn('lead@rinse-buyers.example');
    const pact = (name: string) =>
      call('POST', '/v1/pacts', { name, baseCurrency: 'USD', buyer: { name: 'Rinse Buyers', ownership: 'PRIVATE' }, seller: { name: 'Harbour Lane Apartments LLC (synthetic)', ownership: 'PRIVATE', companyType: 'MULTIFAMILY' } }, tokens['lead']);
    const first = await pact('Project Harbour Lane');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    dealId = first.body['id'] as string;
    otherDealId = (await pact('Project Other')).body['id'] as string;
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')`, [newId(), org.id, dealId, org.seller]);
    tokens['seller'] = await signIn('seller@harbour.example');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  let bindingId = '';

  it('the pact’s own side invites a preparer; the seller cannot, and sees no invites', async () => {
    expect((await call('POST', `/v1/deals/${dealId}/rinse/prep-invites`, { email: 'x@harbour.example' }, tokens['seller'])).status).toBe(403);
    expect((await call('GET', `/v1/deals/${dealId}/rinse/prep-invites`, undefined, tokens['seller'])).status).toBe(403);
    const before = mail.sent.length;
    const token = await invite('dana@harbour.example');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)?.text).toContain(`https://pactlab.test/rinse?invite=${token}`);
    const listed = await call('GET', `/v1/deals/${dealId}/rinse/prep-invites?limit=10`, undefined, tokens['lead']);
    expect(listed.body).toMatchObject({ total: 1, items: [{ email: 'dana@harbour.example', state: 'PENDING', binding: null }] });
    // The token itself is never readable again.
    expect(JSON.stringify(listed.body)).not.toContain(token);

    const preview = await call('POST', '/v1/rinse/invites/preview', { token });
    expect(preview.body).toMatchObject({ pactName: 'Project Harbour Lane', invitedBy: 'Rinse Buyers (synthetic)', state: 'PENDING' });

    const signedIn = await prepare(token, 'dana@harbour.example', 'Dana Whitlow');
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    const bindings = signedIn.body['bindings'] as { bindingId: string; dealId: string }[];
    expect(bindings).toEqual([expect.objectContaining({ dealId, pactName: 'Project Harbour Lane' })]);
    bindingId = bindings[0]?.bindingId ?? '';
    tokens['preparer'] = signedIn.body['token'] as string;
    expect((await call('GET', `/v1/deals/${dealId}/rinse/prep-invites`, undefined, tokens['lead'])).body).toMatchObject({ items: [{ state: 'ACCEPTED', binding: { id: bindingId, revokedAt: null } }] });
  });

  it('a binding gives no access to the pact, and the workspace holds no pacts', async () => {
    expect((await call('GET', '/v1/rinse/me', undefined, tokens['preparer'])).body).toEqual({ bindings: [expect.objectContaining({ bindingId, dealId })] });
    expect((await call('GET', `/v1/deals/${dealId}`, undefined, tokens['preparer'])).status).toBe(404);
    expect((await call('GET', `/v1/deals/${dealId}/documents`, undefined, tokens['preparer'])).status).toBe(404);
    const created = await call('POST', '/v1/pacts', { name: 'Mine', baseCurrency: 'USD', buyer: { name: 'B', ownership: 'PRIVATE' }, seller: { name: 'S', ownership: 'PRIVATE', companyType: 'MULTIFAMILY' } }, tokens['preparer']);
    expect(created.status).toBeGreaterThanOrEqual(400);
  });

  it('an existing account signs in with its usual code and is bound too', async () => {
    const token = await invite('colleague@rinse-buyers.example');
    const signedIn = await prepare(token, 'colleague@rinse-buyers.example', 'Colleague');
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(signedIn.body['bindings']).toEqual([expect.objectContaining({ dealId })]);
    // A wrong code is a uniform 401.
    expect((await call('POST', '/v1/rinse/sign-in/verify', { token, email: 'colleague@rinse-buyers.example', code: '000000' })).status).toBe(401);
  });

  it('AI rinse jobs run under the binding, counted against the pact, and are rate-limited per account', async () => {
    const classify = (binding: string) => call('POST', '/v1/rinse/ai/classify', { bindingId: binding, pack: 'MULTIFAMILY', fileName: 'Rent roll Sept 2026.csv', pageTexts: ['Unit,Tenant,Rent\n101,Vacant,0'] }, tokens['preparer']);
    const first = await classify(bindingId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ category: 'MULTIFAMILY_RENT_ROLL', aiExcluded: false });
    expect((await classify(newId())).status).toBe(404);
    const runs = await db.owner.query<{ deal_id: string; prompt_id: string }>(`SELECT deal_id::text, prompt_id FROM ai_runs WHERE requested_by = (SELECT id FROM users WHERE email = 'dana@harbour.example')`);
    expect(runs.rows).toEqual([{ deal_id: dealId, prompt_id: 'document.classify' }]);
    await classify(bindingId);
    await classify(bindingId);
    expect(await classify(bindingId)).toMatchObject({ status: 429, body: { code: 'RINSE_AI_RATE_LIMITED' } });
    // Without a session, nothing.
    expect((await call('POST', '/v1/rinse/ai/classify', { bindingId, pack: 'MULTIFAMILY', fileName: 'x', pageTexts: ['y'] })).status).toBe(401);
  });

  it('an import refuses a set bound to another pact, or by a binding that is no longer live', async () => {
    const zipOf = (intendedPact: unknown) => {
      const manifest = { ...RINSED_FIXTURE_MANIFEST, set: { ...RINSED_FIXTURE_MANIFEST.set, intendedPact } };
      const room = structuredClone(RINSED_FIXTURE_ROOM) as FixtureRoom;
      const files = room.files.map((file) => (file.name === RINSE_MANIFEST_FILE && !file.folder ? { ...file, text: JSON.stringify(manifest) } : file));
      return Buffer.from(zipSync(Object.fromEntries(files.map((file) => [`${file.folder ? `${file.folder}/` : ''}${file.name}`, new TextEncoder().encode(file.text)])))).toString('base64');
    };
    const elsewhere = await call('POST', `/v1/deals/${dealId}/rinse-archives`, { fileName: 'set.zip', contentBase64: zipOf({ organizationId: org.id, dealId: otherDealId, bindingId }) }, tokens['lead']);
    expect(elsewhere).toMatchObject({ status: 422, body: { code: 'RINSE_MANIFEST_OTHER_PACT' } });
    const forged = await call('POST', `/v1/deals/${dealId}/rinse-archives`, { fileName: 'set.zip', contentBase64: zipOf({ organizationId: org.id, dealId, bindingId: newId() }) }, tokens['lead']);
    expect(forged).toMatchObject({ status: 422, body: { code: 'RINSE_PREPARER_NOT_BOUND' } });

    // The pact's own side ends the binding: AI jobs stop, and the preparer's sets are refused.
    const invites = (await call('GET', `/v1/deals/${dealId}/rinse/prep-invites`, undefined, tokens['lead'])).body['items'] as { id: string; binding: { id: string } | null }[];
    const dana = invites.find((item) => item.binding?.id === bindingId);
    const revoked = await call('POST', `/v1/deals/${dealId}/rinse/prep-invites/${dana?.id}/revoke`, undefined, tokens['lead']);
    expect(revoked.body).toMatchObject({ binding: { id: bindingId, revokedAt: expect.any(String) } });
    expect((await call('GET', '/v1/rinse/me', undefined, tokens['preparer'])).body).toEqual({ bindings: [] });
    const refused = await call('POST', `/v1/deals/${dealId}/rinse-archives`, { fileName: 'set.zip', contentBase64: zipOf({ organizationId: org.id, dealId, bindingId }) }, tokens['lead']);
    expect(refused).toMatchObject({ status: 422, body: { code: 'RINSE_PREPARER_NOT_BOUND' } });
  });
});
