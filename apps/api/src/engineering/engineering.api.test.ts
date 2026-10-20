import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

describe('Engineering tab through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let locked: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};

  const sign = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

  async function call(who: string, method: 'GET' | 'POST', path: string, payload?: Body, target = app) {
    const response = await target.inject({
      method,
      url: `/v1/deals/${a.dealId}${path}`,
      headers: { authorization: `Bearer ${tokens[who]}`, ...(path === '/sync-runs' ? { 'idempotency-key': `sync-${newId()}` } : {}) },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const audits = async (action: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND outcome = 'SUCCEEDED'`, [action])) as { rows: { n: number }[] }).rows[0]?.n;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
    };
    app = await createApp(deps);
    locked = await createApp({ ...deps, providers: { allowFixtureConnections: false } });
    tokens['lead'] = await sign(a.subject, a);
    tokens['other'] = await sign(b.subject, b);
    for (const role of ['ANALYST', 'TARGET_CONTRIBUTOR'] as const) tokens[role.toLowerCase()] = await sign((await addSyntheticDealMember(db.owner, a, role)).subject, a);

    // Synthetic HealthyCo code and delivery, connected the way a fresh deal would.
    for (const payload of [
      { provider: 'github', displayName: 'HealthyCo platform (synthetic)', mode: 'FIXTURE', config: { repository: 'healthyco/platform' } },
      { provider: 'jira', displayName: 'HealthyCo Jira (synthetic)', mode: 'FIXTURE', config: { site: 'healthyco.atlassian.net', projectKeys: ['HC'] } },
    ]) {
      const created = await call('lead', 'POST', '/connections', payload);
      expect(created.status).toBe(201);
      expect((await call('lead', 'POST', '/sync-runs', { connectionId: created.body['id'] as string })).body).toMatchObject({ status: 'SUCCEEDED' });
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await locked?.close();
    await db?.stop();
  });

  it('shows team health and pseudonymous profiles that combine code and Jira', async () => {
    const view = await call('analyst', 'GET', '/engineering');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ suppressed: false, contributors: 8, people: { enabled: false }, canManageNames: false });
    const profiles = view.body['profiles'] as Body[];
    expect(profiles.every((profile) => profile['name'] === null && /^Contributor \d{2}$/.test(profile['label'] as string))).toBe(true);
    // The lead commits little but coordinates delivery; the product manager never commits.
    const coordinators = profiles.filter((profile) => (profile['tags'] as string[]).includes('COORDINATOR'));
    expect(coordinators.length).toBeGreaterThan(0);
    expect(profiles.some((profile) => profile['commits'] === 0 && (profile['issuesCreated'] as number) > 0)).toBe(true);
    // No names, raw identities, scores or ranks anywhere in the people data.
    const people = JSON.stringify({ profiles: view.body['profiles'], keepList: view.body['keepList'] });
    expect(people).not.toMatch(/\(synthetic\)|hc-dev-|hc-lead-|"score"|"rank"/);
    expect((view.body['sources'] as Body[]).map((source) => source['provider']).sort()).toEqual(['github', 'jira']);
  });

  it('shows names only after the deal lead opens the gate with a basis, auditing every view', async () => {
    expect((await call('analyst', 'POST', '/people-access', { enabled: true, basis: 'Seller agreed in the data-room terms' })).status).toBe(403);
    expect((await call('lead', 'POST', '/people-access', { enabled: true, basis: 'short' })).status).toBe(400);
    const opened = await call('lead', 'POST', '/people-access', { enabled: true, basis: 'Seller agreed in the data-room terms (synthetic)' });
    expect(opened.body).toMatchObject({ enabled: true, basis: 'Seller agreed in the data-room terms (synthetic)' });
    const before = (await audits('people.names_viewed')) ?? 0;
    const view = await call('analyst', 'GET', '/engineering');
    const names = (view.body['profiles'] as Body[]).map((profile) => profile['name']);
    expect(names).toContain('Grace Okafor (synthetic)');
    expect(await audits('people.names_viewed')).toBe(before + 1);
    const lead = (view.body['profiles'] as Body[]).find((profile) => profile['name'] === 'Grace Okafor (synthetic)')!;
    const detail = await call('analyst', 'GET', `/engineering/contributors/${lead['contributorKey'] as string}`);
    expect(detail.body).toMatchObject({ profile: { name: 'Grace Okafor (synthetic)' } });
    expect((detail.body['series'] as Body[]).length).toBe(12);
    await call('lead', 'POST', '/people-access', { enabled: false, basis: 'Closing names after the retention review' });
    expect(((await call('analyst', 'GET', '/engineering')).body['profiles'] as Body[]).every((profile) => profile['name'] === null)).toBe(true);
    expect(await audits('people.names_enabled')).toBe(1);
    expect(await audits('people.names_disabled')).toBe(1);
  });

  it('keeps people data from target contributors and other tenants, and synthetic connections from locked environments', async () => {
    expect((await call('target_contributor', 'GET', '/engineering')).status).toBe(403);
    expect((await call('other', 'GET', '/engineering')).status).toBe(404);
    const refused = await call('lead', 'POST', '/connections', { provider: 'github', displayName: 'x', mode: 'FIXTURE', config: { repository: 'healthyco/platform' } }, locked);
    expect(refused.status).toBe(403);
  });
});
