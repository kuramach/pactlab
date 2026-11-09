import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
import { FixtureClientMetadataFetcher } from '../oauth/client-metadata';

const SECRET = 'mcp-test-secret-'.padEnd(48, 'x');
const ISSUER = 'https://app.pactlab.test';
const RESOURCE = 'https://app.pactlab.test/v1/mcp';
const CHARLIE = '01900000-0000-7000-8000-00000000c001';
const TROUBLED = '01900000-0000-7000-8c00-0000000d0002';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const CIMD = 'https://claude.example/oauth/client.json';

type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-084: Pactlab's OAuth for MCP and the read-only MCP tools, end to end over HTTP with the real MCP SDK client. */
describe('MCP server with Pactlab OAuth', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let base = '';
  const mail = new CapturingEmailSender();
  const clients: Client[] = [];

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Body | string, bearer?: string, contentType?: string) {
    const response = await app.inject({
      method,
      url,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(contentType ? { 'content-type': contentType } : {}) },
      ...(payload !== undefined ? { payload } : {}),
    });
    return { status: response.statusCode, headers: response.headers, body: (response.body ? response.json() : null) as Body };
  }
  const form = (fields: Record<string, string>) => call('POST', '/v1/oauth/token', new URLSearchParams(fields).toString(), undefined, 'application/x-www-form-urlencoded');

  // Sign-in codes are rate-limited per person (5 in 15 minutes): one session each, reused.
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

  function pkce() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  }

  /** The browser half: the consent page approves; returns the code from the redirect. */
  async function authorize(session: string, clientId: string, challenge: string, extra: Record<string, string> = {}) {
    const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE, state: 'xyz', ...extra };
    const check = await call('POST', '/v1/oauth/authorize/check', { params }, session);
    const decided = await call('POST', '/v1/oauth/authorize', { params, approve: true }, session);
    const redirect = typeof decided.body['redirectTo'] === 'string' ? new URL(decided.body['redirectTo'] as string) : null;
    return { check: check.body, redirect, code: redirect?.searchParams.get('code') ?? '' };
  }

  async function connect(clientId: string, session: string, scope?: string) {
    const { verifier, challenge } = pkce();
    const { code } = await authorize(session, clientId, challenge, scope ? { scope } : {});
    const tokens = await form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: RESOURCE });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    return tokens.body as { access_token: string; refresh_token: string; scope: string };
  }

  async function mcp(accessToken: string): Promise<Client> {
    const client = new Client({ name: 'pactlab-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/v1/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    clients.push(client);
    return client;
  }
  const json = (result: unknown) => JSON.parse((((result as { content?: { text: string }[] }).content ?? [])[0]?.text) ?? 'null') as Body;

  async function registerClient(): Promise<string> {
    const registered = await call('POST', '/v1/oauth/register', { client_name: 'Synthetic desktop client', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    return registered.body['client_id'] as string;
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
      mcp: {
        issuer: ISSUER,
        resource: RESOURCE,
        clientMetadata: new FixtureClientMetadataFetcher({ [CIMD]: { client_id: CIMD, client_name: 'Claude (synthetic)', redirect_uris: [REDIRECT] } }),
      },
    });
    await seedDemo(app, db.prisma);
    await db.owner.query(`INSERT INTO organization_flags (organization_id, mcp_enabled) VALUES ($1, true) ON CONFLICT (organization_id) DO UPDATE SET mcp_enabled = true`, [CHARLIE]);
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 240_000);

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined);
    await app?.close();
    await db?.stop();
  });

  it('an unauthenticated MCP request points the client at the protected-resource metadata', async () => {
    const response = await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer resource_metadata="https://app.pactlab.test/.well-known/oauth-protected-resource/v1/mcp", scope="mcp:read"');
    // A Pactlab session token is not an MCP token.
    const session = await signIn('lead@charlie.example');
    expect((await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, session)).status).toBe(401);
  });

  it('a registered client: consent, code with iss and state, tokens, then the read-only tools', async () => {
    const session = await signIn('lead@charlie.example');
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const { check, redirect, code } = await authorize(session, clientId, challenge);
    expect(check).toMatchObject({ kind: 'consent', client: { name: 'Synthetic desktop client', verified: false }, redirectHost: '127.0.0.1:33418' });
    expect(redirect?.searchParams.get('iss')).toBe(ISSUER);
    expect(redirect?.searchParams.get('state')).toBe('xyz');

    // A wrong verifier fails, and the code is then spent.
    expect((await form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: pkce().verifier })).body).toMatchObject({ error: 'invalid_grant' });
    expect((await form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier })).body).toMatchObject({ error: 'invalid_grant' });

    const tokens = await connect(clientId, session);
    expect(tokens.scope).toBe('mcp:read');
    const client = await mcp(tokens.access_token);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['get_claims_register', 'get_deal_summary', 'get_findings', 'get_foresight', 'get_post_close_register', 'get_valuation_bridge', 'list_deals', 'run_valuation_scenario', 'search_evidence']);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name).sort()).toEqual(['prep_me_for_ic', 'screen_this_deal', 'what_will_the_investor_find']);

    const deals = json(await client.callTool({ name: 'list_deals', arguments: {} }))['deals'] as { id: string; name: string }[];
    expect(deals.map((deal) => deal.id)).toContain(TROUBLED);
    const findings = json(await client.callTool({ name: 'get_findings', arguments: { dealId: TROUBLED, direction: -1 } }));
    expect((findings['items'] as unknown[]).length).toBeGreaterThan(0);
    expect((findings['items'] as { direction: number }[]).every((finding) => finding.direction === -1)).toBe(true);

    // A what-if changes the bridge and saves nothing.
    const bridge = json(await client.callTool({ name: 'get_valuation_bridge', arguments: { dealId: TROUBLED } }));
    const scenario = (bridge['scenarios'] as { scenario: { id: string; version: number } }[])[0]!.scenario;
    const assumptions = (await db.owner.query(`SELECT values FROM valuation_assumption_sets WHERE scenario_id = $1 ORDER BY version DESC LIMIT 1`, [scenario.id]).catch(() => ({ rows: [] }))).rows as { values: { assumptions: Record<string, string> } }[];
    const field = Object.entries(assumptions[0]?.values.assumptions ?? { multiple: '4' }).find(([key, value]) => key !== 'method' && typeof value === 'string')![0];
    const before = await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'valuation.run'`, [TROUBLED]);
    const whatIf = await client.callTool({ name: 'run_valuation_scenario', arguments: { dealId: TROUBLED, scenarioId: scenario.id, assumptions: { [field]: '9' } } });
    expect(whatIf.isError, JSON.stringify(whatIf.content)).toBeFalsy();
    expect(json(whatIf)['result']).toBeDefined();
    expect(await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'valuation.run'`, [TROUBLED])).toMatchObject({ rows: before.rows });
    const after = json(await client.callTool({ name: 'get_valuation_bridge', arguments: { dealId: TROUBLED } }));
    expect((after['scenarios'] as { scenario: { version: number } }[])[0]!.scenario.version).toBe(scenario.version);

    // Every call is audited with tool and client.
    const audited = await db.owner.query(`SELECT target_id FROM audit_events WHERE action = 'mcp.tool_called' AND deal_id = $1`, [TROUBLED]);
    expect(audited.rows.some((row) => String((row as { target_id: string }).target_id).startsWith(`get_findings · ${clientId}`))).toBe(true);
  });

  it('a client identified by its metadata document is shown as verified', async () => {
    const session = await signIn('lead@charlie.example');
    const { check } = await authorize(session, CIMD, pkce().challenge);
    expect(check).toMatchObject({ kind: 'consent', client: { name: 'Claude (synthetic)', host: 'claude.example', verified: true } });
    const tokens = await connect(CIMD, session);
    expect((await (await mcp(tokens.access_token)).listTools()).tools.length).toBe(9);
  });

  it('refuses: an unregistered redirect (shown, never redirected), a foreign resource, a private-address metadata URL', async () => {
    const session = await signIn('lead@charlie.example');
    const clientId = await registerClient();
    const { challenge } = pkce();
    const base = { response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE };
    expect((await call('POST', '/v1/oauth/authorize/check', { params: { ...base, redirect_uri: 'https://evil.example/cb' } }, session)).body).toMatchObject({ kind: 'error' });
    const foreign = await call('POST', '/v1/oauth/authorize/check', { params: { ...base, redirect_uri: REDIRECT, resource: 'https://other.example/mcp' } }, session);
    expect(foreign.body).toMatchObject({ kind: 'redirect' });
    expect(new URL(foreign.body['redirectTo'] as string).searchParams.get('error')).toBe('invalid_target');
    expect((await call('POST', '/v1/oauth/authorize/check', { params: { ...base, client_id: 'https://127.0.0.1/client.json', redirect_uri: REDIRECT } }, session)).body).toMatchObject({ kind: 'error' });
    expect((await call('POST', '/v1/oauth/register', { client_name: 'Bad', redirect_uris: ['http://evil.example/cb'] })).body).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('refresh rotates; replaying an old refresh token revokes the grant and its access token stops working', async () => {
    const session = await signIn('lead@charlie.example');
    const clientId = await registerClient();
    const first = await connect(clientId, session);
    const second = await form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId, resource: RESOURCE });
    expect(second.status).toBe(200);
    const fresh = second.body as { access_token: string; refresh_token: string };
    expect((await (await mcp(fresh.access_token)).listTools()).tools.length).toBe(9);
    expect((await form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).body).toMatchObject({ error: 'invalid_grant' });
    expect((await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, fresh.access_token)).status).toBe(401);
  });

  it('another organization sees none of this one, through any tool', async () => {
    const other = newId();
    const user = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Elsewhere (synthetic)', $2, 'EMAIL_CODE', now())`, [other, `elsewhere-${other.slice(-8)}`]);
    await db.owner.query(`INSERT INTO organization_flags (organization_id, mcp_enabled) VALUES ($1, true)`, [other]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Elsewhere lead (synthetic)', 'lead@elsewhere.example')`, [user, `pactlab|${user}`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER')`, [newId(), other, user]);
    const tokens = await connect(await registerClient(), await signIn('lead@elsewhere.example'));
    const client = await mcp(tokens.access_token);
    expect(json(await client.callTool({ name: 'list_deals', arguments: {} }))['deals']).toEqual([]);
    for (const name of ['get_findings', 'get_valuation_bridge', 'search_evidence', 'get_deal_summary', 'get_foresight']) {
      expect((await client.callTool({ name, arguments: { dealId: TROUBLED } })).isError, name).toBe(true);
    }
  });

  it('a target contributor on the pact cannot read the buyer-only valuation', async () => {
    const user = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Seller contributor (synthetic)', 'seller@charlie-target.example')`, [user, `pactlab|${user}`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), CHARLIE, user]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')`, [newId(), CHARLIE, TROUBLED, user]);
    const client = await mcp((await connect(await registerClient(), await signIn('seller@charlie-target.example'))).access_token);
    expect((await client.callTool({ name: 'get_valuation_bridge', arguments: { dealId: TROUBLED } })).isError).toBe(true);
    expect((await client.callTool({ name: 'run_valuation_scenario', arguments: { dealId: TROUBLED, scenarioId: newId() } })).isError).toBe(true);
  });

  it('value confirmations need the confidential scope', async () => {
    // A value confirmation (a cushion: value confirmed, not price paid), recorded as a lead would.
    const session0 = await signIn('lead@charlie.example');
    const created = await call('POST', `/v1/deals/${TROUBLED}/findings`, {
      domain: 'FINANCIAL', title: 'Synthetic cushion', description: 'Renewals ahead of plan (synthetic).', severity: 'LOW', confidence: 'HIGH',
      direction: 1, valueConfirmation: { valueDriver: 'Renewal rate', basis: 'Synthetic basis.' }, directionRationale: 'Confirms value (synthetic).',
    }, session0);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = await signIn('lead@charlie.example');
    const plain = await mcp((await connect(await registerClient(), session)).access_token);
    const wide = await mcp((await connect(await registerClient(), session, 'mcp:read mcp:confidential')).access_token);
    const cushions = (result: Body) => (result['items'] as { direction: number; valueConfirmation?: unknown }[]).filter((item) => item.direction === 1 && item.valueConfirmation).length;
    expect(cushions(json(await plain.callTool({ name: 'get_findings', arguments: { dealId: TROUBLED, limit: 100 } })))).toBe(0);
    const bridge = json(await plain.callTool({ name: 'get_valuation_bridge', arguments: { dealId: TROUBLED } }));
    expect((bridge['scenarios'] as Body[]).every((scenario) => scenario['confirmedValue'] === undefined)).toBe(true);
    // With the scope (and the lead's role), the cushion is there.
    expect(cushions(json(await wide.callTool({ name: 'get_findings', arguments: { dealId: TROUBLED, limit: 100 } })))).toBeGreaterThan(0);
  });

  it('switching MCP off gives 403; disconnecting in Settings ends access (401)', async () => {
    const session = await signIn('lead@charlie.example');
    const tokens = await connect(await registerClient(), session);
    const listed = await call('GET', '/v1/me/connected-apps', undefined, session);
    expect((listed.body['apps'] as unknown[]).length).toBeGreaterThan(0);
    await db.owner.query(`UPDATE organization_flags SET mcp_enabled = false WHERE organization_id = $1`, [CHARLIE]);
    const off = await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokens.access_token);
    expect(off.status).toBe(403);
    expect(String(off.headers['www-authenticate'])).toContain('error="insufficient_scope"');
    await db.owner.query(`UPDATE organization_flags SET mcp_enabled = true WHERE organization_id = $1`, [CHARLIE]);
    const apps = (await call('GET', '/v1/me/connected-apps', undefined, session)).body['apps'] as { id: string }[];
    for (const app of apps) await call('DELETE', `/v1/me/connected-apps/${app.id}`, undefined, session);
    expect((await call('POST', '/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokens.access_token)).status).toBe(401);
  });
});
