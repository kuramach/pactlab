import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { ReportsService } from '../reports/reports.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
type Plan = {
  id: string | null;
  bidId: string | null;
  firmName: string | null;
  buyerNote: string | null;
  tranches: { id: string; kind: string; amount: string; status: string; buyerNote: string | null; needsDocument: boolean; documented: boolean }[];
  escrow: { status: string; confirmed: boolean; deposit: { proofDocumentId: string | null } | null; dispute: { note: string } | null } | null;
  documents: { id: string; fileName: string; shared: boolean; trancheId: string | null }[];
  posture: { level: string; headline: string; escrow: string | null; coverage: { total: string; against: { price: string; state: string; agreed: boolean } | null }; blockers: string[] };
};
type Financing = { side: string | null; canEdit: boolean; plans: Plan[] };

const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`).toString('base64');

async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '));
  return pages.join('\n');
}

/** T-117 acceptance: the buyer's financing, what the seller sees of it, and that no bidder sees another's. */
describe('buyer financing', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let s: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let saleDeal = '';
  const bids: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, raw: response.rawPayload, text: response.body };
  }
  const deal = (path: string, dealId = a.dealId) => `/v1/deals/${dealId}${path}`;
  const financing = async (who: string, dealId = a.dealId) => (await call(who, 'GET', deal('/financing', dealId))).body as unknown as Financing;
  const close = async (who: string) => (await call(who, 'GET', deal('/close'))).body as { missing: string[]; financing: { headline: string; escrow: string | null; contingency: { met: boolean; dueOn: string } | null } | null };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Funded');
    s = await createSyntheticTenant(db.owner, 'Selling');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      signing: { fixture: true, docusign: null },
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    ids['lead'] = a.userId;
    for (const role of ['TARGET_CONTRIBUTOR', 'VIEWER'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
      ids[role.toLowerCase()] = member.userId;
    }
    tokens['seller_org'] = await token(s.subject, s.auth0OrganizationId);
    await db.owner.query(`INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'TargetCo (synthetic)', 'PRIVATE', 'SOFTWARE_SAAS', now()), (gen_random_uuid(), $1, $2, 'BUYER', 'Funded Capital (synthetic)', 'PRIVATE', NULL, now())`, [a.organizationId, a.dealId]);
    // Terms: the buyer's first version priced from a scenario, with a financing contingency added to the draft.
    expect((await call('lead', 'POST', deal('/valuation/scenarios'), {
      name: 'Base',
      scenarioCase: 'BASE',
      values: { assumptions: { method: 'ARR_MULTIPLE', arr: '1000000.00', multiple: '8' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' } },
    })).status).toBe(201);
    expect((await call('lead', 'POST', deal('/pricing/evaluations'), { persona: 'VALUE_INVESTOR' })).status).toBe(201);
    const drafted = (await call('lead', 'POST', deal('/pricing/terms'))).body as { batches: { id: string }[] };
    ids['batch'] = drafted.batches[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a financing contingency joins the terms with its date, and the seller answers it like any term', async () => {
    expect((await call('target_contributor', 'POST', deal(`/pricing/terms/${ids['batch']!}/financing-contingency`), { amount: '6000000.00', dueOn: '2027-01-31' })).status).toBe(403);
    const added = await call('lead', 'POST', deal(`/pricing/terms/${ids['batch']!}/financing-contingency`), { amount: '6000000.00', dueOn: '2027-01-31', note: 'SBA 7(a) approval' });
    expect(added.status, added.text).toBe(201);
    expect((await call('lead', 'POST', deal(`/pricing/terms/${ids['batch']!}/financing-contingency`), { amount: '1.00', dueOn: '2027-01-31' })).status).toBe(409);
    expect((await call('lead', 'POST', deal(`/pricing/terms/${ids['batch']!}/propose`))).status).toBe(201);
    const proposed = (await call('target_contributor', 'GET', deal('/terms/proposed'))).body['proposed'] as { terms: { ordinal: number; lever: string; dueOn: string | null }[] };
    expect(proposed.terms.find((term) => term.lever === 'FINANCING_CONTINGENCY')).toMatchObject({ dueOn: '2027-01-31' });
    expect(proposed.terms.find((term) => term.lever === 'PURCHASE_PRICE')?.dueOn).toBeNull();
    expect((await call('target_contributor', 'POST', deal('/terms/proposed/responses'), { responses: proposed.terms.map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' })) })).status).toBe(201);
  });

  it('the buyer builds the plan; coverage is checked against the agreed price', async () => {
    expect((await financing('lead')).plans[0]).toMatchObject({ id: null, tranches: [], posture: { level: 'NONE' } });
    expect((await call('lead', 'PUT', deal('/financing'), { commitmentExpectedBy: '2026-11-01', buyerNote: 'Bank relationship: First Synthetic' })).status).toBe(200);
    await call('lead', 'POST', deal('/financing/tranches'), { kind: 'CASH', amount: '2000000.00', currency: 'USD', status: 'PRE_QUALIFIED', label: 'Fund II equity', buyerNote: 'From the LP call on Dec 1' });
    const added = await call('lead', 'POST', deal('/financing/tranches'), { kind: 'SBA_7A', amount: '5000000.00', currency: 'USD', status: 'APPLICATION_SUBMITTED', label: 'SBA 7(a)', buyerNote: 'Lender: First Synthetic Bank' });
    const plan = (added.body as unknown as Financing).plans[0]!;
    expect(plan.tranches.map((tranche) => [tranche.kind, tranche.needsDocument, tranche.documented])).toEqual([['CASH', true, false], ['SBA_7A', true, false]]);
    // The agreed headline price is what the plan must cover; 7m of it is short.
    expect(plan.posture.coverage.against).toMatchObject({ agreed: true, state: 'UNDER' });
    expect(plan.posture.blockers.join(' ')).toContain('Financing covers USD 7,000,000.00 of the agreed price');
    expect(plan.posture.blockers.join(' ')).toContain('expected by 2026-11-01');
    // Not the seller, not a viewer: only the buyer's writers maintain it.
    expect((await call('target_contributor', 'POST', deal('/financing/tranches'), { kind: 'CASH', amount: '1.00', currency: 'USD', status: 'EXPLORING' })).status).toBe(403);
    expect((await call('viewer', 'POST', deal('/financing/tranches'), { kind: 'CASH', amount: '1.00', currency: 'USD', status: 'EXPLORING' })).status).toBe(403);
    expect((await financing('viewer')).plans[0]?.tranches).toHaveLength(2);
  });

  it('documents stay with the buyer until shared, one by one, and sharing is revocable', async () => {
    const plan = (await financing('lead')).plans[0]!;
    const sba = plan.tranches.find((tranche) => tranche.kind === 'SBA_7A')!;
    await call('lead', 'POST', deal('/financing/documents'), { purpose: 'COMMITMENT_LETTER', trancheId: sba.id, fileName: 'sba-letter.pdf', contentType: 'application/pdf', contentBase64: pdf('SBA letter') });
    const both = (await call('lead', 'POST', deal('/financing/documents'), { purpose: 'BUYER_FINANCIALS', trancheId: null, fileName: 'personal-financial-statement.pdf', contentType: 'application/pdf', contentBase64: pdf('PFS') })).body as unknown as Financing;
    expect((await call('lead', 'POST', deal('/financing/documents'), { purpose: 'OTHER', fileName: 'x.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('MZ not a pdf').toString('base64') })).status).toBe(415);
    const [letter, pfs] = both.plans[0]!.documents;
    ids['letter'] = letter!.id;
    ids['pfs'] = pfs!.id;

    // Before sharing, the seller sees the structure and no document at all.
    let seller = (await financing('target_contributor')).plans[0]!;
    expect(seller.documents).toEqual([]);
    expect(seller.tranches.find((tranche) => tranche.kind === 'SBA_7A')?.documented).toBe(false);
    expect((await call('target_contributor', 'GET', deal(`/financing/documents/${letter!.id}`))).status).toBe(404);
    await call('lead', 'PUT', deal(`/financing/documents/${letter!.id}/sharing`), { shared: true });
    seller = (await financing('target_contributor')).plans[0]!;
    expect(seller.documents.map((document) => document.fileName)).toEqual(['sba-letter.pdf']);
    expect(seller.tranches.find((tranche) => tranche.kind === 'SBA_7A')?.documented).toBe(true);
    const download = await call('target_contributor', 'GET', deal(`/financing/documents/${letter!.id}`));
    expect(download.status).toBe(200);
    expect(download.raw.subarray(0, 5).toString()).toBe('%PDF-');
    // The buyer's own financials never reach the seller, and the sharing can be taken back.
    expect((await call('target_contributor', 'GET', deal(`/financing/documents/${pfs!.id}`))).status).toBe(404);
    await call('lead', 'PUT', deal(`/financing/documents/${letter!.id}/sharing`), { shared: false });
    expect((await call('target_contributor', 'GET', deal(`/financing/documents/${letter!.id}`))).status).toBe(404);
    await call('lead', 'PUT', deal(`/financing/documents/${letter!.id}/sharing`), { shared: true });
    // Buyer-only notes are never in the seller's view.
    expect(JSON.stringify(seller)).not.toMatch(/First Synthetic|LP call|Bank relationship/);
    expect(seller.buyerNote).toBeNull();
    const audits = await db.owner.query(`SELECT action FROM audit_events WHERE deal_id = $1 AND action LIKE 'financing.document_%' ORDER BY occurred_at`, [a.dealId]);
    expect(audits.rows.map((row) => (row as { action: string }).action)).toEqual(expect.arrayContaining(['financing.document_shared', 'financing.document_unshared', 'financing.document_read']));
    // Another organization reads nothing of it.
    expect((await call('seller_org', 'GET', deal('/financing'))).status).toBe(404);
  });

  it('earnest money: committed, deposited with shared proof, confirmed or disputed by the seller, then disposed', async () => {
    expect((await call('lead', 'PUT', deal('/financing/escrow'), { amount: '250000.00', currency: 'USD', holderKind: 'TITLE_COMPANY', holderName: 'Synthetic Title Co.', depositDueOn: '2026-11-20', hardOn: '2026-12-15', refundConditions: 'Refundable until the hard date if diligence fails.' })).status).toBe(200);
    expect((await call('lead', 'POST', deal('/financing/escrow/deposit'), { depositedOn: '2026-11-14', reference: 'WIRE-1', proofDocumentId: ids['pfs'] })).body['code']).toBe('FINANCING_PROOF_NOT_SHARED');
    const receipt = (await call('lead', 'POST', deal('/financing/documents'), { purpose: 'ESCROW_RECEIPT', trancheId: null, fileName: 'escrow-receipt.pdf', contentType: 'application/pdf', contentBase64: pdf('receipt') })).body as unknown as Financing;
    const receiptId = receipt.plans[0]!.documents.find((document) => document.fileName === 'escrow-receipt.pdf')!.id;
    await call('lead', 'PUT', deal(`/financing/documents/${receiptId}/sharing`), { shared: true });
    expect((await call('lead', 'POST', deal('/financing/escrow/deposit'), { depositedOn: '2026-11-14', reference: 'WIRE-1', proofDocumentId: receiptId })).status).toBe(200);
    expect((await call('lead', 'PUT', deal(`/financing/documents/${receiptId}/sharing`), { shared: false })).body['code']).toBe('FINANCING_PROOF_IN_USE');

    const planId = (await financing('target_contributor')).plans[0]!.id!;
    expect((await close('lead')).missing).toContain('Earnest money: the seller confirms the deposit.');
    // The seller disputes; the buyer records again; the seller confirms.
    expect((await call('target_contributor', 'POST', deal(`/financing/plans/${planId}/escrow/dispute`), { note: 'Not received by the title company.' })).status).toBe(200);
    expect((await financing('lead')).plans[0]!.escrow).toMatchObject({ status: 'COMMITTED', dispute: { note: 'Not received by the title company.' } });
    expect((await call('lead', 'POST', deal(`/financing/plans/${planId}/escrow/confirm`))).status).toBe(403);
    await call('lead', 'POST', deal('/financing/escrow/deposit'), { depositedOn: '2026-11-15', reference: 'WIRE-2', proofDocumentId: receiptId });
    expect((await call('target_contributor', 'POST', deal(`/financing/plans/${planId}/escrow/confirm`))).status).toBe(200);
    const seller = (await financing('target_contributor')).plans[0]!;
    expect(seller.posture.escrow).toBe('Earnest USD 250,000.00 deposited, hard after 2026-12-15');
    expect(seller.escrow?.deposit?.proofDocumentId).toBe(receiptId);
    // The buyer cannot record money as released to the seller; the seller cannot record it refunded.
    expect((await call('lead', 'POST', deal('/financing/escrow/disposition'), { disposition: 'RELEASED_TO_SELLER' })).status).toBe(403);
    expect((await call('target_contributor', 'POST', deal(`/financing/plans/${planId}/escrow/disposition`), { disposition: 'REFUNDED_TO_BUYER' })).status).toBe(403);
    expect((await close('target_contributor')).missing).toContain('Earnest money: record it applied against the price at close.');
  });

  it('the close checklist carries the contingency and the gaps ahead of the funds, until the financing is in place', async () => {
    let view = await close('target_contributor');
    expect(view.financing?.contingency).toMatchObject({ dueOn: '2027-01-31', met: false });
    expect(view.missing).toContain('Financing contingency: the buyer’s financing in place by 2027-01-31.');
    expect(view.missing.some((line) => line.startsWith('Financing: Financing covers'))).toBe(true);
    // The lender commits, the plan grows to the price: the contingency is met and the gaps clear.
    const plan = (await financing('lead')).plans[0]!;
    const sba = plan.tranches.find((tranche) => tranche.kind === 'SBA_7A')!;
    const price = plan.posture.coverage.against!.price;
    const cash = plan.tranches.find((tranche) => tranche.kind === 'CASH')!;
    await call('lead', 'PUT', deal(`/financing/tranches/${sba.id}`), { kind: 'SBA_7A', amount: '5000000.00', currency: 'USD', status: 'COMMITMENT_ISSUED', label: 'SBA 7(a)', buyerNote: 'Lender: First Synthetic Bank' });
    const rest = (Number(price) - 5_000_000).toFixed(2);
    await call('lead', 'PUT', deal(`/financing/tranches/${cash.id}`), { kind: 'CASH', amount: rest, currency: 'USD', status: 'PRE_QUALIFIED', label: 'Fund II equity', buyerNote: '' });
    await call('lead', 'POST', deal('/financing/escrow/disposition'), { disposition: 'APPLIED_AT_CLOSE' });
    view = await close('target_contributor');
    expect(view.financing).toMatchObject({ contingency: { met: true }, escrow: 'Earnest USD 250,000.00 applied against the price at close' });
    expect(view.financing?.headline).toMatch(/^Commitment issued/);
    expect(view.missing.filter((line) => /Financing|Earnest/.test(line))).toEqual([]);
    const audits = await db.owner.query(`SELECT 1 FROM audit_events WHERE deal_id = $1 AND action = 'financing.tranche_advanced'`, [a.dealId]);
    expect(audits.rows.length).toBe(1);
  });

  it('the seller’s pact report carries the financing posture, and none of the buyer’s confidential layer', async () => {
    const started = await call('target_contributor', 'POST', '/v1/reports', { scope: 'PACT', dealId: a.dealId });
    expect(started.status, started.text).toBe(202);
    await app.get(ReportsService, { strict: false }).whenIdle();
    const text = await pdfText((await call('target_contributor', 'GET', `/v1/reports/${started.body['id'] as string}/pdf`)).raw);
    expect(text).toContain('Buyer financing');
    expect(text).toContain('Commitment issued');
    expect(text).toContain('document-backed');
    for (const secret of ['First Synthetic', 'LP call', 'personal-financial-statement', 'Bank relationship']) expect(text, secret).not.toContain(secret);
  });

  it('in a seller-led sale, each bidder keeps their own plan; the seller compares them; no bidder sees another', async () => {
    const started = await call('seller_org', 'POST', '/v1/pacts', { name: 'Project Harbor', baseCurrency: 'USD', initiatedBy: 'SELLER', seller: { name: 'Harborline Inc.', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' } });
    saleDeal = started.body['id'] as string;
    tokens['seller_org'] = await token(s.subject, s.auth0OrganizationId);
    for (const firm of ['North', 'South']) {
      const added = await call('seller_org', 'POST', deal('/bids', saleDeal), { firmName: `${firm} Capital` });
      bids[firm] = added.body['id'] as string;
      const userId = newId();
      const subject = `auth0|bidder-${firm}-${userId.slice(-6)}`;
      await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, subject, `${firm} partner`, `${firm.toLowerCase()}@bidder.example`]);
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), s.organizationId, userId]);
      await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5)`, [newId(), s.organizationId, saleDeal, userId, bids[firm]]);
      tokens[firm] = await token(subject, s.auth0OrganizationId);
      await call(firm, 'POST', deal('/my-bid/nda', saleDeal));
      await call(firm, 'POST', deal('/my-bid/offers', saleDeal), { price: firm === 'North' ? '9000000' : '8500000', currency: 'USD', structure: 'Cash at close', conditions: null, validUntil: null });
    }
    const north = await call('North', 'POST', deal('/financing/tranches', saleDeal), { kind: 'CONVENTIONAL_DEBT', amount: '9000000.00', currency: 'USD', status: 'COMMITMENT_ISSUED', label: 'Senior debt', buyerNote: 'North lender: Synthetic Bank A' });
    expect(north.status, north.text).toBe(200);
    const northDoc = (await call('North', 'POST', deal('/financing/documents', saleDeal), { purpose: 'COMMITMENT_LETTER', trancheId: null, fileName: 'north-commitment.pdf', contentType: 'application/pdf', contentBase64: pdf('north') })).body as unknown as Financing;
    const northDocId = northDoc.plans[0]!.documents[0]!.id;
    await call('North', 'PUT', deal(`/financing/documents/${northDocId}/sharing`, saleDeal), { shared: true });
    await call('South', 'POST', deal('/financing/tranches', saleDeal), { kind: 'SBA_7A', amount: '6000000.00', currency: 'USD', status: 'EXPLORING', label: '', buyerNote: '' });

    // Each bidder sees only their own plan, priced against their own offer.
    const southView = await financing('South', saleDeal);
    expect(southView.plans).toHaveLength(1);
    expect(southView.plans[0]).toMatchObject({ bidId: bids['South'], firmName: 'South Capital', posture: { level: 'EARLY', coverage: { against: { price: '8500000.00', state: 'UNDER' } } } });
    expect(JSON.stringify(southView)).not.toMatch(/North|Senior debt|north-commitment/);
    // South cannot reach North's document, even shared, nor North's plan.
    expect((await call('South', 'GET', deal(`/financing/documents/${northDocId}`, saleDeal))).status).toBe(404);
    const rows = await db.owner.query(`SELECT count(*)::int AS n FROM financing_plans WHERE deal_id = $1`, [saleDeal]);
    expect((rows.rows[0] as { n: number }).n).toBe(2);
    // The seller compares bidders: structure, status and coverage, shared documents only, no buyer notes.
    const sellerView = await financing('seller_org', saleDeal);
    expect(sellerView.side).toBe('SELLER');
    expect(sellerView.plans.map((plan) => [plan.firmName, plan.posture.level])).toEqual([['North Capital', 'COMMITTED'], ['South Capital', 'EARLY']]);
    expect(sellerView.plans[0]?.documents.map((document) => document.fileName)).toEqual(['north-commitment.pdf']);
    expect(JSON.stringify(sellerView)).not.toContain('Synthetic Bank A');
    expect((await call('seller_org', 'GET', deal(`/financing/documents/${northDocId}`, saleDeal))).status).toBe(200);
    // The seller never writes a bidder's plan.
    expect((await call('seller_org', 'POST', deal('/financing/tranches', saleDeal), { kind: 'CASH', amount: '1.00', currency: 'USD', status: 'EXPLORING' })).status).toBe(403);
  });
});
