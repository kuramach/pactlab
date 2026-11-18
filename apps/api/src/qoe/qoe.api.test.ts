import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { QOE_ADD_BACK_EVIDENCE_TYPE, QOE_ADJUSTMENT_EVIDENCE_TYPE, QOE_DISCLAIMER, qoeDirectionFor } from '@pactlab/domain';
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

const FINANCIALS = [
  'Income statement FY2025 (synthetic)',
  'EBITDA as reported: 1,200,000',
  'Owner salary paid: 400,000; market rate for the role: 250,000',
  'Rent paid to the owner’s property company: 60,000 below market',
].join('\n');
const CIM = [
  'Confidential information memorandum (synthetic)',
  'Add-back: one-time legal settlement 80,000',
  'Add-back: discretionary owner bonus 100,000',
].join('\n');
const LEDGER = ['General ledger extract (synthetic)', 'Legal settlement, case closed in March 2025: 80,000'].join('\n');
const MONTHS = [
  ['2026-06-30', '300,000', '120,000'],
  ['2026-07-31', '360,000', '120,000'],
  ['2026-08-31', '420,000', '130,000'],
  ['2026-09-30', '330,000', '110,000'],
] as const;
const BALANCE_SHEETS = MONTHS.map(([date, receivables, payables]) => `Balance sheet at ${date} (synthetic)\nAccounts receivable ${date}: ${receivables}\nAccounts payable ${date}: ${payables}`).join('\n');

