import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { ReportsService } from '../reports/reports.service';

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


async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '));
  return pages.join('\n');
}

describe('investment committee (T-118)', () => {
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
      documents: { objectStore: new InMemoryObjectStore() },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    ids['lead'] = a.userId;
    tokens['lead_b'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['ANALYST', 'TARGET_CONTRIBUTOR', 'VIEWER'] as const) {
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


  const ic = async (who: string) => (await call(who, 'GET', deal('/ic'))).body as unknown as {
    state: string;
    required: boolean;
    committee: { userId: string; source: string }[];
    submissions: { id: string; version: number; reportId: string; decision: { decision: string } | null; conditions: { id: string; status: string }[] }[];
    canSubmit: boolean;
    canDecide: boolean;
  };
  const icMember = async (label: string) => {
    const member = await addSyntheticDealMember(db.owner, a, 'VIEWER');
    // Off the pact until a submission seats them: on the organization's committee list instead.
    await db.owner.query(`DELETE FROM deal_memberships WHERE user_id = $1`, [member.userId]);
    tokens[label] = await token(member.subject, a.auth0OrganizationId);
    ids[label] = member.userId;
    return member;
  };

  it('the organization puts people on its committee; a submission seats them and makes IC pack v1', async () => {
    await icMember('ic');
    expect((await call('analyst', 'PUT', '/v1/organization/ic/members/' + ids['ic'], { member: true })).status).toBe(403);
    expect((await call('lead', 'PUT', '/v1/organization/ic/members/' + ids['ic'], { member: true })).status, 'the synthetic lead is an org owner').toBe(200);
    expect((await call('analyst', 'POST', deal('/ic/submissions'))).status).toBe(403);
    const submitted = await call('lead', 'POST', deal('/ic/submissions'));
    expect(submitted.status, submitted.text).toBe(201);
    await app.get(ReportsService, { strict: false }).whenIdle();
    const view = await ic('lead');
    expect(view.state).toBe('SUBMITTED');
    expect(view.submissions[0]).toMatchObject({ version: 1, decision: null });
    expect(view.committee).toEqual([expect.objectContaining({ userId: ids['ic'], source: 'ORGANIZATION' })]);
    const seated = await db.owner.query(`SELECT role::text FROM deal_memberships WHERE deal_id = $1 AND user_id = $2`, [a.dealId, ids['ic']]);
    expect(seated.rows).toEqual([{ role: 'INVESTMENT_COMMITTEE' }]);
    // A second submission waits for the decision on the first.
    expect((await call('lead', 'POST', deal('/ic/submissions'))).status).toBe(409);
    const pdf = await call('lead', 'GET', `/v1/reports/${view.submissions[0]!.reportId}/pdf`);
    expect(pdf.status).toBe(200);
  });

  it('terms are negotiated while the committee deliberates', async () => {
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


  it('with approval required, the buyer cannot sign until the committee approves; the seller is never told why', async () => {
    expect((await call('lead', 'PUT', deal('/ic/requirement'), { required: true })).status).toBe(200);
    await call('lead', 'PUT', deal('/signatories/BUYER'), { userId: ids['lead']! });
    await call('target_contributor', 'PUT', deal('/signatories/SELLER'), { userId: ids['target_contributor']! });
    const close = (await call('lead', 'GET', deal('/close'))).body as { agreed: { batchId: string }; missing: string[] };
    expect(close.missing).toEqual(expect.arrayContaining([expect.stringMatching(/^Investment committee approval/)]));
    const sellerClose = (await call('target_contributor', 'GET', deal('/close'))).body as { missing: string[] };
    expect(JSON.stringify(sellerClose)).not.toMatch(/committee/i);
    const refused = await call('lead', 'POST', deal(`/terms/${close.agreed.batchId}/signoff`));
    expect(refused).toMatchObject({ status: 422, body: { code: 'IC_APPROVAL_REQUIRED' } });
  });

  it('only a committee member decides, once; a decline is kept and a revised pack is reconsidered', async () => {
    const first = (await ic('lead')).submissions[0]!;
    expect((await call('lead', 'POST', deal(`/ic/submissions/${first.id}/decision`), { decision: 'APPROVE', note: 'Looks fine.' })).status).toBe(403);
    expect((await call('ic', 'POST', deal(`/ic/submissions/${first.id}/decision`), { decision: 'APPROVE_WITH_CONDITIONS', note: 'Missing conditions.' })).status).toBe(400);
    const declined = await call('ic', 'POST', deal(`/ic/submissions/${first.id}/decision`), { decision: 'DECLINE', note: 'Price too high for the customer concentration we found.' });
    expect(declined.status, declined.text).toBe(201);
    expect((await ic('lead')).state).toBe('DECLINED');
    expect((await call('ic', 'POST', deal(`/ic/submissions/${first.id}/decision`), { decision: 'APPROVE', note: 'Changed my mind.' })).status).toBe(409);
    // Revise and resubmit: v2; v1 and its decline stay on the record.
    expect((await call('lead', 'POST', deal('/ic/submissions'))).status).toBe(201);
    await app.get(ReportsService, { strict: false }).whenIdle();
    const second = (await ic('ic')).submissions;
    expect(second.map((row) => [row.version, row.decision?.decision ?? null])).toEqual([[2, null], [1, 'DECLINE']]);
    expect((await ic('ic')).canDecide).toBe(true);
    const approved = await call('ic', 'POST', deal(`/ic/submissions/${second[0]!.id}/decision`), { decision: 'APPROVE_WITH_CONDITIONS', note: 'Approved at the revised price.', conditions: ['Key-person retention agreements signed before completion'] });
    expect(approved.status, approved.text).toBe(201);
    expect((await ic('lead')).state).toBe('CONDITIONS_OPEN');
  });

  it('once the conditions are addressed, signing proceeds', async () => {
    const view = await ic('lead');
    const condition = view.submissions[0]!.conditions[0]!;
    expect((await call('target_contributor', 'POST', deal(`/ic/conditions/${condition.id}/address`), { note: null })).status).toBe(403);
    expect((await call('analyst', 'POST', deal(`/ic/conditions/${condition.id}/address`), { note: 'Signed by all three (synthetic).' })).status).toBe(200);
    expect((await ic('lead')).state).toBe('APPROVED');
    const close = (await call('lead', 'GET', deal('/close'))).body as { agreed: { batchId: string }; missing: string[] };
    expect(close.missing.some((line) => line.startsWith('Investment committee'))).toBe(false);
    expect((await call('lead', 'POST', deal(`/terms/${close.agreed.batchId}/signoff`))).status).toBe(201);
  });

  it('the seller sees no committee anywhere: no IC view, no packs, nothing in their report', async () => {
    expect((await call('target_contributor', 'GET', deal('/ic'))).status).toBe(403);
    const visible = (await call('target_contributor', 'GET', `/v1/reports?dealId=${a.dealId}`)).body['items'] as unknown[];
    expect(visible).toEqual([]);
    const pack = (await ic('lead')).submissions[0]!.reportId;
    expect((await call('target_contributor', 'GET', `/v1/reports/${pack}/pdf`)).status).toBe(404);
    // The buyer's ordinary pact report: invisible to the seller as well (the T-110 leak this task fixes).
    const buyerReport = (await call('lead', 'POST', '/v1/reports', { scope: 'PACT', dealId: a.dealId })).body as { id: string };
    await app.get(ReportsService, { strict: false }).whenIdle();
    expect((await call('target_contributor', 'GET', `/v1/reports/${buyerReport.id}/pdf`)).status).toBe(404);
    const buyerPdf = await call('lead', 'GET', `/v1/reports/${buyerReport.id}/pdf`);
    expect(await pdfText(buyerPdf.raw)).toContain('Investment committee');
    // The seller's own report has no committee in it.
    const own = (await call('target_contributor', 'POST', '/v1/reports', { scope: 'PACT', dealId: a.dealId })).body as { id: string };
    await app.get(ReportsService, { strict: false }).whenIdle();
    const sellerPdf = await call('target_contributor', 'GET', `/v1/reports/${own.id}/pdf`);
    expect(sellerPdf.status).toBe(200);
    expect(await pdfText(sellerPdf.raw)).not.toMatch(/committee/i);
    const rows = await db.owner.query(`SELECT action FROM audit_events WHERE action LIKE 'ic.%' GROUP BY action ORDER BY action`);
    expect((rows.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining(['ic.condition_addressed', 'ic.decided', 'ic.member_seated', 'ic.pack_generated', 'ic.submitted', 'ic.requirement_set']));
  });
});
