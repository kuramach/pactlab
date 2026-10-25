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

describe('pact phases through the API (T-071)', { timeout: 30_000 }, () => {
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

  async function call(who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, payload?: unknown, dealId?: string) {
    const response = await app.inject({
      method,
      url: `/v1/deals/${dealId ?? a.dealId}${path}`,
      headers: { authorization: `Bearer ${tokens[who]}` },
      ...(payload ? { payload: payload as Body } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const audits = async (action: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND deal_id = $2`, [action, a.dealId])) as { rows: { n: number }[] }).rows[0]?.n;

  /** A register finding, inserted as fixture data (synthetic). */
  async function finding(input: { title: string; status: string; direction: number | null; valueDriver?: string; pricedRiskType?: string }) {
    const id = newId();
    await db.owner.query(
      `INSERT INTO findings (id, organization_id, deal_id, domain, title, description, severity, confidence, status, origin, fingerprint,
                             direction, value_driver, value_basis, priced_risk_type, priced_risk_currency, priced_risk_low, priced_risk_high, priced_risk_basis,
                             created_by, evidence_version, version, created_at, updated_at)
       VALUES ($1, $2, $3, 'FINANCIAL', $4, 'Synthetic finding', 'MEDIUM', 'HIGH', $5::finding_status, 'HUMAN', $6,
               $7, $8, $13, $9::priced_risk_type, $10, $11, $11, $12, '{"kind":"SYSTEM","component":"test"}', 1, 1, now(), now())`,
      [
        id,
        a.organizationId,
        a.dealId,
        input.title,
        input.status,
        `test:${id}`,
        input.direction,
        input.valueDriver ?? null,
        input.pricedRiskType ?? null,
        input.pricedRiskType ? 'USD' : null,
        input.pricedRiskType ? '50000' : null,
        input.pricedRiskType ? 'Synthetic basis' : null,
        input.valueDriver ? 'Synthetic value basis' : null,
      ],
    );
    return id;
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
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('shows the phase derived from the stage on deal reads', async () => {
    const deal = await app.inject({ method: 'GET', url: `/v1/deals/${a.dealId}`, headers: { authorization: `Bearer ${tokens['lead']}` } });
    expect(deal.json()).toMatchObject({ stage: 'SCREENING', phase: 'PRE' });
  });

  it('screening: light intake, then a GO verdict promotes the deal and turns red flags into claims', async () => {
    const intake = { intakeNotes: 'Teaser received (synthetic).', headlineRevenue: '12,000,000', headlineCurrency: 'USD', valueLow: '40000000', valueHigh: '60000000', redFlags: ['Customer concentration above 30%', 'Founder-led sales'], expectedVersion: 0 };
    expect((await call('target_contributor', 'GET', '/screening')).status).toBe(403);
    expect((await call('other', 'GET', '/screening')).status).toBe(404);
    expect((await call('reviewer', 'PUT', '/screening', intake)).status).toBe(403);
    const saved = await call('analyst', 'PUT', '/screening', intake);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ headlineRevenue: '12000000', valueLow: '40000000', valueHigh: '60000000', version: 1, verdict: null, canDecide: false });
    expect((await call('analyst', 'PUT', '/screening', intake)).status).toBe(409); // stale version
    expect((await call('analyst', 'PUT', '/screening', { ...intake, valueLow: '70000000', expectedVersion: 1 })).status).toBe(400);

    // Only the deal lead decides; NEEDS_MORE requires the gaps.
    expect((await call('analyst', 'POST', '/screening/verdict', { verdict: 'GO', rationale: 'Worth a look' })).status).toBe(403);
    expect((await call('lead', 'POST', '/screening/verdict', { verdict: 'NEEDS_MORE', rationale: 'Thin data' })).body).toMatchObject({ code: 'GAPS_REQUIRED' });
    const more = await call('lead', 'POST', '/screening/verdict', { verdict: 'NEEDS_MORE', rationale: 'Thin data', gaps: 'Need churn by cohort' });
    expect(more.body).toMatchObject({ verdict: 'NEEDS_MORE', gaps: 'Need churn by cohort', stage: 'SCREENING' });

    const go = await call('lead', 'POST', '/screening/verdict', { verdict: 'GO', rationale: 'Range brackets the ask; worth diligence.' });
    expect(go.body).toMatchObject({ verdict: 'GO', stage: 'DILIGENCE', canEdit: false });
    expect((await call('lead', 'POST', '/screening/verdict', { verdict: 'NO_GO', rationale: 'Too late' })).status).toBe(409);
    const deal = await app.inject({ method: 'GET', url: `/v1/deals/${a.dealId}`, headers: { authorization: `Bearer ${tokens['lead']}` } });
    expect(deal.json()).toMatchObject({ stage: 'DILIGENCE', phase: 'DILIGENCE' });

    const claims = (await call('lead', 'GET', '/claims')).body['items'] as Body[];
    expect(claims.map((claim) => [claim['statement'], claim['origin'], claim['status']])).toEqual([
      ['Customer concentration above 30%', 'SCREENING_RED_FLAG', 'UNVERIFIED'],
      ['Founder-led sales', 'SCREENING_RED_FLAG', 'UNVERIFIED'],
    ]);
    expect(await audits('screening.verdict_go')).toBe(1);
    expect(await audits('screening.verdict_needs_more')).toBe(1);
    // Screening is directional only: it created no findings.
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM findings WHERE deal_id = $1`, [a.dealId])).rows).toEqual([{ n: 0 }]);
  });

  it('claims: said vs observed, linked to findings, every change audited', async () => {
    const created = await call('analyst', 'POST', '/claims', { statement: 'ARR grew 40% last year', source: 'CIM p.4' });
    expect(created.status).toBe(201);
    const claim = (created.body['items'] as Body[]).find((item) => item['statement'] === 'ARR grew 40% last year') as Body;
    const findingId = await finding({ title: 'ARR growth overstated', status: 'ACCEPTED', direction: -1, pricedRiskType: 'PRICE_REDUCTION' });

    expect((await call('analyst', 'PUT', `/claims/${claim['id'] as string}`, { expectedVersion: 1, status: 'CONTRADICTED' })).body).toMatchObject({ code: 'RATIONALE_REQUIRED' });
    expect((await call('analyst', 'PUT', `/claims/${claim['id'] as string}`, { expectedVersion: 1, status: 'CONTRADICTED', rationale: 'Rebuilt ARR shows 22%', findingIds: [newId()] })).body).toMatchObject({ code: 'LINK_NOT_FOUND' });
    const contradicted = await call('analyst', 'PUT', `/claims/${claim['id'] as string}`, { expectedVersion: 1, status: 'CONTRADICTED', rationale: 'Rebuilt ARR shows 22%', findingIds: [findingId] });
    expect(contradicted.status).toBe(200);
    const after = (contradicted.body['items'] as Body[]).find((item) => item['id'] === claim['id']);
    expect(after).toMatchObject({ status: 'CONTRADICTED', version: 2, findings: [{ id: findingId, title: 'ARR growth overstated', status: 'ACCEPTED' }] });
    expect((await call('analyst', 'PUT', `/claims/${claim['id'] as string}`, { expectedVersion: 1, status: 'VERIFIED', rationale: 'x' })).status).toBe(409);
    expect(await audits('claim.contradicted')).toBe(1);
    expect((await call('target_contributor', 'GET', '/claims')).status).toBe(403);
    expect((await call('other', 'GET', '/claims')).status).toBe(404);
  });

  it('closing generates the post-close registers from diligence output, once, by reference', async () => {
    const cushion = await finding({ title: 'Engineering ownership spread', status: 'ACCEPTED', direction: 1, valueDriver: 'Engineering continuity' });
    const escrow = await finding({ title: 'Open tax audit', status: 'ACCEPTED', direction: -1, pricedRiskType: 'ESCROW' });
    const open = await finding({ title: 'Licence review pending', status: 'DRAFT', direction: null });
    await finding({ title: 'Rejected claim', status: 'REJECTED', direction: 1 });

    const close = await app.inject({ method: 'PATCH', url: `/v1/deals/${a.dealId}`, headers: { authorization: `Bearer ${tokens['lead']}` }, payload: { stage: 'CLOSED' } });
    expect(close.json()).toMatchObject({ stage: 'CLOSED', phase: 'POST' });
    const view = (await call('lead', 'GET', '/post-close')).body;
    const items = view['items'] as Body[];
    const bySource = (id: string) => items.filter((item) => item['sourceId'] === id).map((item) => item['kind']);
    expect(bySource(cushion)).toEqual(['ASSET']);
    expect(bySource(escrow)).toEqual(['WATCH']);
    expect(bySource(open)).toEqual(['ACTION']);
    expect(items.find((item) => item['sourceId'] === cushion)).toMatchObject({ title: 'Engineering continuity', cadence: 'QUARTERLY', status: 'OPEN' });

    // Generating again (or closing again) adds nothing.
    expect((await call('lead', 'POST', '/post-close/generate')).body).toEqual({ created: 0 });

    // Items are worked: owner, due date, done — each audited.
    const watch = items.find((item) => item['sourceId'] === escrow) as Body;
    const reviewerId = ((view['members'] as Body[]).find((member) => member['displayName'] !== undefined && member['userId'] !== a.userId) as Body)['userId'];
    const done = await call('analyst', 'PUT', `/post-close/${watch['id'] as string}`, { expectedVersion: 1, status: 'DONE', ownerUserId: reviewerId, dueDate: '2027-06-30', note: 'Escrow released' });
    expect(done.status).toBe(200);
    expect((done.body['items'] as Body[]).find((item) => item['id'] === watch['id'])).toMatchObject({ status: 'DONE', dueDate: '2027-06-30', version: 2 });
    expect((await call('analyst', 'PUT', `/post-close/${watch['id'] as string}`, { expectedVersion: 2, status: 'OPEN', ownerUserId: newId() })).body).toMatchObject({ code: 'OWNER_NOT_MEMBER' });
    expect(await audits('post_close.done')).toBe(1);
    expect(await audits('post_close.generated')).toBe(1);
    expect((await call('target_contributor', 'GET', '/post-close')).status).toBe(403);
    expect((await call('other', 'GET', '/post-close')).status).toBe(404);
  });

  it('NO_GO archives a pact with its rationale', async () => {
    const other = await createSyntheticTenant(db.owner, 'Charlie');
    tokens['charlie'] = await token(other.subject, other);
    const noGo = await call('charlie', 'POST', '/screening/verdict', { verdict: 'NO_GO', rationale: 'Ask is twice our range.' }, other.dealId);
    expect(noGo.body).toMatchObject({ verdict: 'NO_GO', rationale: 'Ask is twice our range.', stage: 'SCREENING' });
    const deal = await app.inject({ method: 'GET', url: `/v1/deals/${other.dealId}`, headers: { authorization: `Bearer ${tokens['charlie']}` } });
    expect(deal.json()).toMatchObject({ status: 'ARCHIVED', phase: 'PRE' });
  });
});
