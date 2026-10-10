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
};
const ASKING = { amount: '70,000,000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'LETTER_OF_INTENT', quotedOn: '2026-09-15', earnOutAmount: '5000000', note: '' };

describe('asking price through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('records the asking price with the Pact, then keeps each revision as a new version', async () => {
    const lead = await token(a.subject, a);
    const started = await call('POST', '/v1/pacts', lead, { ...PACT, askingPrice: ASKING });
    expect(started.status).toBe(201);
    const dealId = started.body['id'] as string;
    const first = await call('GET', `/v1/deals/${dealId}/asking-price`, lead);
    expect(first.body['current']).toMatchObject({ version: 1, amount: '70000000', basis: 'ENTERPRISE_VALUE', earnOutAmount: '5000000', note: null });

    const revised = await call('POST', `/v1/deals/${dealId}/asking-price`, lead, { ...ASKING, amount: '65000000.00', source: 'MANAGEMENT' });
    expect(revised.status).toBe(201);
    expect((revised.body['history'] as Body[]).map((entry) => [entry['version'], entry['amount']])).toEqual([
      [2, '65000000'],
      [1, '70000000'],
    ]);
    // The same price again is not a revision.
    const again = await call('POST', `/v1/deals/${dealId}/asking-price`, lead, { ...ASKING, amount: '65000000', source: 'MANAGEMENT' });
    expect((again.body['history'] as Body[]).length).toBe(2);
    const audits = (await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'asking_price.recorded'`, [dealId])) as {
      rows: { n: number }[];
    };
    expect(audits.rows[0]!.n).toBe(2);

    const list = (await call('GET', '/v1/deals', lead)).body['items'] as Body[];
    expect(list.find((deal) => deal['id'] === dealId)?.['askingPrice']).toEqual({ amount: '65000000', currency: 'USD', basis: 'ENTERPRISE_VALUE' });
  });

  it('starts a Pact without an asking price, and rejects nonsense prices', async () => {
    const lead = await token(a.subject, a);
    const started = await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Quiet' });
    expect((await call('GET', `/v1/deals/${started.body['id'] as string}/asking-price`, lead)).body).toEqual({ current: null, history: [] });
    for (const askingPrice of [
      { ...ASKING, amount: '0' },
      { ...ASKING, amount: '-5' },
      { ...ASKING, amount: '1e9' },
      { ...ASKING, basis: 'REVENUE' },
      { ...ASKING, earnOutAmount: '80000000' },
    ]) {
      const response = await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Bad', askingPrice });
      expect(response.status, JSON.stringify(askingPrice)).not.toBe(201);
    }
  });

  it('tests the asking price against each scenario run, before and after accepted risks', async () => {
    const lead = await token(a.subject, a);
    const dealId = (await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Value', askingPrice: ASKING })).body['id'] as string;
    const created = await call('POST', `/v1/deals/${dealId}/valuation/scenarios`, lead, {
      name: 'Base',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '10000000', multiple: '6.5' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
      },
    });
    const scenario = created.body['scenario'] as Body;
    expect(created.body['askingComparison']).toBeNull();
    await call('POST', `/v1/deals/${dealId}/valuation/scenarios/${scenario['id'] as string}/runs`, lead, { expectedVersion: scenario['version'] });
    const view = (await call('GET', `/v1/deals/${dealId}/valuation/scenarios/${scenario['id'] as string}`, lead)).body;
    expect(view['askingComparison']).toMatchObject({
      askingVersion: 1,
      comparable: true,
      beforeRisks: { value: { amount: '65000000.00' }, gap: { amount: '-5000000.00' }, gapRatio: '-0.0714', verdict: 'BELOW' },
    });
  });

  it('hides asking prices from target contributors and other tenants; viewers cannot record them', async () => {
    const lead = await token(a.subject, a);
    await call('POST', `/v1/deals/${a.dealId}/asking-price`, lead, ASKING);
    const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    const viewer = await addSyntheticDealMember(db.owner, a, 'VIEWER');
    expect((await call('GET', `/v1/deals/${a.dealId}/asking-price`, await token(contributor.subject, a))).status).toBe(403);
    const contributorList = (await call('GET', '/v1/deals', await token(contributor.subject, a))).body['items'] as Body[];
    expect(contributorList.find((deal) => deal['id'] === a.dealId)?.['askingPrice']).toBeNull();
    expect((await call('GET', `/v1/deals/${a.dealId}/asking-price`, await token(viewer.subject, a))).status).toBe(200);
    expect((await call('POST', `/v1/deals/${a.dealId}/asking-price`, await token(viewer.subject, a), ASKING)).status).toBe(403);
    expect((await call('GET', `/v1/deals/${a.dealId}/asking-price`, await token(b.subject, b))).status).toBe(404);
  });
});
