import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
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
  seller: { name: 'Harbor Software Inc.', ownership: 'PUBLIC', ticker: 'hrbr', exchange: 'NASDAQ', companyType: 'SOFTWARE_SAAS' },
};

describe('Start a Pact through the API', () => {
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

  async function call(method: 'GET' | 'POST' | 'PATCH', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}` },
      ...(payload ? { payload } : {}),
    });
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

  it('creates the deal, both parties, the lead membership and the audit event together', async () => {
    const lead = await token(a.subject, a);
    const started = await call('POST', '/v1/pacts', lead, PACT);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ name: 'Project Harbor', targetName: 'Harbor Software Inc.', transactionType: 'TAKE_PRIVATE' });
    const dealId = started.body['id'] as string;

    const parties = await call('GET', `/v1/deals/${dealId}/parties`, lead);
    expect(parties.status).toBe(200);
    expect(parties.body).toMatchObject({ transactionType: 'TAKE_PRIVATE', derivedTransactionType: 'TAKE_PRIVATE' });
    expect((parties.body['items'] as Body[]).map((party) => [party['role'], party['name'], party['ticker'], party['companyType']])).toEqual([
      ['BUYER', 'Alpha Capital', null, null],
      ['SELLER', 'Harbor Software Inc.', 'HRBR', 'SOFTWARE_SAAS'],
    ]);

    const members = await call('GET', `/v1/deals/${dealId}/members`, lead);
    expect(members.body['items']).toEqual([expect.objectContaining({ userId: a.userId, role: 'DEAL_LEAD' })]);
    const audit = (await db.owner.query(`SELECT action, outcome FROM audit_events WHERE deal_id = $1`, [dealId])) as { rows: Body[] };
    expect(audit.rows).toContainEqual({ action: 'pact.started', outcome: 'SUCCEEDED' });

    const list = await call('GET', '/v1/deals', lead);
    const listed = (list.body['items'] as Body[]).find((deal) => deal['id'] === dealId);
    expect(listed?.['parties']).toEqual([
      { role: 'BUYER', name: 'Alpha Capital', ownership: 'PRIVATE', ticker: null },
      { role: 'SELLER', name: 'Harbor Software Inc.', ownership: 'PUBLIC', ticker: 'HRBR' },
    ]);
  });

  it.each([
    ['a public company without a ticker', { ...PACT, buyer: { name: 'Big Co', ownership: 'PUBLIC' } }],
    ['a seller without a company type', { ...PACT, seller: { name: 'X', ownership: 'PRIVATE' } }],
    ['an unknown company type', { ...PACT, seller: { ...PACT.seller, companyType: 'MINING' } }],
    ['an empty buyer name', { ...PACT, buyer: { name: ' ', ownership: 'PRIVATE' } }],
    ['unexpected fields', { ...PACT, transactionType: 'PUBLIC_ACQUIRER' }],
  ])('rejects %s and creates nothing', async (_label, payload) => {
    const before = (await db.owner.query(`SELECT count(*)::int AS n FROM deals`)) as { rows: { n: number }[] };
    expect((await call('POST', '/v1/pacts', await token(a.subject, a), payload)).status).toBe(400);
    const after = (await db.owner.query(`SELECT count(*)::int AS n FROM deals`)) as { rows: { n: number }[] };
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('drops ticker and exchange for a private company', async () => {
    const started = await call('POST', '/v1/pacts', await token(a.subject, a), {
      ...PACT,
      name: 'Project Quiet',
      seller: { ...PACT.seller, ownership: 'PRIVATE' },
    });
    expect(started.body['transactionType']).toBe('PRIVATE_ACQUIRER');
    const parties = await call('GET', `/v1/deals/${started.body['id'] as string}/parties`, await token(a.subject, a));
    expect((parties.body['items'] as Body[])[1]).toMatchObject({ ownership: 'PRIVATE', ticker: null, exchange: null });
  });

  it('activates the software sources and merges existing connections into them', async () => {
    const lead = await token(a.subject, a);
    const dealId = ((await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Plan' })).body['id']) as string;
    await db.owner.query(
      `INSERT INTO connections (id, organization_id, deal_id, provider, display_name, mode, config, created_by, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'github', 'harbor/app (fixture)', 'FIXTURE', '{}'::jsonb, $3, now())`,
      [a.organizationId, dealId, a.userId],
    );
    const plan = await call('GET', `/v1/deals/${dealId}/source-plan`, lead);
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ companyType: 'SOFTWARE_SAAS', packAvailable: true, note: null });
    const sources = plan.body['sources'] as Body[];
    expect(sources.map((source) => [source['kind'], source['providerLabel'], source['status']])).toEqual([
      ['BILLING', 'Stripe', 'NOT_CONNECTED'],
      ['CODE', 'GitHub', 'CONNECTED'],
      ['DELIVERY', 'Jira', 'NOT_CONNECTED'],
      ['DOCUMENTS', 'Data room', 'NOT_CONNECTED'],
    ]);
    expect(sources[1]!['connections']).toEqual([
      expect.objectContaining({ provider: 'github', displayName: 'harbor/app (fixture)', mode: 'FIXTURE', lastSyncStatus: null }),
    ]);
    expect(sources[0]!['methods']).toEqual([
      { method: 'API', availability: 'NEXT' },
      { method: 'UPLOAD', availability: 'AVAILABLE' },
    ]);
    expect(sources[1]!['methods']).toEqual([{ method: 'API', availability: 'AVAILABLE' }]);
    expect(sources[1]!['upload']).toBeNull();
  });

  it('labels a planned industry honestly', async () => {
    const lead = await token(a.subject, a);
    const dealId = (
      await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Pill', seller: { ...PACT.seller, companyType: 'PHARMA_BIOTECH' } })
    ).body['id'] as string;
    const plan = await call('GET', `/v1/deals/${dealId}/source-plan`, lead);
    expect(plan.body).toMatchObject({ companyType: 'PHARMA_BIOTECH', packAvailable: false });
    expect(plan.body['note']).toMatch(/planned/);
  });

  it('falls back to the software sources for a deal that predates Pacts', async () => {
    const plan = await call('GET', `/v1/deals/${a.dealId}/source-plan`, await token(a.subject, a));
    expect(plan.body).toMatchObject({ companyType: null, packAvailable: true });
    expect(await call('GET', `/v1/deals/${a.dealId}/parties`, await token(a.subject, a))).toMatchObject({
      status: 200,
      body: { items: [], derivedTransactionType: null, transactionType: 'PRIVATE_ACQUIRER' },
    });
  });

  it('corrects a party without re-deriving the fixed deal type, and keeps the target name in step', async () => {
    const lead = await token(a.subject, a);
    const dealId = ((await call('POST', '/v1/pacts', lead, { ...PACT, name: 'Project Fix' })).body['id']) as string;
    const updated = await call('PATCH', `/v1/deals/${dealId}/parties/seller`, lead, { ownership: 'PRIVATE', name: 'Harbor Software LLC' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ transactionType: 'TAKE_PRIVATE', derivedTransactionType: 'PRIVATE_ACQUIRER' });
    expect((updated.body['items'] as Body[])[1]).toMatchObject({ name: 'Harbor Software LLC', ownership: 'PRIVATE', ticker: null });
    expect((await call('GET', `/v1/deals/${dealId}`, lead)).body['targetName']).toBe('Harbor Software LLC');

    expect((await call('PATCH', `/v1/deals/${dealId}/parties/buyer`, lead, { ownership: 'PUBLIC' })).status).toBe(400);
    expect((await call('PATCH', `/v1/deals/${dealId}/parties/buyer`, lead, { ownership: 'PUBLIC', ticker: 'alph' })).body['derivedTransactionType']).toBe('PUBLIC_ACQUIRER');
    expect((await call('PATCH', `/v1/deals/${dealId}/parties/broker`, lead, { name: 'x' })).status).toBe(400);
  });

  it('lets viewers and contributors read parties but not change them, and hides them from other tenants', async () => {
    const viewer = await addSyntheticDealMember(db.owner, a, 'VIEWER');
    const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    const lead = await token(a.subject, a);
    await db.owner.query(
      `INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'Alpha Target Software', 'PRIVATE', 'SOFTWARE_SAAS', now())`,
      [a.organizationId, a.dealId],
    );
    for (const subject of [viewer.subject, contributor.subject]) {
      const bearer = await token(subject, a);
      expect((await call('GET', `/v1/deals/${a.dealId}/parties`, bearer)).status).toBe(200);
      expect((await call('PATCH', `/v1/deals/${a.dealId}/parties/seller`, bearer, { name: 'Nope' })).status).toBe(403);
    }
    const outsider = await token(b.subject, b);
    expect((await call('GET', `/v1/deals/${a.dealId}/parties`, outsider)).status).toBe(404);
    expect((await call('GET', `/v1/deals/${a.dealId}/source-plan`, outsider)).status).toBe(404);
    expect((await call('PATCH', `/v1/deals/${a.dealId}/parties/seller`, outsider, { name: 'Hijack' })).status).toBe(404);
    expect((await call('GET', `/v1/deals/${a.dealId}/parties`, lead)).body['items']).toEqual([
      expect.objectContaining({ name: 'Alpha Target Software' }),
    ]);
  });
});
