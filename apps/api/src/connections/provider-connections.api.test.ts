import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

/** A fetch with no network: records the URL and fails like an unreachable host. */
const offline = Object.assign(
  async (url: string): Promise<Response> => {
    offline.calls.push(url);
    throw new TypeError('fetch failed (offline test)');
  },
  { calls: [] as string[] },
);

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

describe('GitHub and Jira connections through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let bearer: string;

  async function call(method: 'GET' | 'POST', path: string, payload?: Body) {
    const response = await app.inject({
      method,
      url: `/v1/deals/${a.dealId}${path}`,
      headers: { authorization: `Bearer ${bearer}`, ...(method === 'POST' && path === '/sync-runs' ? { 'idempotency-key': `sync-${newId()}` } : {}) },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  async function connectAndSync(payload: Body) {
    const created = await call('POST', '/connections', payload);
    expect(created.status).toBe(201);
    const id = created.body['id'] as string;
    const validated = await call('POST', `/connections/${id}/validate`);
    const dryRun = await call('POST', `/connections/${id}/dry-run`, { limit: 3 });
    const run = await call('POST', '/sync-runs', { connectionId: id });
    return { id, validated: validated.body, dryRun: dryRun.body, run: run.body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: process.env['TEST_LOG'] ? 'error' : 'silent' }),
      // Offline: live adapters may try, but nothing leaves the test.
      providers: { fetch: offline, jiraSitePolicy: { selfHostedHosts: ['issues.apache.org'] } },
    });
    bearer = await new SignJWT({ org_id: a.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(a.subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('syncs Jira issues and sprints as evidence and surfaces source gaps', async () => {
    const jira = await connectAndSync({
      provider: 'jira',
      displayName: 'SparseCo Jira (fixture)',
      mode: 'FIXTURE',
      config: { site: 'sparseco.atlassian.net', projectKeys: ['SP', 'SPX'] },
    });
    expect(jira.validated).toMatchObject({ provider: 'jira', ok: true });
    expect((jira.dryRun['sample'] as unknown[]).length).toBe(3);
    expect(JSON.stringify(jira.dryRun)).not.toContain('"quote"');
    expect(jira.run).toMatchObject({ status: 'SUCCEEDED' });
    expect(jira.run['issuesCount']).toBeGreaterThan(0);

    const evidence = await call('GET', '/evidence?limit=100');
    const types = new Set((evidence.body['items'] as { evidenceType: string }[]).map((item) => item.evidenceType));
    expect(types).toEqual(new Set(['delivery.issue', 'delivery.sprint', 'delivery.contributor_activity']));
    const item = (evidence.body['items'] as { id: string; evidenceType: string }[]).find((entry) => entry.evidenceType === 'delivery.issue')!;
    const lineage = await call('GET', `/evidence/${item.id}/lineage`);
    expect((lineage.body['citations'] as { locator: unknown }[])[0]?.locator).toMatchObject({
      kind: 'provider_record',
      system: 'jira',
      site: 'sparseco.atlassian.net',
      resource: 'issue',
    });
  });

  it('syncs GitHub repository-head evidence', async () => {
    const github = await connectAndSync({
      provider: 'github',
      displayName: 'TroubledCo core (fixture)',
      mode: 'FIXTURE',
      config: { repository: 'troubledco/core' },
    });
    expect(github.validated).toMatchObject({ provider: 'github', ok: true });
    expect(github.run).toMatchObject({ status: 'SUCCEEDED' });
    // The repository head plus contributor activity per person per month.
    expect(github.run['recordsCreated']).toBeGreaterThan(1);
  });

  it('rejects invalid provider config, and Jira hosts that are not approved', async () => {
    expect(
      (await call('POST', '/connections', { provider: 'jira', displayName: 'x', mode: 'FIXTURE', config: { datasets: ['a'] } })).status,
    ).toBe(400);
    const refused = await call('POST', '/connections', {
      provider: 'jira',
      displayName: 'Unapproved',
      mode: 'LIVE',
      credentialRef: 'secretref:jira/token',
      config: { site: 'jira.example.org', projectKeys: ['EX'] },
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'JIRA_SITE_NOT_ALLOWED' });
    expect((await call('POST', '/connections/jira', { method: 'PUBLIC', site: '169.254.169.254', projectKeys: ['EX'] })).status).toBe(400);
    expect((await call('POST', '/connections/jira', { method: 'PUBLIC', site: 'jira.example.org', projectKeys: ['EX'] })).body).toMatchObject({ code: 'JIRA_SITE_NOT_ALLOWED' });
  });

  it('live Jira reads the provider: Cloud, and an approved self-hosted server anonymously', async () => {
    offline.calls.length = 0;
    const live = await call('POST', '/connections', {
      provider: 'jira',
      displayName: 'Live Jira',
      mode: 'LIVE',
      credentialRef: 'secretref:jira/token',
      config: { site: 'troubledco.atlassian.net', projectKeys: ['TC'] },
    });
    const id = live.body['id'] as string;
    expect((await call('POST', `/connections/${id}/validate`)).body).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([{ name: 'credentials', status: 'FAIL', detail: 'The stored Jira credential could not be read' }]),
    });
    const apache = await call('POST', '/connections/jira', { method: 'PUBLIC', site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] });
    expect(apache.status).toBe(201);
    expect(apache.body).toMatchObject({
      connection: { provider: 'jira', mode: 'LIVE' },
      validation: { ok: false, checks: expect.arrayContaining([{ name: 'reachability', status: 'FAIL', detail: 'Jira could not be reached' }]) },
    });
    // Only the approved host was ever addressed; the unreadable credential stopped the Cloud check before any request.
    expect(offline.calls).toEqual(['https://issues.apache.org/jira/rest/api/2/serverInfo']);
  });
});
