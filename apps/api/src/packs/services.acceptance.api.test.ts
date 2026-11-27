import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, type AcceptanceDeal, acceptAndValue, type Body, centsOf, csvRows, HISTORY_YEARS as YEARS, type PackMetricsBody, ratioOf, startAcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  version: number;
  direction: number | null;
  description: string;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-063 and T-167 acceptance: pactlab-demo-data/professional-services/<CURRENCY> loaded into a fresh deal
 * through the real APIs — billing, timesheets, headcount movements, time and billing, the WIP and debtor
 * ageing reports, the five-year P&L and every document — surfaces the folder's planted findings as cited
 * drafts: the T-063 three, and (a) the top client at 27% of fees against the deck's 15% ceiling, a
 * contradicted claim; (b) realization falling across the five years, which a single year misses; (c)
 * two rainmakers with no non-solicit on file; and (d) WIP over 90 days doubled in a year, priced into
 * working capital. The priced WIP drift reaches a valuation run; the Practice view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('professional services pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('PROFESSIONAL_SERVICES', currency);
    // The P&L by year (FY2021–FY2025, T-184b), years across the columns, line kinds confirmed by a person.
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
    expect(run.body).toMatchObject({ pack: 'PROFESSIONAL_SERVICES', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(14);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-063, unchanged.
    const [, reported, measured] = deal.readme.match(/reports ([0-9.]+%); `timesheets-summary.csv` gives ([0-9.]+%)/) ?? [];
    const utilization = byTitle['Utilization below the reported level'];
    expect(utilization).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(utilization?.description).toContain(`reports ${reported} utilization; timesheets give ${measured} billable`);
    const [, client, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 revenue/) ?? [];
    const termination = byTitle['Largest client terminable for convenience'];
    expect(termination).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(termination?.description).toContain(`${client} is ${share} of September 2026 revenue`);
    expect(termination?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/sixty days. written notice/) });
    expect(byTitle['Rising attrition in delivery roles']?.description).toMatch(/^Monthly delivery leavers rose from 1 in October 2025 to 4 in September 2026/);

    // (a) The top client at 27% of fees against the deck's 15% ceiling: contradicted, cited to the memorandum and the export.
    const ceiling = byTitle['Claim contradicted: Client concentration ceiling'];
    expect(ceiling).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(ceiling?.description).toMatch(/Meridian Retail Group \(synthetic\), the largest client, carried 2[67]\.[0-9]% of the fees billed/);
    expect(ceiling?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe('A diversified book: no client exceeds 15% of fees.');
    expect(ceiling?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['Claim verified: Partner concentration ceiling']?.direction).toBe(1);
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { status: string; origin: string }[];
    expect(claims.filter((entry) => entry.origin === 'PACK_RULE').map((entry) => entry.status).sort()).toEqual(['CONTRADICTED', 'VERIFIED']);

    // (b) Realization falling across the five years.
    const realization = byTitle['Realization falling every year, 2021–2025'];
    expect(realization).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(realization?.description).toMatch(/2021 95\.0% .*2022 93\.5% .*2023 92\.0% .*2024 87\.0% .*2025 81\.0%/);
    // (e) Five years of timesheets (T-184b): utilization falls every year, cited to the timesheet rows.
    const utilizationTrend = byTitle['Utilization falling every year, FY2021–FY2025'];
    expect(utilizationTrend).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(utilizationTrend?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);

    // (c) Two rainmakers with no non-solicit on file, cited to the covenant register's sentence.
    for (const ref of ['P-01', 'P-02']) {
      const rainmaker = byTitle[`Rainmaker with no non-solicit or non-compete on file: ${ref}`];
      expect(rainmaker, ref).toMatchObject({ domain: 'PEOPLE', direction: -1, pricedRisk: null });
      expect(rainmaker?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^P-01 and P-02: no non-compete or non-solicitation covenant/);
    }
    expect(Object.keys(byTitle).some((title) => /: P-0[345]$/.test(title))).toBe(false);

    // (d) WIP over 90 days doubled in a year, priced into working capital in the pact's currency.
    const wip = byTitle['WIP over 90 days up 2.1× in a year, 2024–2025'];
    expect(wip).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(wip?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency });
    expect(Object.keys(byTitle).some((title) => title.startsWith('Debtors over 90 days'))).toBe(false);

    expect(Object.values(byTitle).find((finding) => finding.title.startsWith('Revenue quality: '))).toMatchObject({ direction: 0 });
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    expect(byTitle['WIP and bad-debt write-offs growing faster than revenue, 2021–2025']).toMatchObject({ direction: -1 });
  });

  it('the Practice view recomputes fees, realization, books and ageing, reads the covenant register and every P&L year with its file', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/services`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      fees: { trailing: Body; utilization: Body | null };
      partners: { key: string; rainmaker: boolean; coverage: string }[];
      years: { year: string; realization: string }[];
      reconciliation: { years: { year: string; reconciles: boolean }[] };
      ageing: { ledger: string; years: { year: string }[] }[];
      trend: { years: { year: string; files: { fileName: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'services-practice-1', currency, canRunChecks: true, partnerBasis: 'RELATIONSHIP_PARTNER', documentsRead: true });
    expect(body.fees.trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(body.fees.utilization).toMatchObject({ months: 12 });
    expect(body.partners.map((partner) => [partner.key, partner.rainmaker, partner.coverage])).toEqual([
      ['P-01', true, 'STATED_NONE'],
      ['P-02', true, 'STATED_NONE'],
      ['P-03', true, 'COVERED'],
      ['P-04', true, 'COVERED'],
      ['P-05', false, 'NOT_IN_EVIDENCE'],
    ]);
    expect(body.years.map((year) => [year.year, year.realization])).toEqual([['2021', '0.9500'], ['2022', '0.9350'], ['2023', '0.9200'], ['2024', '0.8700'], ['2025', '0.8100']]);
    expect(body.reconciliation.years.map((year) => [year.year, year.reconciles])).toEqual(YEARS.map((year) => [year, true]));
    expect(body.ageing.map((ledger) => [ledger.ledger, ledger.years.map((year) => year.year)])).toEqual([['ar', ['2023', '2024', '2025']], ['wip', ['2023', '2024', '2025']]]);
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual(YEARS.map((year) => [year, ['pnl.csv']]));
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('services-practice');
    // Five years side by side (T-184b), hand-computed from the timesheets: Σ billable ÷ Σ available hours by year.
    const timesheets = csvRows(deal.folder, 'timesheets-summary.csv');
    const utilizationOf = (year: string) => {
      const inYear = timesheets.filter((row) => row[0]?.startsWith(year));
      return ratioOf(centsOf(inYear, 4), centsOf(inYear, 3));
    };
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.find((row) => row.key === 'utilization')?.values).toEqual(YEARS.map(utilizationOf));
    expect(metrics.history?.rows.find((row) => row.key === 'realization')?.values).toEqual(['0.9500', '0.9350', '0.9200', '0.8700', '0.8100']);
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(Number(metrics.metrics.find((metric) => metric.key === 'largest_client_share')?.value)).toBeCloseTo(0.27, 1);
    expect(Number(metrics.metrics.find((metric) => metric.key === 'realization')?.value)).toBeCloseTo(0.8, 1);
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/services`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/services`, 'other')).status).toBe(404);
  });

  it('accepted, the priced WIP drift reaches a valuation run', async () => {
    const wip = (await findings()).find((finding) => finding.title.startsWith('WIP over 90 days'));
    const lines = await acceptAndValue(deal, { id: wip?.id ?? '', version: wip?.version ?? 1 });
    const [whole = '0', fraction = ''] = (wip?.pricedRisk?.low ?? '').split('.');
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: wip?.id, amount: { amount: `-${whole}.${fraction.padEnd(2, '0')}` } });
  });

  it('a withdrawn P&L leaves the trend: the view reads no years and the reconciliation reads none', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/services`, 'lead')).body as { trend: { years: unknown[] }; reconciliation: { years: unknown[] }; years: unknown[] };
    expect(after.trend.years).toEqual([]);
    expect(after.reconciliation.years).toEqual([]);
    // Realization by year still reads from the billing export.
    expect(after.years).toHaveLength(5);
    // Partial history (T-184b): no income and expenses; the coverage says so and the seller is asked for them.
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('No income and expenses imported yet: ask the seller for FY2021–FY2025 income statements, or tell us the business started later');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2025 income statements, or tell us the business started later.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
