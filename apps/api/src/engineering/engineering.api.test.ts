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

  async function call(who: string, method: 'GET' | 'POST', path: string, payload?: Body, target = app, dealId = a.dealId) {
    const response = await target.inject({
      method,
      url: `/v1/deals/${dealId}${path}`,
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

  const allPeople = async (who = 'analyst', query = '') => (await call(who, 'GET', `/engineering/people?${query.includes('limit=') ? '' : 'limit=100'}${query}`)).body;

  it('shows team health, a compact point per person, and pseudonymous profiles that combine code and Jira', async () => {
    const view = await call('analyst', 'GET', '/engineering');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ version: 'engineering-2', suppressed: false, contributors: 8, people: { enabled: false }, canManageNames: false, completeness: { complete: true, notes: [] } });
    expect(view.body).not.toHaveProperty('profiles');
    expect((view.body['points'] as Body[]).length).toBe(8);
    expect(view.body['keepCount']).toBe((view.body['keepList'] as Body[]).length);
    const page = await allPeople();
    expect(page).toMatchObject({ total: 8, nextCursor: null });
    const profiles = page['items'] as Body[];
    expect(profiles.every((profile) => profile['name'] === null && /^Contributor \d{2}$/.test(profile['label'] as string))).toBe(true);
    // The lead commits little but coordinates delivery; the product manager never commits.
    const coordinators = profiles.filter((profile) => (profile['tags'] as string[]).includes('COORDINATOR'));
    expect(coordinators.length).toBeGreaterThan(0);
    expect(profiles.some((profile) => profile['commits'] === 0 && (profile['issuesCreated'] as number) > 0)).toBe(true);
    // No names, raw identities, scores or ranks anywhere in the people data.
    const people = JSON.stringify({ profiles, points: view.body['points'], keepList: view.body['keepList'] });
    expect(people).not.toMatch(/\(synthetic\)|hc-dev-|hc-lead-|"score"|"rank"/);
    expect((view.body['sources'] as Body[]).map((source) => source['provider']).sort()).toEqual(['github', 'jira']);
  });

  it('pages, searches and filters people; a hidden name never matches', async () => {
    const first = await allPeople('analyst', '&limit=3');
    expect(first).toMatchObject({ total: 8, nextCursor: 3 });
    expect((first['items'] as Body[]).map((profile) => profile['label'])).toEqual(['Contributor 01', 'Contributor 02', 'Contributor 03']);
    expect(((await allPeople('analyst', '&cursor=6&limit=3'))['items'] as Body[]).length).toBe(2);
    expect((await allPeople('analyst', '&q=contributor%2005'))['total']).toBe(1);
    expect((await allPeople('analyst', '&tag=COORDINATOR'))['total']).toBeGreaterThan(0);
    expect((await allPeople('analyst', '&area=billing'))['total']).toBeGreaterThan(0);
    expect((await allPeople('analyst', '&keep=true'))['total']).toBe((await call('analyst', 'GET', '/engineering')).body['keepCount']);
    // Names are hidden: searching for one finds nobody.
    expect((await allPeople('analyst', '&q=okafor'))['total']).toBe(0);
    expect((await call('analyst', 'GET', '/engineering/people?limit=500')).status).toBe(400);
  });

  it('shows names only after the deal lead opens the gate with a basis, auditing every view', async () => {
    expect((await call('analyst', 'POST', '/people-access', { enabled: true, basis: 'Seller agreed in the data-room terms' })).status).toBe(403);
    expect((await call('lead', 'POST', '/people-access', { enabled: true, basis: 'short' })).status).toBe(400);
    const opened = await call('lead', 'POST', '/people-access', { enabled: true, basis: 'Seller agreed in the data-room terms (synthetic)' });
    expect(opened.body).toMatchObject({ enabled: true, basis: 'Seller agreed in the data-room terms (synthetic)' });
    const before = (await audits('people.names_viewed')) ?? 0;
    const view = await call('analyst', 'GET', '/engineering');
    expect((view.body['points'] as Body[]).map((point) => point['name'])).toContain('Grace Okafor (synthetic)');
    expect(await audits('people.names_viewed')).toBe(before + 1);
    // With names shown, search by name works — and is audited too.
    const found = await allPeople('analyst', '&q=okafor');
    expect(found['total']).toBe(1);
    expect(await audits('people.names_viewed')).toBe(before + 2);
    const lead = (found['items'] as Body[])[0]!;
    const detail = await call('analyst', 'GET', `/engineering/contributors/${lead['contributorKey'] as string}`);
    expect(detail.body).toMatchObject({ profile: { name: 'Grace Okafor (synthetic)' } });
    expect((detail.body['series'] as Body[]).length).toBe(12);
    await call('lead', 'POST', '/people-access', { enabled: false, basis: 'Closing names after the retention review' });
    expect(((await allPeople())['items'] as Body[]).every((profile) => profile['name'] === null)).toBe(true);
    expect(await audits('people.names_enabled')).toBe(1);
    expect(await audits('people.names_disabled')).toBe(1);
  });

  it('reads every activity row, well past the old 50,000 cap, and says when a source is missing', async () => {
    const c = await createSyntheticTenant(db.owner, 'Charlie');
    tokens['charlie'] = await sign(c.subject, c);
    const created = await call('charlie', 'POST', '/connections', { provider: 'github', displayName: 'HealthyCo platform (synthetic)', mode: 'FIXTURE', config: { repository: 'healthyco/platform' } }, app, c.dealId);
    const run = await call('charlie', 'POST', '/sync-runs', { connectionId: created.body['id'] as string }, app, c.dealId);
    // 3,000 people × 20 months of code activity = 60,000 rows, written straight into the evidence table.
    await db.owner.query(
      `INSERT INTO evidence_items (id, organization_id, deal_id, connection_id, first_sync_run_id, last_sync_run_id, evidence_type, source_system, source_record_id, canonical, content_hash)
       SELECT gen_random_uuid(), $1, $2, $3, $4, $4, 'code.contributor_activity', 'github', 'bulk:' || i,
              jsonb_build_object('contributorKey', lpad(to_hex(1000000 + i % 3000), 16, '0'), 'month', to_char(date '2025-02-01' + ((i / 3000) || ' month')::interval, 'YYYY-MM'),
                                 'commits', '3', 'additions', '30', 'deletions', '3', 'areas', '{"bulk": 3}'),
              encode(sha256(('bulk:' || i)::bytea), 'hex')
       FROM generate_series(0, 59999) AS i`,
      [c.organizationId, c.dealId, created.body['id'], run.body['id']],
    );
    const view = await call('charlie', 'GET', '/engineering', undefined, app, c.dealId);
    expect(view.status).toBe(200);
    // Everyone is present: 3,000 bulk people plus HealthyCo's 7 committers.
    expect(view.body['contributors']).toBe(3007);
    expect((view.body['points'] as Body[]).length).toBe(3007);
    expect(view.body['completeness']).toMatchObject({ complete: false, notes: ['No delivery activity: Jira work is not in these numbers.'] });
    const page = (await call('charlie', 'GET', '/engineering/people?limit=100&cursor=2900', undefined, app, c.dealId)).body;
    expect(page).toMatchObject({ total: 3007, nextCursor: 3000 });
  }, 120_000);

  it('keeps people data from target contributors and other tenants, and synthetic connections from locked environments', async () => {
    expect((await call('target_contributor', 'GET', '/engineering')).status).toBe(403);
    expect((await call('other', 'GET', '/engineering')).status).toBe(404);
    const refused = await call('lead', 'POST', '/connections', { provider: 'github', displayName: 'x', mode: 'FIXTURE', config: { repository: 'healthyco/platform' } }, locked);
    expect(refused.status).toBe(403);
    const options = async (target: NestFastifyApplication) =>
      (await target.inject({ method: 'GET', url: '/v1/synthetic-sources', headers: { authorization: `Bearer ${tokens['lead']}` } })).json() as Body;
    expect(await options(locked)).toEqual({ allowed: false, repositories: [], jiraSites: [] });
    expect(await options(app)).toMatchObject({ allowed: true, repositories: expect.arrayContaining(['healthyco/platform', 'troubledco/core']) });
  });
});
