import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { seedSynthetic } from '@pactlab/db/seed';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { demoModelResponse, seedDemo } from '../demo-seed/seed';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { FixtureClientMetadataFetcher } from './client-metadata';
import { normalizeUserCode } from './oauth.service';

const SECRET = 'api-access-test-secret-'.padEnd(48, 'x');
const ISSUER = 'https://app.pactlab.test';
const MCP = 'https://app.pactlab.test/v1/mcp';
const API = 'https://app.pactlab.test/v1';
const CHARLIE = '01900000-0000-7000-8000-00000000c001';
const TROUBLED = '01900000-0000-7000-8c00-0000000d0002';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const DEVICE = 'urn:ietf:params:oauth:grant-type:device_code';

type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-128: the REST API as a second OAuth resource, per person; scripts sign in with the device flow. */
describe('API access with Pactlab OAuth', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();

  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Body | string, bearer?: string, contentType?: string) {
    const response = await app.inject({
      method,
      url,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(contentType ? { 'content-type': contentType } : {}) },
      ...(payload !== undefined ? { payload } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const form = (url: string, fields: Record<string, string>) => call('POST', url, new URLSearchParams(fields).toString(), undefined, 'application/x-www-form-urlencoded');

  const sessions = new Map<string, string>();
  async function signIn(email: string): Promise<string> {
    const known = sessions.get(email);
    if (known) return known;
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    const token = (await call('POST', '/v1/auth/email/verify', { email, code })).body['token'] as string;
    sessions.set(email, token);
    return token;
  }

  async function addPerson(email: string, role: 'MEMBER' | 'ORG_ADMIN'): Promise<void> {
    const user = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [user, `pactlab|${user}`, `${email} (synthetic)`, email]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), CHARLIE, user, role]);
  }

  /** The whole device flow: the script asks, the person approves in the app, the script gets tokens. */
  async function deviceSignIn(session: string, scope?: string, clientId = 'nightly-export') {
    const started = await form('/v1/oauth/device_authorization', { client_id: clientId, ...(scope ? { scope } : {}) });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const { device_code: deviceCode, user_code: userCode } = started.body as { device_code: string; user_code: string };
    expect((await call('POST', '/v1/oauth/device/decide', { userCode, approve: true }, session)).status).toBe(200);
    const tokens = await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: clientId });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    return tokens.body as { access_token: string; refresh_token: string; scope: string };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    await seedSynthetic(db.owner, db.prisma);
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    const store = new InMemoryObjectStore();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
      documents: {
        objectStore: store,
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
      },
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      foresightAutoBaseline: false,
      mcp: { issuer: ISSUER, resource: MCP, clientMetadata: new FixtureClientMetadataFetcher({}) },
    });
    await seedDemo(app, db.prisma);
    await db.owner.query(`INSERT INTO organization_flags (organization_id, mcp_enabled) VALUES ($1, true) ON CONFLICT (organization_id) DO UPDATE SET mcp_enabled = true`, [CHARLIE]);
    await addPerson('analyst@charlie.example', 'MEMBER');
    await app.listen({ port: 0, host: '127.0.0.1' });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('user codes: typed in any case, with or without the dash; vowels and wrong lengths refused', () => {
    expect(normalizeUserCode('bcdf ghjk')).toBe('BCDF-GHJK');
    expect(normalizeUserCode('BCDF-GHJ')).toBeNull();
    expect(normalizeUserCode('ABCD-EFGH')).toBeNull();
  });

  it('device flow: pending until the person approves, then a read token that lists their pacts', async () => {
    const session = await signIn('analyst@charlie.example');
    const started = await form('/v1/oauth/device_authorization', { client_id: 'nightly-export', client_name: 'Nightly export' });
    expect(started.body).toMatchObject({ verification_uri: `${ISSUER}/device`, expires_in: 600, interval: 5 });
    const { device_code: deviceCode, user_code: userCode } = started.body as { device_code: string; user_code: string };
    expect((await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: 'nightly-export' })).body).toMatchObject({ error: 'authorization_pending' });
    // Polling faster than the interval is told to slow down.
    expect((await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: 'nightly-export' })).body).toMatchObject({ error: 'slow_down' });

    const check = await call('POST', '/v1/oauth/device/check', { userCode: userCode.toLowerCase().replace('-', ' ') }, session);
    expect(check.body).toMatchObject({ kind: 'consent', userCode, client: { name: 'Nightly export', verified: false }, scopes: [{ scope: 'api:read' }] });
    expect((await call('POST', '/v1/oauth/device/decide', { userCode, approve: true }, session)).body).toEqual({ outcome: 'approved' });

    const tokens = await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: 'nightly-export' });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    expect(tokens.body).toMatchObject({ token_type: 'Bearer', scope: 'api:read' });
    // The device code works once.
    expect((await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: 'nightly-export' })).body).toMatchObject({ error: 'invalid_grant' });

    const access = tokens.body['access_token'] as string;
    const deals = await call('GET', '/v1/deals', undefined, access);
    expect(deals.status).toBe(200);
    expect(Array.isArray(deals.body['items'])).toBe(true);
    // Their grant shows in Settings → Connected apps.
    const apps = await call('GET', '/v1/me/connected-apps', undefined, session);
    expect((apps.body['apps'] as { clientName: string; scopes: string[] }[]).some((app) => app.clientName === 'Nightly export' && app.scopes.includes('api:read'))).toBe(true);
  });

  it('declined codes and unknown clients are refused', async () => {
    const session = await signIn('analyst@charlie.example');
    const started = await form('/v1/oauth/device_authorization', { client_id: 'declined-script' });
    const { device_code: deviceCode, user_code: userCode } = started.body as { device_code: string; user_code: string };
    expect((await call('POST', '/v1/oauth/device/decide', { userCode, approve: false }, session)).body).toEqual({ outcome: 'declined' });
    expect((await form('/v1/oauth/token', { grant_type: DEVICE, device_code: deviceCode, client_id: 'declined-script' })).body).toMatchObject({ error: 'access_denied' });
    expect((await form('/v1/oauth/device_authorization', { client_id: 'Not A Name!' })).body).toMatchObject({ error: 'invalid_client' });
    expect((await form('/v1/oauth/device_authorization', { client_id: 'my-script', scope: 'mcp:read' })).body).toMatchObject({ error: 'invalid_scope' });
    expect((await call('POST', '/v1/oauth/device/check', { userCode: 'BCDF-GHJK' }, session)).body).toMatchObject({ kind: 'error' });
  });

  it('scopes by method: api:read cannot write; api:write can create a draft finding as the person', async () => {
    const session = await signIn('lead@charlie.example');
    const reader = await deviceSignIn(session, undefined, 'reader-script');
    const finding = { domain: 'FINANCIAL', title: 'Synthetic API finding', description: 'Created through the API (synthetic).', severity: 'LOW', confidence: 'HIGH' };
    const refused = await call('POST', `/v1/deals/${TROUBLED}/findings`, finding, reader.access_token);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });

    const writer = await deviceSignIn(session, 'api:write', 'writer-script');
    expect(writer.scope.split(' ').sort()).toEqual(['api:read', 'api:write']);
    const created = await call('POST', `/v1/deals/${TROUBLED}/findings`, finding, writer.access_token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // As the person: their own audit trail, a draft, nothing approved.
    expect(created.body).toMatchObject({ status: 'DRAFT' });
  });

  it('allowlist: routes not open to the API refuse API tokens; tokens never cross resources', async () => {
    const session = await signIn('lead@charlie.example');
    const tokens = await deviceSignIn(session, 'api:write', 'allowlist-script');
    for (const [method, url] of [
      ['GET', '/v1/me/connected-apps'],
      ['GET', '/v1/organization/api-access'],
      ['GET', '/v1/admin/usage'],
      ['GET', `/v1/deals/${TROUBLED}/members`],
    ] as const) {
      const response = await call(method, url, undefined, tokens.access_token);
      expect(response.status, url).toBe(403);
      expect(response.body, url).toMatchObject({ code: 'NOT_AVAILABLE_TO_API' });
    }
    // An API token is not an MCP token.
    expect((await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokens.access_token, 'application/json')).status).toBe(401);
    // An MCP token is not an API token.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const clientId = (await call('POST', '/v1/oauth/register', { client_name: 'Synthetic client', redirect_uris: [REDIRECT] })).body['client_id'] as string;
    const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', resource: MCP };
    const redirect = new URL((await call('POST', '/v1/oauth/authorize', { params, approve: true }, session)).body['redirectTo'] as string);
    const mcpTokens = await form('/v1/oauth/token', { grant_type: 'authorization_code', code: redirect.searchParams.get('code') ?? '', client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect((await call('GET', '/v1/deals', undefined, mcpTokens.body['access_token'] as string)).status).toBe(401);
  });

  it('apps use the code flow with resource=/v1; refresh rotates and keeps the API audience', async () => {
    const session = await signIn('lead@charlie.example');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const clientId = (await call('POST', '/v1/oauth/register', { client_name: 'Synthetic dashboard', redirect_uris: [REDIRECT] })).body['client_id'] as string;
    const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', resource: API, scope: 'api:read' };
    expect((await call('POST', '/v1/oauth/authorize/check', { params }, session)).body).toMatchObject({ kind: 'consent', resource: 'api' });
    const redirect = new URL((await call('POST', '/v1/oauth/authorize', { params, approve: true }, session)).body['redirectTo'] as string);
    const tokens = await form('/v1/oauth/token', { grant_type: 'authorization_code', code: redirect.searchParams.get('code') ?? '', client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: API });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    const refreshed = await form('/v1/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.body['refresh_token'] as string, client_id: clientId });
    expect(refreshed.status).toBe(200);
    expect((await call('GET', '/v1/deals', undefined, refreshed.body['access_token'] as string)).status).toBe(200);
    // Replaying the used refresh token revokes the grant.
    await form('/v1/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.body['refresh_token'] as string, client_id: clientId });
    expect((await call('GET', '/v1/deals', undefined, refreshed.body['access_token'] as string)).status).toBe(401);
  });

  it('another organization’s token sees none of this one', async () => {
    const other = newId();
    const user = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Elsewhere (synthetic)', $2, 'EMAIL_CODE', now())`, [other, `elsewhere-${other.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Elsewhere lead (synthetic)', 'lead@elsewhere-api.example')`, [user, `pactlab|${user}`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER')`, [newId(), other, user]);
    const tokens = await deviceSignIn(await signIn('lead@elsewhere-api.example'), undefined, 'elsewhere-script');
    const deals = await call('GET', '/v1/deals', undefined, tokens.access_token);
    expect(deals.body['items']).toEqual([]);
    expect([403, 404]).toContain((await call('GET', `/v1/deals/${TROUBLED}`, undefined, tokens.access_token)).status);
  });

  it('admins: switch API access off (403 at once), list members’ grants, revoke one (401); members cannot', async () => {
    const admin = await signIn('lead@charlie.example');
    const member = await signIn('analyst@charlie.example');
    const tokens = await deviceSignIn(member, undefined, 'revoked-script');
    expect((await call('GET', '/v1/organization/api-access', undefined, member)).status).toBe(403);
    expect((await call('PUT', '/v1/organization/api-access', { enabled: false }, member)).status).toBe(403);

    const listed = await call('GET', '/v1/organization/api-access?limit=100', undefined, admin);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body['enabled']).toBe(true);
    const grants = (listed.body['grants'] as { items: { id: string; clientName: string; personEmail: string }[] }).items;
    const grant = grants.find((entry) => entry.clientName === 'revoked-script');
    expect(grant?.personEmail).toBe('analyst@charlie.example');

    expect((await call('PUT', '/v1/organization/api-access', { enabled: false }, admin)).status).toBe(200);
    const off = await call('GET', '/v1/deals', undefined, tokens.access_token);
    expect(off.status).toBe(403);
    expect(off.body).toMatchObject({ code: 'API_DISABLED' });
    expect((await form('/v1/oauth/device_authorization', { client_id: 'while-off' })).status).toBe(200);
    expect((await call('PUT', '/v1/organization/api-access', { enabled: true }, admin)).status).toBe(200);
    expect((await call('GET', '/v1/deals', undefined, tokens.access_token)).status).toBe(200);

    expect((await call('DELETE', `/v1/organization/api-access/grants/${grant?.id}`, undefined, admin)).status).toBe(200);
    expect((await call('GET', '/v1/deals', undefined, tokens.access_token)).status).toBe(401);
    const audited = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE organization_id = $1 AND action IN ('oauth.api_disabled', 'oauth.api_enabled', 'oauth.grant_revoked')`, [CHARLIE]);
    expect(new Set(audited.rows.map((row) => row.action))).toEqual(new Set(['oauth.api_disabled', 'oauth.api_enabled', 'oauth.grant_revoked']));
  });
});