/** T-135 acceptance: the three-part QoE work product, cited, with unverified add-backs out until a reviewer includes them. */
describe('quality of earnings through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};
  const docs: Record<string, string> = {};

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, raw: response.rawPayload };
  }
  const qoe = (path = '') => `/v1/deals/${a.dealId}/qoe${path}`;
  const upload = async (fileName: string, text: string, dataClass: string) =>
    (await call('lead', 'POST', `/v1/deals/${a.dealId}/documents`, { fileName, contentType: 'text/plain', contentBase64: Buffer.from(text).toString('base64'), dataClass })).body['id'] as string;
  const cite = (doc: string, quote: string) => ({ documentId: docs[doc], pageNumber: 1, quote });
  const count = async (sql: string, params: unknown[] = []) => ((await db.owner.query(sql, params)) as { rows: { n: number }[] }).rows[0]?.n;
  async function pdfText(bytes: Buffer): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '));
    return pages.join('\n').replace(/\s+/g, ' ');
  }
  async function report(who: string): Promise<string> {
    const started = await call(who, 'POST', '/v1/reports', { scope: 'PACT', dealId: a.dealId });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    await app.get(ReportsService, { strict: false }).whenIdle();
    const download = await call(who, 'GET', `/v1/reports/${started.body['id'] as string}/pdf`);
    expect(download.status).toBe(200);
    return pdfText(download.raw);
  }
  type View = {
    schedule: { period: string; adjustedEbitda: string | null; sellerAdjustedEbitda: string | null; totals: Body; flags: string[] }[];
    register: { entryKey: string; label: string; status: string; counts: boolean; counted: string; findingId: string | null; version: number }[];
    workingCapital: { average: string | null; peg: { amount: string; derivation: string } | null; drivers: { component: string }[]; low: Body; high: Body };
    entries: { entryKey: string; kind: string; findingId: string | null; citation: { valid: boolean; documentName: string } }[];
    canDecide: boolean;
    disclaimer: string;
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const store = new InMemoryObjectStore();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      foresightAutoBaseline: false,
      documents: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);
    docs['financials'] = await upload('income-statement-fy2025.txt', FINANCIALS, 'FINANCIAL');
    docs['cim'] = await upload('cim.txt', CIM, 'FINANCIAL');
    docs['ledger'] = await upload('general-ledger.txt', LEDGER, 'FINANCIAL');
    docs['balance'] = await upload('monthly-balance-sheets.txt', BALANCE_SHEETS, 'FINANCIAL');
    docs['hr'] = await upload('bonus-plan.txt', 'Owner bonus 100,000 for named staff (synthetic)', 'HR');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('records entries only with a quote that is really on the page, in the base currency, by the buyer side', async () => {
    const reported = { kind: 'REPORTED_EBITDA', period: 'FY2025', label: 'EBITDA as reported', amount: '1,200,000', currency: 'USD', citation: cite('financials', 'EBITDA as reported: 1,200,000') };
    expect((await call('analyst', 'POST', qoe('/entries'), { ...reported, citation: cite('financials', 'EBITDA as reported: 9,999,999') })).body).toMatchObject({ status: 422, code: 'QUOTE_NOT_FOUND' });
    expect((await call('analyst', 'POST', qoe('/entries'), { ...reported, currency: 'EUR' })).body).toMatchObject({ status: 422, code: 'CURRENCY_MISMATCH' });
    expect((await call('analyst', 'POST', qoe('/entries'), { ...reported, citation: cite('hr', 'Owner bonus 100,000') })).body).toMatchObject({ status: 422, code: 'PEOPLE_DATA' });
    expect((await call('analyst', 'POST', qoe('/entries'), { ...reported, kind: 'ADJUSTMENT', category: 'SELLER_FAVOURITE', rationale: 'x y z' })).status).toBe(400);
    expect((await call('reviewer', 'POST', qoe('/entries'), reported)).status).toBe(403);
    expect((await call('target_contributor', 'GET', qoe())).status).toBe(403);
    expect((await call('other', 'GET', qoe())).status).toBe(404);
    expect((await call('analyst', 'POST', qoe('/entries'), reported)).status).toBe(201);
  });

  it('produces the schedule and register: every line cited, unverified add-backs out, said and observed apart', async () => {
    const runsBefore = await count(`SELECT count(*)::int AS n FROM valuation_runs WHERE deal_id = $1`, [a.dealId]);
    await call('analyst', 'POST', qoe('/entries'), { kind: 'ADJUSTMENT', period: 'FY2025', category: 'OWNER_COMPENSATION', label: 'Owner salary to market', amount: '150000', currency: 'USD', rationale: 'Owner paid 400,000 against a 250,000 market rate.', citation: cite('financials', 'Owner salary paid: 400,000; market rate for the role: 250,000') });
    await call('analyst', 'POST', qoe('/entries'), { kind: 'ADJUSTMENT', period: 'FY2025', category: 'RENT_NORMALIZATION', label: 'Related-party rent to market', amount: '-60000', currency: 'USD', rationale: 'Rent to the owner’s company is below market.', citation: cite('financials', 'Rent paid to the owner’s property company: 60,000 below market') });
    await call('analyst', 'POST', qoe('/entries'), { kind: 'ADD_BACK', period: 'FY2025', category: 'NON_RECURRING', label: 'Legal settlement', amount: '80000', currency: 'USD', rationale: 'One-time settlement, case closed.', recurrence: 'ONE_OFF', verificationStatus: 'VERIFIED', verificationCitation: cite('ledger', 'Legal settlement, case closed in March 2025: 80,000'), citation: cite('cim', 'Add-back: one-time legal settlement 80,000') });
    const bonus = await call('analyst', 'POST', qoe('/entries'), { kind: 'ADD_BACK', period: 'FY2025', category: 'OWNER_COMPENSATION', label: 'Owner bonus', amount: '100000', currency: 'USD', rationale: 'Discretionary, will not recur.', recurrence: 'ONE_OFF', verificationStatus: 'UNVERIFIED', citation: cite('cim', 'Add-back: discretionary owner bonus 100,000') });
    expect(bonus.status).toBe(201);
    const view = bonus.body as unknown as View;
    expect(view.disclaimer).toBe(QOE_DISCLAIMER);
    expect(view.schedule[0]).toMatchObject({ period: 'FY2025', adjustedEbitda: '1370000.00', sellerAdjustedEbitda: '1380000.00', totals: { adjustments: '90000.00', addBacksCounted: '80000.00', addBacksClaimed: '180000.00', addBacksExcluded: '100000.00' } });
    expect(view.register.find((line) => line.label === 'Owner bonus')).toMatchObject({ status: 'UNVERIFIED', counts: false, counted: '0.00' });
    expect(view.entries.every((entry) => entry.citation.valid)).toBe(true);

    // Every adjustment and add-back is a cited DRAFT finding with the direction the QoE rules propose, unpriced.
    const drafted = view.entries.filter((entry) => entry.kind === 'ADJUSTMENT' || entry.kind === 'ADD_BACK');
    expect(drafted).toHaveLength(4);
    const findings = (await db.owner.query(`SELECT f.id, f.title, f.status, f.direction, f.priced_risk_low, (SELECT count(*)::int FROM finding_evidence_links l WHERE l.finding_id = f.id AND l.document_citation IS NOT NULL) AS cited FROM findings f WHERE f.deal_id = $1 AND f.fingerprint LIKE 'qoe:%'`, [a.dealId])).rows as { id: string; title: string; status: string; direction: number; priced_risk_low: string | null; cited: number }[];
    expect(new Set(findings.map((row) => row.id))).toEqual(new Set(drafted.map((entry) => entry.findingId)));
    const direction = (title: string) => findings.find((row) => row.title.includes(title))?.direction;
    expect(direction('Owner salary to market')).toBe(qoeDirectionFor(QOE_ADJUSTMENT_EVIDENCE_TYPE, 'increases-ebitda').defaultDirection);
    expect(direction('Related-party rent')).toBe(qoeDirectionFor(QOE_ADJUSTMENT_EVIDENCE_TYPE, 'reduces-ebitda').defaultDirection);
    expect(direction('Owner bonus')).toBe(qoeDirectionFor(QOE_ADD_BACK_EVIDENCE_TYPE, 'UNVERIFIED').defaultDirection);
    expect(direction('Legal settlement')).toBe(qoeDirectionFor(QOE_ADD_BACK_EVIDENCE_TYPE, 'VERIFIED').defaultDirection);
    expect(findings.every((row) => row.status === 'DRAFT' && row.priced_risk_low === null && row.cited >= 1)).toBe(true);
    // Nothing reached valuation on its own: no run was made.
    expect(await count(`SELECT count(*)::int AS n FROM valuation_runs WHERE deal_id = $1`, [a.dealId])).toBe(runsBefore);
  });

  it('an unverified add-back stays out until a reviewer explicitly includes it, and the inclusion is recorded', async () => {
    const before = (await call('reviewer', 'GET', qoe())).body as unknown as View;
    const bonus = before.register.find((line) => line.label === 'Owner bonus')!;
    expect(before.canDecide).toBe(true);
    expect((await call('analyst', 'POST', qoe(`/entries/${bonus.entryKey}/decision`), { decision: 'INCLUDE', reason: 'Seems fine', expectedVersion: bonus.version })).status).toBe(403);
    expect((await call('reviewer', 'POST', qoe(`/entries/${bonus.entryKey}/decision`), { decision: 'INCLUDE', expectedVersion: bonus.version })).status).toBe(400);
    const decided = await call('reviewer', 'POST', qoe(`/entries/${bonus.entryKey}/decision`), { decision: 'INCLUDE', reason: 'Board minutes record the bonus as discretionary and one-off.', expectedVersion: bonus.version });
    expect(decided.status).toBe(200);
    const view = decided.body as unknown as View;
    expect(view.register.find((line) => line.label === 'Owner bonus')).toMatchObject({ status: 'UNVERIFIED', counts: true, counted: '100000.00', version: bonus.version + 1 });
    expect(view.schedule[0]!.adjustedEbitda).toBe('1470000.00');
    expect(await count(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'qoe.add_back_included' AND outcome = 'SUCCEEDED' AND deal_id = $1`, [a.dealId])).toBe(1);
    const stored = (await db.owner.query(`SELECT inclusion, decision_reason FROM qoe_entries WHERE entry_key = $1 ORDER BY version`, [bonus.entryKey])).rows as { inclusion: string | null; decision_reason: string | null }[];
    expect(stored).toEqual([{ inclusion: null, decision_reason: null }, { inclusion: 'INCLUDE', decision_reason: 'Board minutes record the bonus as discretionary and one-off.' }]);
    // A stale version is refused; excluding again is recorded the same way.
    expect((await call('reviewer', 'POST', qoe(`/entries/${bonus.entryKey}/decision`), { decision: 'EXCLUDE', reason: 'Changed my mind', expectedVersion: bonus.version })).status).toBe(409);
  });

  it('analyses working capital from the cited balance sheets and puts the peg on the draft terms, never the bridge', async () => {
    for (const [date, receivables, payables] of MONTHS) {
      expect((await call('analyst', 'POST', qoe('/entries'), { kind: 'WORKING_CAPITAL', periodEnd: date, category: 'RECEIVABLES', label: 'Accounts receivable', amount: receivables, currency: 'USD', citation: cite('balance', `Accounts receivable ${date}: ${receivables}`) })).status).toBe(201);
      expect((await call('analyst', 'POST', qoe('/entries'), { kind: 'WORKING_CAPITAL', periodEnd: date, category: 'PAYABLES', label: 'Accounts payable', amount: payables, currency: 'USD', citation: cite('balance', `Accounts payable ${date}: ${payables}`) })).status).toBe(201);
    }
    const view = (await call('lead', 'GET', qoe())).body as unknown as View;
    expect(view.workingCapital).toMatchObject({ average: '232500.00', low: { periodEnd: '2026-06-30', amount: '180000.00' }, high: { periodEnd: '2026-08-31', amount: '290000.00' }, peg: { amount: '232500.00' } });
    expect(view.workingCapital.drivers[0]?.component).toBe('RECEIVABLES');

    // No open buyer draft yet: draft terms first.
    expect((await call('lead', 'POST', qoe('/peg-term'))).status).toBe(409);
    const deal = (path: string) => `/v1/deals/${a.dealId}${path}`;
    expect((await call('lead', 'POST', deal('/valuation/scenarios'), {
      name: 'Base',
      scenarioCase: 'BASE',
      values: { assumptions: { method: 'ARR_MULTIPLE', arr: '1000000.00', multiple: '8' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' } },
    })).status).toBe(201);
    expect((await call('lead', 'POST', deal('/pricing/evaluations'), { persona: 'VALUE_INVESTOR' })).status).toBe(201);
    const batchId = ((await call('lead', 'POST', deal('/pricing/terms'))).body as { batches: { id: string }[] }).batches[0]!.id;
    const runs = await count(`SELECT count(*)::int AS n FROM valuation_runs WHERE deal_id = $1`, [a.dealId]);
    const bridge = await db.owner.query(`SELECT id, result FROM valuation_runs WHERE deal_id = $1 ORDER BY id`, [a.dealId]);
    expect((await call('reviewer', 'POST', qoe('/peg-term'))).status).toBe(403);
    const added = await call('lead', 'POST', qoe('/peg-term'));
    expect(added.body).toMatchObject({ batchId, amount: '232500.00', currency: 'USD' });
    const term = (await db.owner.query(`SELECT lever, amount::text, seller_note, finding_id FROM term_proposals WHERE batch_id = $1 AND lever = 'WORKING_CAPITAL_PEG'`, [batchId])).rows[0] as { lever: string; amount: string; seller_note: string; finding_id: string | null };
    expect(term).toMatchObject({ lever: 'WORKING_CAPITAL_PEG', amount: '232500.00', finding_id: null });
    expect(term.seller_note).toContain('÷ 4 = USD 232500.00');
    // One peg per version.
    expect((await call('lead', 'POST', qoe('/peg-term'))).status).toBe(409);
    // The peg is a term only: no valuation run was made or changed.
    expect(await count(`SELECT count(*)::int AS n FROM valuation_runs WHERE deal_id = $1`, [a.dealId])).toBe(runs);
    expect((await db.owner.query(`SELECT id, result FROM valuation_runs WHERE deal_id = $1 ORDER BY id`, [a.dealId])).rows).toEqual(bridge.rows);
  });

  it('renders as a pact-report section for the buyer side only', async () => {
    const text = await report('lead');
    expect(text).toContain('Quality of earnings (platform-prepared analysis)');
    expect(text).toContain('Pactlab is not a quality-of-earnings firm');
    expect(text).toContain('Adjusted EBITDA schedule · FY2025');
    expect(text).toContain('Add-back register');
    expect(text).toContain('USD 1,470,000');
    expect(text).toContain('Seller-adjusted EBITDA (as claimed)');
    expect(text).toContain('unverified');
    expect(text).toContain('Board minutes record the bonus');
    expect(text).toContain('Proposed peg');
    expect(text).toContain('EBITDA as reported: 1,200,000');

    const seller = await report('target_contributor');
    expect(seller).toContain('Pact report');
    for (const secret of ['Quality of earnings', 'Add-back register', 'Proposed peg', 'Owner bonus']) expect(seller, secret).not.toContain(secret);
  });
});
