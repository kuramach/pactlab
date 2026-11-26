import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  FixtureMcpSessionFactory,
  GITHUB_MCP_FIXTURE,
  type SecretStore,
} from '@pactlab/connectors';
import {
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const ENDPOINT = 'https://mcp.github.example/mcp/x/dependabot/readonly';
const TOKEN = 'ghp_synthetic_mcp_token_000000';
type Body = Record<string, unknown>;

/** A secret store in memory: what was stored, and nothing else. */
const stored = new Map<string, string>();
const memorySecrets: SecretStore = {
  put: async (ref, value) => void stored.set(ref, value),
  get: async (ref) => {
    const value = stored.get(ref);
    if (value === undefined) throw new Error('no such secret');
    return value;
  },
};

/** Live sessions answered in process by the synthetic GitHub MCP server; records the headers each session carried. */
const opened: Record<string, string>[] = [];
const sessions = {
  open: async (request: Parameters<FixtureMcpSessionFactory['open']>[0]) => {
    opened.push({ ...request.headers, url: request.server.url });
    return new FixtureMcpSessionFactory({ github: GITHUB_MCP_FIXTURE }).open(request);
  },
};

describe('MCP servers as evidence sources through the API (T-084c)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;

  const bearerFor = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(tenant.subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

  async function call(
    method: 'GET' | 'POST',
    path: string,
    payload?: Body,
    as: SyntheticTenant = a,
    deal: string = a.dealId,
  ) {
    const response = await app.inject({
      method,
      url: path.startsWith('/v1/') ? path : `/v1/deals/${deal}${path}`,
      headers: {
        authorization: `Bearer ${await bearerFor(as)}`,
        ...(path === '/sync-runs' ? { 'idempotency-key': `sync-${newId()}` } : {}),
      },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      logger: createLogger('api-test', { level: process.env['TEST_LOG'] ? 'error' : 'silent' }),
      providers: {
        secrets: memorySecrets,
        mcpServerPolicy: {
          servers: [{ id: 'github', profile: 'github', url: ENDPOINT, host: 'mcp.github.example' }],
        },
        mcpSessions: sessions,
        fetch: async () => {
          throw new TypeError('offline test');
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('syncs a fixture MCP server into normalized evidence, idempotently', async () => {
    const created = await call('POST', '/connections', {
      provider: 'mcp',
      displayName: 'TroubledCo alerts (fixture)',
      mode: 'FIXTURE',
      config: { server: 'github', target: { repository: 'troubledco/core' } },
    });
    expect(created.status).toBe(201);
    const id = created.body['id'] as string;
    expect((await call('POST', `/connections/${id}/validate`)).body).toMatchObject({
      provider: 'mcp',
      adapterVersion: 'mcp-github-1',
      ok: true,
    });
    const dryRun = await call('POST', `/connections/${id}/dry-run`, { limit: 2 });
    expect(dryRun.body).toMatchObject({ truncated: true });
    expect(JSON.stringify(dryRun.body)).not.toContain('"quote"');

    const run = await call('POST', '/sync-runs', { connectionId: id });
    expect(run.body).toMatchObject({
      status: 'SUCCEEDED',
      recordsCreated: 5,
      issuesCount: 0,
      connectorVersion: 'mcp-github-1',
    });
    const replay = await call('POST', '/sync-runs', { connectionId: id });
    expect(replay.body).toMatchObject({
      status: 'SUCCEEDED',
      recordsCreated: 0,
      recordsUnchanged: 5,
    });

    const evidence = await call('GET', '/evidence?limit=100');
    const alerts = (evidence.body['items'] as { id: string; evidenceType: string }[]).filter(
      (item) => item.evidenceType === 'security.dependency_alert',
    );
    expect(alerts).toHaveLength(5);
    const lineage = await call('GET', `/evidence/${alerts[0]!.id}/lineage`);
    expect((lineage.body['citations'] as { locator: unknown }[])[0]?.locator).toMatchObject({
      kind: 'provider_record',
      system: 'mcp:github',
      resource: 'troubledco/core/dependabot_alerts',
    });
    expect(JSON.stringify(evidence.body)).not.toMatch(
      /Ivan Petrov|tc-dev-01|Ignore previous instructions/,
    );
  });

  it('reaches only servers the operator approved, named by id, never a URL', async () => {
    const offList = await call('POST', '/connections', {
      provider: 'mcp',
      displayName: 'x',
      mode: 'LIVE',
      credentialRef: 'secretref:mcp/token',
      config: { server: 'linear', target: { repository: 'a/b' } },
    });
    expect(offList.status).toBe(422);
    expect(
      (
        await call('POST', '/connections/mcp', {
          method: 'PUBLIC',
          server: 'https://169.254.169.254/mcp',
          target: { repository: 'a/b' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/connections/mcp', {
          method: 'PUBLIC',
          server: 'github',
          target: { repository: '../etc' },
        })
      ).body,
    ).toMatchObject({ code: 'MCP_TARGET_INVALID' });
    expect(
      (
        await call('POST', '/connections/mcp', {
          method: 'PUBLIC',
          server: 'github',
          target: { repository: 'a/b' },
          url: 'https://evil.example',
        })
      ).status,
    ).toBe(400);
    const servers = await call('GET', '/v1/mcp-evidence-servers');
    expect(servers.body).toEqual({
      items: [
        {
          id: 'github',
          label: 'GitHub MCP server (Dependabot alerts)',
          host: 'mcp.github.example',
          requiredGrant: expect.stringContaining('security_events'),
        },
      ],
    });
  });

  it('connects an approved server live with a stored token, never returned, and syncs', async () => {
    opened.length = 0;
    const connected = await call('POST', '/connections/mcp', {
      method: 'TOKEN',
      server: 'github',
      target: { repository: 'troubledco/core' },
      token: TOKEN,
    });
    expect(connected.status).toBe(201);
    expect(connected.body).toMatchObject({
      connection: { provider: 'mcp', mode: 'LIVE', hasCredential: true },
      validation: { ok: true },
    });
    expect(JSON.stringify(connected.body)).not.toContain(TOKEN);
    expect(opened[0]).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'X-MCP-Readonly': 'true',
      url: ENDPOINT,
    });
    const id = (connected.body['connection'] as { id: string }).id;
    expect((await call('POST', '/sync-runs', { connectionId: id })).body).toMatchObject({
      status: 'SUCCEEDED',
      recordsCreated: 5,
    });
    expect([...stored.keys()]).toEqual([`secretref:${a.organizationId}/${a.dealId}/mcp/${id}`]);

    // A token that cannot read alerts is a source issue on the run, not a silent empty sync.
    const denied = await call('POST', '/connections/mcp', {
      method: 'TOKEN',
      server: 'github',
      target: { repository: 'sparseco/app' },
      token: TOKEN,
    });
    const deniedRun = await call('POST', '/sync-runs', {
      connectionId: (denied.body['connection'] as { id: string }).id,
    });
    expect(deniedRun.body).toMatchObject({
      status: 'SUCCEEDED',
      recordsCreated: 0,
      issuesCount: 4,
    });
  });

  it('keeps another organization out', async () => {
    const created = await call('POST', '/connections', {
      provider: 'mcp',
      displayName: 'Alpha alerts',
      mode: 'FIXTURE',
      config: { server: 'github', target: { repository: 'healthyco/platform' } },
    });
    const id = created.body['id'] as string;
    expect((await call('POST', `/connections/${id}/validate`, undefined, b, a.dealId)).status).toBe(
      404,
    );
    expect((await call('POST', `/connections/${id}/validate`, undefined, b, b.dealId)).status).toBe(
      404,
    );
    expect((await call('POST', '/sync-runs', { connectionId: id }, b, b.dealId)).status).toBe(404);
  });
});
