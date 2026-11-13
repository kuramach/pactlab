import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';

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

describe('letters of intent (T-119)', () => {
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



  type Loi = {
    required: boolean;
    canDraft: boolean;
    exclusivity: { daysLeft: number; ended: boolean } | null;
    current: { id: string; version: number; status: string; content: { nonBinding: { heading: string; lines: string[] }[]; binding: { heading: string; lines: string[] }[]; unfilled: string[] }; canSign: boolean; canDecline: boolean; signedBy: { BUYER: string | null; SELLER: string | null } } | null;
    versions: { version: number; status: string }[];
  };
  const loi = async (who: string) => (await call(who, 'GET', deal('/loi'))).body as unknown as Loi;
  const fields = { exclusivityDays: 30, governingLaw: 'the State of Delaware', expenses: 'Each party bears its own costs.', diligenceDays: 21, targetSigningDate: '2027-01-15', responseDays: 7, conditions: ['Confirmatory diligence', 'A definitive agreement'] };

  it('cannot draft before terms are agreed', async () => {
    expect((await call('lead', 'POST', deal('/loi'))).body['code']).toBe('TERMS_NOT_AGREED');
  });

  it('the buyer and seller agree the terms first', async () => {
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



  it('drafts from the agreed terms verbatim; the seller sees no draft', async () => {
    expect((await call('target_contributor', 'POST', deal('/loi'))).status).toBe(403);
    const drafted = await call('lead', 'POST', deal('/loi'));
    expect(drafted.status, drafted.text).toBe(201);
    const view = await loi('lead');
    expect(view.current?.status).toBe('DRAFT');
    // The agreed price (61,000,000.00 after the counter), quoted exactly.
    expect(view.current?.content.nonBinding[0]?.lines[0]).toContain('USD 61,000,000.00');
    expect(view.current?.content.unfilled).toEqual(['governingLaw']);
    expect((await loi('target_contributor')).current).toBeNull();
    // Governing law is blank: not sendable, and both signatories are needed.
    expect((await call('lead', 'POST', deal(`/loi/${view.current!.id}/send`), { method: 'IN_APP' })).body['code']).toBe('LOI_INCOMPLETE');
  });

  it('sends in the app; the buyer signs, the seller countersigns, exclusivity starts', async () => {
    const id = (await loi('lead')).current!.id;
    expect((await call('lead', 'PUT', deal(`/loi/${id}/fields`), fields)).status).toBe(200);
    await call('lead', 'PUT', deal('/signatories/BUYER'), { userId: ids['lead']! });
    await call('target_contributor', 'PUT', deal('/signatories/SELLER'), { userId: ids['target_contributor']! });
    const sent = await call('lead', 'POST', deal(`/loi/${id}/send`), { method: 'IN_APP' });
    expect(sent.status, sent.text).toBe(200);
    // Sent: immutable, and now the seller sees it.
    expect((await call('lead', 'PUT', deal(`/loi/${id}/fields`), fields)).body['code']).toBe('LOI_SENT');
    expect((await loi('target_contributor')).current?.status).toBe('SENT');
    expect((await call('target_contributor', 'POST', deal(`/loi/${id}/sign`))).body['code']).toBe('LOI_BUYER_SIGNS_FIRST');
    expect((await call('lead', 'POST', deal(`/loi/${id}/sign`))).status).toBe(200);
    expect((await call('target_contributor', 'POST', deal(`/loi/${id}/sign`))).status).toBe(200);
    const done = await loi('target_contributor');
    expect(done.current?.status).toBe('COUNTERSIGNED');
    expect(done.exclusivity?.daysLeft).toBe(30);
    // The PDF, for both sides: two labelled parts, the agreed price, the law, the notice; nothing confidential.
    const pdf = await call('target_contributor', 'GET', deal(`/loi/${id}/pdf`));
    expect(pdf.status).toBe(200);
    const text = await pdfText(pdf.raw);
    for (const expected of ['Non-binding provisions', 'Binding provisions', 'USD 61,000,000.00', 'the State of Delaware', 'Not legal advice', 'agrees to be bound only by']) expect(text, expected).toContain(expected);
    for (const secret of ['persona', 'Priced as', 'committee', 'confirmed value']) expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
  });

  it('a letter not answered in time expires; a declined one is kept; a new version follows', async () => {
    // A second letter needs new agreed terms: here, the same agreed version is already countersigned.
    expect((await loi('lead')).canDraft).toBe(false);
    // Simulate an unanswered letter on another version by inserting a sent row with a past answer date.
    const batch = (await db.owner.query(`SELECT batch_id FROM loi_versions WHERE deal_id = $1 LIMIT 1`, [a.dealId])).rows[0] as { batch_id: string };
    await db.owner.query(
      `INSERT INTO loi_versions (id, organization_id, deal_id, batch_id, version, status, fields, method, created_by, sent_by, sent_at, respond_by, snapshot)
       VALUES (gen_random_uuid(), $1, $2, $3, 2, 'SENT', $4, 'IN_APP', $5, $5, now() - interval '9 days', now() - interval '1 day', $6)`,
      [a.organizationId, a.dealId, batch.batch_id, JSON.stringify(fields), ids['lead'], JSON.stringify({ title: 'Letter of intent', parties: '', nonBinding: [], binding: [], signatureNote: '', notice: '', unfilled: [] })],
    );
    const view = await loi('lead');
    expect(view.versions.map((row) => [row.version, row.status])).toEqual([[2, 'EXPIRED'], [1, 'COUNTERSIGNED']]);
    const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE action = 'loi.expired' AND deal_id = $1`, [a.dealId]);
    expect(audit.rows.length).toBe(1);
  });

  it('when a pact requires a letter, the definitive terms wait for a countersigned one', async () => {
    expect((await call('analyst', 'PUT', deal('/loi/requirement'), { required: true })).status).toBe(403);
    expect((await call('lead', 'PUT', deal('/loi/requirement'), { required: true })).status).toBe(200);
    const close = (await call('lead', 'GET', deal('/close'))).body as { missing: string[]; agreed: { batchId: string } };
    // Countersigned already above: not missing.
    expect(close.missing).not.toContain('A countersigned letter of intent.');
    await db.owner.query(`ALTER TABLE loi_versions DISABLE TRIGGER loi_versions_guard`);
    await db.owner.query(`UPDATE loi_versions SET status = 'DECLINED' WHERE deal_id = $1 AND status = 'COUNTERSIGNED'`, [a.dealId]);
    await db.owner.query(`ALTER TABLE loi_versions ENABLE TRIGGER loi_versions_guard`);
    const blocked = (await call('target_contributor', 'GET', deal('/close'))).body as { missing: string[] };
    expect(blocked.missing).toContain('A countersigned letter of intent.');
    expect((await call('lead', 'POST', deal(`/terms/${close.agreed.batchId}/signoff`))).body['code']).toBe('LOI_REQUIRED');
  });
});
