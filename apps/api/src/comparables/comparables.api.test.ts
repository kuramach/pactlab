import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

const PACT = {
  name: 'Project Harbor',
  baseCurrency: 'USD',
  buyer: { name: 'Alpha Capital', ownership: 'PRIVATE' },
  seller: { name: 'Harbor Software', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' },
  askingPrice: { amount: '5,000,000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'LETTER_OF_INTENT' },
};
const VALUES = {
  assumptions: { method: 'ARR_MULTIPLE', arr: '1000000', multiple: '4' },
  bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
};
const comparable = (n: number, overrides: Body = {}) => ({
  kind: 'PRECEDENT_TRANSACTION',
  name: `Precedent ${n}`,
  targetName: `Example Target ${n}`,
  announcedOn: '2025-06-01',
  companyType: 'SOFTWARE_SAAS',
  enterpriseValue: String(n * 1_000_000),
  arr: '1000000',
  currency: 'USD',
  arrGrowth: `${n * 10}`,
  sourceCitation: `Synthetic press release ${n}`,
  ...overrides,
});

describe('comparables and the multiple benchmark through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(who: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const audits = async (action: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND outcome = 'SUCCEEDED'`, [action])) as { rows: { n: number }[] }).rows[0]?.n;

  let dealId: string;
  let scenarioId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    const started = await call('lead', 'POST', '/v1/pacts', PACT);
    dealId = started.body['id'] as string;
    const onPact = { ...a, dealId };
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, onPact, role)).subject, a);
    }
    const created = await call('lead', 'POST', `/v1/deals/${dealId}/valuation/scenarios`, { name: 'Base case', values: VALUES });
    scenarioId = (created.body['scenario'] as Body)['id'] as string;
    expect((await call('lead', 'POST', `/v1/deals/${dealId}/valuation/scenarios/${scenarioId}/runs`, { expectedVersion: 1 })).status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('lets admins and deal leads enter cited comparables; others are refused', async () => {
    expect((await call('analyst', 'POST', '/v1/comparables', comparable(1))).status).toBe(403);
    expect((await call('target_contributor', 'GET', '/v1/comparables')).status).toBe(403);
    expect((await call('lead', 'POST', '/v1/comparables', comparable(1, { sourceCitation: '' }))).status).toBe(400);
    expect((await call('lead', 'POST', '/v1/comparables', { ...comparable(1), origin: 'SYNTHETIC' })).status).toBe(400);
    for (const n of [2, 3, 4, 5, 6]) {
      const created = await call('lead', 'POST', '/v1/comparables', comparable(n));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ origin: 'ENTERED', multiple: `${n}.00`, arrGrowth: `0.${n}` });
    }
    const listed = await call('analyst', 'GET', '/v1/comparables');
    expect(listed.body).toMatchObject({ canWrite: false, provider: 'NOT_CONFIGURED' });
    expect((listed.body['items'] as Body[]).length).toBe(5);
    expect(((await call('other', 'GET', '/v1/comparables')).body['items'] as Body[]).length).toBe(0);
    expect(await audits('comparable.recorded')).toBe(5);
  });

  it('places the chosen and asking-implied multiples among the comparables', async () => {
    const benchmark = await call('analyst', 'GET', `/v1/deals/${dealId}/benchmark`);
    expect(benchmark.status).toBe(200);
    expect(benchmark.body).toMatchObject({
      filter: { companyType: 'SOFTWARE_SAAS', years: 5, synthetic: 'include' },
      scenario: { id: scenarioId, method: 'ARR_MULTIPLE' },
      target: { arr: { amount: '1000000', currency: 'USD' }, arrSource: 'SCENARIO' },
      count: 5,
      sufficient: true,
      stats: { min: '2.00', p25: '3.00', median: '4.00', p75: '5.00', max: '6.00' },
      chosen: { multiple: '4.00', percentile: 50, position: 'MID' },
      askingImplied: { multiple: '5.00', percentile: 70, position: 'MID' },
      judgement: null,
      canJudge: false,
      ownDeal: { eligible: false, added: false },
    });
    const other = await call('lead', 'GET', `/v1/deals/${dealId}/benchmark?companyType=FINTECH`);
    expect(other.body).toMatchObject({ count: 0, stats: null });
    expect((await call('target_contributor', 'GET', `/v1/deals/${dealId}/benchmark`)).status).toBe(403);
    expect((await call('other', 'GET', `/v1/deals/${dealId}/benchmark`)).status).toBe(404);
  });

  it('records the deal lead’s judgement against the benchmark, and shows when it is out of date', async () => {
    const judgement = { verdict: 'HIGH', rationale: 'Asking implies 5.0× against a 4.0× median' };
    expect((await call('analyst', 'POST', `/v1/deals/${dealId}/multiple-judgements`, judgement)).status).toBe(403);
    expect((await call('lead', 'POST', `/v1/deals/${dealId}/multiple-judgements`, { verdict: 'HIGH', rationale: '' })).status).toBe(400);
    const recorded = await call('lead', 'POST', `/v1/deals/${dealId}/multiple-judgements`, judgement);
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({ verdict: 'HIGH', askingVersion: 1, askingMultiple: '5.00', comparableCount: 5, current: true });
    expect((await call('lead', 'GET', `/v1/deals/${dealId}/benchmark`)).body).toMatchObject({ canJudge: true, judgement: { verdict: 'HIGH', current: true } });

    // Retiring a comparable changes the set: the judgement is flagged for a fresh look.
    const listed = (await call('lead', 'GET', '/v1/comparables')).body['items'] as Body[];
    expect((await call('lead', 'POST', `/v1/comparables/${listed[0]!['id'] as string}/retire`)).status).toBe(200);
    expect((await call('lead', 'POST', `/v1/comparables/${listed[0]!['id'] as string}/retire`)).status).toBe(409);
    expect((await call('lead', 'GET', `/v1/deals/${dealId}/benchmark`)).body).toMatchObject({ count: 4, judgement: { current: false } });
    expect(((await call('analyst', 'GET', `/v1/deals/${dealId}/multiple-judgements`)).body['items'] as Body[]).length).toBe(1);
    expect(await audits('multiple_judgement.recorded')).toBe(1);
    expect(await audits('comparable.retired')).toBe(1);
  });

  it('adds the deal to the firm’s precedents only after an approved valuation, once', async () => {
    expect((await call('lead', 'POST', `/v1/deals/${dealId}/comparables/from-deal`)).status).toBe(422);
    const base = `/v1/deals/${dealId}/valuation/scenarios/${scenarioId}`;
    const submitted = await call('lead', 'POST', `${base}/submissions`, { expectedVersion: 2 });
    const submissionId = ((submitted.body['submissions'] as Body[])[0] as Body)['id'] as string;
    expect((await call('reviewer', 'POST', `${base}/submissions/${submissionId}/decisions`, { expectedVersion: 3, decision: 'APPROVED', rationale: 'Synthetic approval' })).status).toBe(201);

    expect((await call('analyst', 'POST', `/v1/deals/${dealId}/comparables/from-deal`)).status).toBe(403);
    const own = await call('lead', 'POST', `/v1/deals/${dealId}/comparables/from-deal`);
    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ origin: 'OWN_DEAL', kind: 'OWN_DEAL', sourceDealId: dealId, multiple: '4.00', targetName: 'Harbor Software', acquirerName: 'Alpha Capital' });
    expect((await call('lead', 'POST', `/v1/deals/${dealId}/comparables/from-deal`)).status).toBe(409);
    // A deal never benchmarks against itself.
    expect((await call('lead', 'GET', `/v1/deals/${dealId}/benchmark`)).body).toMatchObject({ count: 4, byOrigin: { OWN_DEAL: 0 }, ownDeal: { eligible: true, added: true } });
  });

  it('prices cited public deals as counter-offers, lead only, never the firm\'s own deals', async () => {
    const created = await call('lead', 'POST', '/v1/comparables', comparable(3, { name: 'Public 3', sourceUrl: 'https://example.com/release', acquirerName: 'Acquirer Co' }));
    const publicId = created.body['id'] as string;
    const all = (await call('lead', 'GET', '/v1/comparables')).body['items'] as Body[];
    const ownId = all.find((c) => c['origin'] === 'OWN_DEAL')!['id'] as string;
    const retiredId = (await db.owner.query(`SELECT id FROM comparables WHERE status = 'RETIRED' LIMIT 1`) as { rows: { id: string }[] }).rows[0]!.id;
    const anchors = `/v1/deals/${dealId}/anchors`;

    expect((await call('analyst', 'POST', anchors, { comparableId: publicId })).status).toBe(403);
    expect((await call('lead', 'POST', anchors, { comparableId: ownId })).status).toBe(422);
    expect((await call('lead', 'POST', anchors, { comparableId: retiredId })).status).toBe(422);
    const added = await call('lead', 'POST', anchors, { comparableId: publicId, note: 'Seller can check this one' });
    expect(added.status).toBe(201);
    expect((await call('lead', 'POST', anchors, { comparableId: publicId })).status).toBe(409);
    await call('lead', 'POST', anchors, { comparableId: (all.find((c) => c['name'] === 'Precedent 6')!['id'] as string) });

    const view = await call('analyst', 'GET', anchors);
    expect(view.status).toBe(200);
    const items = view.body['items'] as Body[];
    expect(items[0]).toMatchObject({
      note: 'Seller can check this one',
      counter: { multiple: '3.00', counterPrice: { amount: '3000000.00' }, gap: { amount: '-2000000.00' }, gapRatio: '-0.4000', verdict: 'BELOW', flags: [] },
    });
    expect(items[0]!['talkingPoint']).toBe(
      "Acquirer Co bought Example Target 3 for USD 3,000,000 — 3.00× ARR (2025-06-01; source: Synthetic press release 3 https://example.com/release). At 3.00×, Harbor Software's USD 1,000,000 ARR implies USD 3,000,000, 40% below the USD 5,000,000 ask.",
    );
    // A higher multiple than the ask's, with no public link: it helps the seller.
    expect((items[1]!['counter'] as Body)['flags']).toEqual(['NO_PUBLIC_SOURCE', 'SUPPORTS_ASK']);
    expect(view.body).toMatchObject({ strongestId: items[0]!['id'], canEdit: false });
    expect((view.body['eligible'] as Body[]).some((c) => c['id'] === ownId || c['id'] === publicId)).toBe(false);
    expect((await call('target_contributor', 'GET', anchors)).status).toBe(403);
    expect((await call('other', 'GET', anchors)).status).toBe(404);

    const removed = await call('lead', 'POST', `${anchors}/${items[0]!['id'] as string}/remove`);
    expect(removed.status).toBe(200);
    expect((removed.body['items'] as Body[]).length).toBe(1);
    expect((await call('lead', 'POST', `${anchors}/${items[0]!['id'] as string}/remove`)).status).toBe(404);
    expect(await audits('negotiation_anchor.added')).toBe(2);
    expect(await audits('negotiation_anchor.removed')).toBe(1);
  });
});
