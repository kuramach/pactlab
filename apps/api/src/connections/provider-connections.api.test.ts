import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

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
      logger: createLogger('api-test', { level: 'silent' }),
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
    expect(types).toEqual(new Set(['delivery.issue', 'delivery.sprint']));
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
    expect(github.run).toMatchObject({ status: 'SUCCEEDED', recordsCreated: 1 });
  });

  it('rejects invalid provider config and keeps live adapters inert', async () => {
    expect(
      (await call('POST', '/connections', { provider: 'jira', displayName: 'x', mode: 'FIXTURE', config: { datasets: ['a'] } })).status,
    ).toBe(400);
    const live = await call('POST', '/connections', {
      provider: 'jira',
      displayName: 'Live Jira',
      mode: 'LIVE',
      credentialRef: 'secretref:jira/token',
      config: { site: 'troubledco.atlassian.net', projectKeys: ['TC'] },
    });
    const id = live.body['id'] as string;
    expect((await call('POST', `/connections/${id}/validate`)).body).toMatchObject({ ok: false });
    expect((await call('POST', `/connections/${id}/dry-run`, { limit: 3 })).body).toMatchObject({ sample: [] });
  });
});
