import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, pdfOf, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  status: string;
  direction: number | null;
  pricedRisk: { low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null; commitSha: string | null }[];
};

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
type PackMetricsBody = {
  calculator: string;
  metrics: { key: string; value: string | null; history?: { period: string; value: string | null }[] }[];
  history?: { years: string[]; rows: { key: string; values: (string | null)[] }[]; coverage: { key: string; summary: string }[]; asks: { needs: string[]; note: string }[] };
};
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-058 and T-159 acceptance: pactlab-demo-data/fintech/<CURRENCY> loaded into a fresh fintech deal
 * through the real APIs — billing, the loan tape, AML alerts, the processor exports, the licence
 * register, the three-year P&L and every document — surfaces the folder's planted findings as cited
 * drafts: the T-058 three, and (a) a deck TPV that double-counts one processor month, (b) a state
 * licence that lapsed four months ago, (c) the latest quarter's chargeback rate over the sponsor
 * agreement's threshold, and (d) fraud losses growing faster than revenue across three years, which
 * a single year misses. The priced drag reaches a valuation run; the Payments view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('fintech pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('FINTECH', currency, { dataClasses: { '01-balance-sheet-2026-09-30.md': 'FINANCIAL' } });
    // An HR file with a look-alike clause must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('The Bank may terminate this program on a change of control of the employer. Licence number MT-IL-30981 expires on 31 December 2099.').toString('base64'),
      dataClass: 'HR',
    });
    expect(hr.status).toBe(201);
    // The P&L by year (FY2021–FY2025, T-184), years across the columns, line kinds confirmed by a person.
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 5 } });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('every planted finding surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await runRules();
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'FINTECH', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(12);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-058, unchanged.
    const credit = byTitle['Allowance below observed loss experience'];
    expect(credit).toMatchObject({ domain: 'FINANCIAL', status: 'DRAFT', direction: -1 });
    expect(credit?.pricedRisk?.currency).toBe(currency);
    const allowance = deal.readme.match(/allowance \(([A-Z]{3} [0-9,]+)\)/)?.[1];
    expect(credit?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe(`Allowance for credit losses: ${allowance}`);
    expect(byTitle['Alerts closed without review evidence']).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    const bank = byTitle['Partner bank can terminate on change of control'];
    expect(bank?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2 });
    expect(bank?.evidence[0]?.documentCitation?.quote).toMatch(/^22\.3 The Bank may terminate/);

    // (a) The deck's TPV double-counts one processor month: contradicted, cited to the deck and the exports.
    const tpv = byTitle['Claim contradicted: Total payment volume'];
    expect(tpv).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(tpv?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^Total payment volume \(TPV\), twelve months to September 2026: [A-Z]{3} [\d,]+\.$/);
    expect(tpv?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['Claim verified: TPV growth']?.direction).toBe(1);
    expect(byTitle['Claim verified: Take rate']?.direction).toBe(1);
    expect(byTitle['Claim not verified: Retention']?.direction).toBe(0);
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { statement: string; status: string; origin: string }[];
    const tpvClaim = claims.find((claim) => claim.statement.startsWith('Total payment volume'));
    expect(tpvClaim).toMatchObject({ status: 'CONTRADICTED', origin: 'PACK_RULE' });
    expect(claims.filter((claim) => claim.origin === 'PACK_RULE').map((claim) => claim.status).sort()).toEqual(['CONTRADICTED', 'UNVERIFIED', 'VERIFIED', 'VERIFIED']);

    // (b) The lapsed state licence: the register says active; the licence document's expiry governs. Not a legal conclusion.
    const lapsed = Object.values(byTitle).find((finding) => finding.title.startsWith('Lapsed: '));
    expect(lapsed).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    expect(lapsed?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/expires on 31 May 2026\.$/);
    expect(Object.values(byTitle).filter((finding) => finding.title.startsWith('Lapsed: '))).toHaveLength(1);

    // (c) The latest quarter's chargeback rate breaches the sponsor agreement's threshold, cited to clause 8.2.
    const chargebacks = byTitle['Chargeback rate breaches the stated threshold, 2026-Q3'];
    expect(chargebacks).toMatchObject({ domain: 'REGULATORY', direction: -1 });
    expect(chargebacks?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 3 });
    expect(chargebacks?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^8\.2 The Program Manager shall keep the chargeback ratio/);

    // (d) Fraud losses outpace revenue across FY2021–FY2025, cited to the imported P&L rows.
    const fraud = byTitle['Fraud losses growing faster than revenue, 2021–2025'];
    expect(fraud).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(fraud?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(5);
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    // (e) Five years of the processor export (T-184): the take rate falls every year, cited to the export's rows.
    const take = byTitle['Effective take rate falling every year, FY2021–FY2025'];
    expect(take).toMatchObject({ domain: 'FINANCIAL', status: 'DRAFT', direction: -1, pricedRisk: null });
    expect(take?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    // The HR look-alike was never read.
    expect(Object.keys(byTitle).filter((title) => title.startsWith('Partner bank'))).toHaveLength(1);
  });

  it('the Payments view recomputes volume, reads the licences, loss rates and compliance evidence, and every P&L year with its file', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/fintech`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & { volume: Body & { trailing: Body }; licences: { state: string; licenceId: string }[]; compliance: { kind: string; present: boolean }[]; thresholds: { measure: string; breached: boolean }[]; trend: { years: { year: string; files: { fileName: string }[] }[] }; reconciliation: { years: { year: string; reconciles: boolean }[] } };
    expect(body).toMatchObject({ version: 'fintech-payments-1', currency, analysisDate: '2026-09-30', canRunChecks: true });
    expect(body.volume.trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [], rows: 24 });
    expect(body.licences.filter((licence) => licence.state === 'LAPSED')).toHaveLength(1);
    expect(body.compliance.map((entry) => [entry.kind, entry.present])).toEqual([['PCI_ATTESTATION', true], ['AML_PROGRAM', true], ['REGULATORY_EXAM', true]]);
    expect(body.thresholds.map((entry) => [entry.measure, entry.breached])).toEqual([['CHARGEBACK', true], ['FRAUD', false]]);
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual(['2021', '2022', '2023', '2024', '2025'].map((year) => [year, ['pnl.csv']]));
    // Every calendar year of the export reconciles to the P&L's payments revenue.
    expect(body.reconciliation.years.map((year) => [year.year, year.reconciles])).toEqual(['2021', '2022', '2023', '2024', '2025'].map((year) => [year, true]));
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('fintech-payments');
    expect(metrics.metrics.find((metric) => metric.key === 'licences_lapsed')?.value).toBe('1');
    // Five years side by side (T-184), hand-computed from the export: Σ net revenue ÷ Σ volume for each calendar year.
    const rows = readFileSync(join(deal.folder, 'processor-volume.csv'), 'utf8').trim().split('\n').slice(1).map((line) => line.split(','));
    const takeOf = (year: string) => {
      const inYear = rows.filter((row) => row[0]?.startsWith(year));
      const sum = (index: number) => inYear.reduce((total, row) => total + BigInt(Math.round(Number(row[index]) * 100)), 0n);
      return (Math.round(Number((sum(4) * 100_000_000n) / sum(2)) / 100) / 1_000_000).toFixed(6);
    };
    expect(metrics.history?.years).toEqual(['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
    expect(metrics.history?.rows.find((row) => row.key === 'take_rate')?.values).toEqual(['2021', '2022', '2023', '2024', '2025'].map(takeOf));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(metrics.metrics.find((metric) => metric.key === 'take_rate')?.history?.map((point) => point.period)).toEqual(['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/fintech`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/fintech`, 'other')).status).toBe(404);
  });

  it('accepting the priced drag reaches a valuation run as an adjustment', async () => {
    const credit = (await findings()).find((finding) => finding.title === 'Allowance below observed loss experience');
    const id = credit?.id ?? '';
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Loss rate checked against the tape' })).status).toBe(201);
    const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Allowance is short of observed losses' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '1000000.00', multiple: '5' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: id, point: 'HIGH' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const lines = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result.bridge.lines;
    const line = lines.find((entry) => entry.kind === 'FINDING_ADJUSTMENT');
    expect(line?.findingId).toBe(id);
    const [whole = '0', fraction = ''] = (credit?.pricedRisk?.high ?? '').split('.');
    expect(line?.amount.amount).toBe(`-${whole}.${fraction.padEnd(2, '0')}`);
  });

  it('a withdrawn P&L leaves the trend: the view reads no years and a single-year re-import reads one', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/fintech`, 'lead')).body as { trend: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    // One year alone still imports and reads as one year; nothing new about fraud is drafted from it.
    const single = 'Line,FY2025\nPayment processing revenue,100000.00\nFraud losses,2000.00\n';
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', single);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: { 'Payment processing revenue': 'REVENUE', 'Fraud losses': 'OPEX' } };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const one = (await deal.call('GET', `/v1/deals/${deal.dealId}/fintech`, 'lead')).body as { trend: { years: { year: string }[] } };
    expect(one.trend.years.map((year) => year.year)).toEqual(['2025']);
    const rerun = await runRules();
    expect(rerun.status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Fraud losses growing faster'))).toHaveLength(1);
    // Partial history (T-184): one year of income and expenses states its coverage and asks the seller for the rest.
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('FY2025 (1 of 5 years): ask the seller for FY2021–FY2024 income statements, or tell us the business started later');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2024 income statements, or tell us the business started later.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
