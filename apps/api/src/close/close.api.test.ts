import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { documentPages } from '../documents/document-text';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

interface Proposed {
  version: number;
  initiatedBySide: string;
  agreedAt: string | null;
  canRespond: boolean;
  canAcceptCounters: boolean;
  terms: { ordinal: number; lever: string; amount: string }[];
}
interface Close {
  me: { side: string | null };
  signatories: Record<'BUYER' | 'SELLER', { userId: string; name: string } | null>;
  agreed: { batchId: string; version: number; signoffs: { side: string; method: string }[]; envelope: { status: string; provider: string } | null } | null;
  items: { id: string; kind: string; ownerSide: string; paid: Body | null; dispute: Body | null; done: Body | null }[];
  esign: { provider: string | null };
  missing: string[];
  closed: { at: string; buyer: string; seller: string } | null;
}

describe('two-sided close (T-107)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: Method, url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, raw: response.rawPayload, text: response.body };
  }
  const deal = (path: string, dealId = a.dealId) => `/v1/deals/${dealId}${path}`;
  const closeView = async (who: string, dealId = a.dealId) => (await call(who, 'GET', deal('/close', dealId))).body as unknown as Close;
  const proposed = async (who: string, dealId = a.dealId) => (await call(who, 'GET', deal('/terms/proposed', dealId))).body['proposed'] as Proposed;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Closer');
    b = await createSyntheticTenant(db.owner, 'Seller-led terms');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      signing: { fixture: true, docusign: null },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    ids['lead'] = a.userId;
    tokens['lead_b'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['ANALYST', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
      ids[role.toLowerCase()] = member.userId;
    }
    const sellerB = await addSyntheticDealMember(db.owner, b, 'TARGET_CONTRIBUTOR');
    tokens['seller_b'] = await token(sellerB.subject, b.auth0OrganizationId);
    // Signatories need addresses for e-signature.
    await db.owner.query(`UPDATE users SET email = 'lead-' || left(id::text, 8) || '@buyer.example' WHERE id = $1`, [a.userId]);
    await db.owner.query(`UPDATE users SET email = 'seller-' || left(id::text, 8) || '@seller.example' WHERE id = $1`, [ids['target_contributor']]);
    for (const tenant of [a, b]) {
      await db.owner.query(`INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'TargetCo (synthetic)', 'PRIVATE', 'SOFTWARE_SAAS', now()), (gen_random_uuid(), $1, $2, 'BUYER', 'Closer Capital (synthetic)', 'PRIVATE', NULL, now())`, [tenant.organizationId, tenant.dealId]);
    }
    // A scenario to price from, then the buyer's first version (headline price first).
    const scenario = await call('lead', 'POST', deal('/valuation/scenarios'), {
      name: 'Base',
      scenarioCase: 'BASE',
      values: { assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' } },
    });
    expect(scenario.status, scenario.text).toBe(201);
    expect((await call('lead', 'POST', deal('/pricing/evaluations'), { persona: 'VALUE_INVESTOR' })).status).toBe(201);
    const drafted = (await call('lead', 'POST', deal('/pricing/terms'))).body as { batches: { id: string }[] };
    expect((await call('lead', 'POST', deal(`/pricing/terms/${drafted.batches[0]!.id}/propose`))).status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('negotiates the headline price: seller counters, buyer revises, seller accepts', async () => {
    const v1 = await proposed('target_contributor');
    expect(v1).toMatchObject({ initiatedBySide: 'BUYER', canRespond: true });
    expect(v1.terms[0]?.lever).toBe('PURCHASE_PRICE');
    const answer = (who: string, responses: Body[]) => call(who, 'POST', deal('/terms/proposed/responses'), { responses });
    expect((await answer('target_contributor', [{ ordinal: 0, decision: 'COUNTER', counterAmount: '61000000.00', note: 'Our floor.' }, ...v1.terms.slice(1).map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' }))])).status).toBe(201);
    // The buyer cannot answer its own version; it takes the counter into v2.
    expect((await answer('lead', [{ ordinal: 0, decision: 'ACCEPT' }])).status).toBe(403);
    const buyerView = await proposed('lead');
    expect(buyerView.canAcceptCounters).toBe(true);
    const pricing = (await call('lead', 'GET', deal('/pricing'))).body as { batches: { id: string; version: number }[] };
    const v1Id = pricing.batches.find((batch) => batch.version === v1.version)!.id;
    const v2 = ((await call('lead', 'POST', deal(`/terms/${v1Id}/accept-counters`))).body as { batches: { id: string; terms: { amount: string }[] }[] }).batches[0]!;
    expect(v2.terms[0]?.amount).toBe('61000000.00');
    await call('lead', 'POST', deal(`/pricing/terms/${v2.id}/propose`));
    const latest = await proposed('target_contributor');
    expect((await answer('target_contributor', latest.terms.map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' })))).status).toBe(201);
    expect((await proposed('lead')).agreedAt).toEqual(expect.any(String));
  });

  it('refuses to close one-sided, and says what is missing', async () => {
    expect((await call('lead', 'PATCH', deal(''), { stage: 'CLOSED' })).status).toBe(409);
    const refused = await call('lead', 'POST', deal('/close'));
    expect(refused.status).toBe(409);
    const view = await closeView('target_contributor');
    expect(view.me.side).toBe('SELLER');
    expect(view.missing).toEqual(expect.arrayContaining(['Name the buyer’s signatory.', 'Name the seller’s signatory.']));
  });

  it('each side names its signatory; both e-sign the term sheet from the buyer’s provider', async () => {
    expect((await call('analyst', 'PUT', deal('/signatories/BUYER'), { userId: ids['analyst']! })).status).toBe(403);
    expect((await call('target_contributor', 'PUT', deal('/signatories/BUYER'), { userId: ids['target_contributor']! })).status).toBe(403);
    expect((await call('lead', 'PUT', deal('/signatories/BUYER'), { userId: ids['target_contributor']! })).status).toBe(422);
    expect((await call('lead', 'PUT', deal('/signatories/BUYER'), { userId: ids['lead']! })).status).toBe(200);
    expect((await call('target_contributor', 'PUT', deal('/signatories/SELLER'), { userId: ids['target_contributor']! })).status).toBe(200);

    const view = await closeView('lead');
    const batchId = view.agreed!.batchId;
    expect(view.esign.provider).toBe('FIXTURE');
    // Only the buyer side sends; only the named signatory signs; in-app sign-off waits while e-signature is out.
    expect((await call('target_contributor', 'POST', deal(`/terms/${batchId}/esign`), {})).status).toBe(403);
    expect((await call('lead', 'POST', deal(`/terms/${batchId}/esign`), {})).status).toBe(201);
    expect((await closeView('lead')).agreed?.envelope).toMatchObject({ provider: 'FIXTURE', status: 'SENT' });
    expect((await call('analyst', 'POST', deal(`/terms/${batchId}/esign/fixture-sign`))).status).toBe(403);
    expect((await call('lead', 'POST', deal(`/terms/${batchId}/signoff`))).status).toBe(409);
    await call('target_contributor', 'POST', deal(`/terms/${batchId}/esign/fixture-sign`));
    expect((await closeView('lead')).agreed?.signoffs).toEqual([]);
    const second = await call('lead', 'POST', deal(`/terms/${batchId}/esign/fixture-sign`));
    expect(second.status, second.text).toBe(201);
    const signed = await closeView('target_contributor');
    expect(signed.agreed?.envelope?.status).toBe('COMPLETED');
    expect(signed.agreed?.signoffs.map((signoff) => [signoff.side, signoff.method]).sort()).toEqual([['BUYER', 'ESIGN'], ['SELLER', 'ESIGN']]);

    // Both sides download the same term sheet; it carries the agreed price and nothing buyer-only.
    const sheet = await call('target_contributor', 'GET', deal(`/terms/${batchId}/term-sheet.pdf`));
    expect(sheet.status).toBe(200);
    const text = (await documentPages({ contentType: 'application/pdf', bytes: new Uint8Array(sheet.raw), text: null })).map((page) => page.text).join('\n');
    expect(text).toContain('Purchase price: USD 61,000,000.00');
    for (const leak of ['persona', 'value investor', 'weight', 'evaluation']) expect(text.toLowerCase()).not.toContain(leak);
    expect(JSON.stringify(signed).toLowerCase()).not.toContain('value_investor');
  });

  it('works the checklist: the buyer records the payment, the seller disputes, then confirms', async () => {
    await call('target_contributor', 'POST', deal('/closing-items'), { kind: 'CONDITION', title: 'Landlord consent to assignment', ownerSide: 'SELLER' });
    await call('lead', 'POST', deal('/closing-items'), { kind: 'FUNDS', title: 'Purchase price at completion', amount: '61000000.00', currency: 'USD' });
    let view = await closeView('lead');
    const condition = view.items.find((item) => item.kind === 'CONDITION')!;
    const funds = view.items.find((item) => item.kind === 'FUNDS')!;
    expect(funds.ownerSide).toBe('SELLER');

    expect((await call('lead', 'POST', deal(`/closing-items/${condition.id}/done`))).status).toBe(403);
    expect((await call('target_contributor', 'POST', deal(`/closing-items/${funds.id}/done`))).status).toBe(409);
    expect((await call('target_contributor', 'POST', deal(`/closing-items/${funds.id}/paid`), { paidOn: '2026-11-07', reference: 'X' })).status).toBe(403);
    expect((await call('lead', 'POST', deal(`/closing-items/${funds.id}/paid`), { paidOn: '2026-11-07', reference: 'WIRE-1' })).status).toBe(201);
    view = await call('target_contributor', 'POST', deal(`/closing-items/${funds.id}/dispute`), { note: 'Not received yet.' }).then((response) => response.body as unknown as Close);
    expect(view.items.find((item) => item.id === funds.id)).toMatchObject({ paid: null, dispute: { note: 'Not received yet.' } });
    await call('lead', 'POST', deal(`/closing-items/${funds.id}/paid`), { paidOn: '2026-11-08', reference: 'WIRE-2' });
    await call('target_contributor', 'POST', deal(`/closing-items/${funds.id}/done`));
    await call('target_contributor', 'POST', deal(`/closing-items/${condition.id}/done`));
    view = await closeView('lead');
    expect(view.items.every((item) => item.done)).toBe(true);
    expect(view.items.find((item) => item.id === funds.id)?.paid).toMatchObject({ on: '2026-11-08', reference: 'WIRE-2' });
    expect(view.missing).toEqual([]);
  });

  it('closes only for the deal lead, recording both approvers', async () => {
    expect((await call('analyst', 'POST', deal('/close'))).status).toBe(403);
    expect((await call('target_contributor', 'POST', deal('/close'))).status).toBe(403);
    const closed = await call('lead', 'POST', deal('/close'));
    expect(closed.status).toBe(201);
    expect((closed.body as unknown as Close).closed).toMatchObject({ at: expect.any(String), buyer: expect.any(String), seller: expect.any(String) });
    expect((await call('lead', 'GET', deal(''))).body).toMatchObject({ stage: 'CLOSED', phase: 'POST' });
    expect((await call('lead', 'POST', deal('/close'))).status).toBe(409);
    const audit = await db.owner.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE deal_id = $1`, [a.dealId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['signatory.named', 'terms.esign_sent', 'terms.esign_completed', 'closing_item.paid', 'closing_item.disputed', 'closing_item.funds_confirmed', 'deal.closed']));
  });

  it('lets the seller propose a version the buyer answers; drafts stay private until proposed', async () => {
    const drafted = await call('seller_b', 'POST', deal('/terms/drafts', b.dealId), {
      currency: 'USD',
      terms: [{ lever: 'PURCHASE_PRICE', amount: '40000000.00', note: 'Asking.' }, { lever: 'ESCROW', amount: '1000000.00', note: '12 months.' }],
    });
    expect(drafted.status, drafted.text).toBe(201);
    const draftId = (drafted.body['draft'] as { id: string }).id;
    expect((await call('lead_b', 'GET', deal('/pricing', b.dealId))).body['batches']).toEqual([]);
    expect((await call('seller_b', 'POST', deal('/terms/drafts', b.dealId), { currency: 'USD', terms: [{ lever: 'ESCROW', amount: '1.00' }] })).status).toBe(422);
    await call('seller_b', 'POST', deal(`/terms/${draftId}/propose`, b.dealId));
    const seen = await proposed('lead_b', b.dealId);
    expect(seen).toMatchObject({ initiatedBySide: 'SELLER', canRespond: true });
    expect((await call('seller_b', 'POST', deal('/terms/proposed/responses', b.dealId), { responses: [{ ordinal: 0, decision: 'ACCEPT' }] })).status).toBe(403);
    await call('lead_b', 'POST', deal('/terms/proposed/responses', b.dealId), { responses: seen.terms.map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' })) });
    expect((await proposed('seller_b', b.dealId)).agreedAt).toEqual(expect.any(String));
  });

  it('refuses webhook events without a valid signature', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/webhooks/signing/docusign', headers: { 'content-type': 'application/json', 'x-docusign-signature-1': 'bm9wZQ==' }, payload: JSON.stringify({ event: 'envelope-completed', data: { envelopeId: '4b7e9a2c-1f3d-4c1a-9b2e-0a1b2c3d4e5f' } }) });
    expect(response.statusCode).toBe(403);
  });
});
