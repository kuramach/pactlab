import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, HISTORY_YEARS as YEARS, startAcceptanceDeal, type AcceptanceDeal, type Body, type PackMetricsBody } from './acceptance-kit';

type FindingView = {
  title: string;
  domain: string;
  direction: number | null;
  description: string;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * pactlab-demo-data/software-saas/<CURRENCY> loaded into a fresh Software & SaaS deal, with five years of billing
 * and the five-year P&L (T-184b): "Run software & saas checks" drafts exactly the six findings the README
 * promises, each cited — the four baseline checks, the P&L trend, and net revenue retention falling every year —
 * and a re-run adds nothing. ARR, retention and logo churn by year match the billing export, computed by hand.
 */
describe.each(ACCEPTANCE_CURRENCIES)('software & saas pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const readme = (pattern: RegExp) => deal.readme.match(pattern)?.slice(1) ?? [];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('SOFTWARE_SAAS', currency);
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 5 } });
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the six planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'SOFTWARE_SAAS', unresolvedQuotes: 0 });
    // The P&L import already ran the checks once (an inline import does); this run adds what is left.
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(6);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 6 });

    const items = (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
    const byTitle = Object.fromEntries(items.map((finding) => [finding.title, finding]));
    const promised = [...deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(Object.keys(byTitle).sort()).toEqual([...promised].sort());
    for (const finding of items) expect(finding.evidence.length, finding.title).toBeGreaterThan(0);

    const [reported, billed] = readme(/the KPI pack reports ([A-Z]{3} [0-9,]+); `invoice-lines\.csv` supports ([A-Z]{3} [0-9,]+)/);
    const arr = byTitle['Management ARR exceeds billed ARR'];
    expect(arr).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(arr?.description).toContain(`Management reports ARR of ${reported}; billing supports ${billed} at September 2026`);
    expect(arr?.description).toContain('Quarry Lane Studios (synthetic), last billed June 2026');

    const [top, share] = readme(/\*\*Revenue concentration\*\* — (.+?) is ([0-9.]+%) of September 2026/);
    expect(byTitle['Revenue concentration']?.description).toContain(`${top} is ${share} of September 2026 revenue`);

    const clause = byTitle['Customer can terminate on change of control'];
    expect(clause).toMatchObject({ domain: 'LEGAL', direction: 0 });
    expect(clause?.evidence.find((link) => link.documentCitation)?.documentCitation?.pageNumber).toBe(2);

    const contraction = byTitle['Contraction hidden in the logo count'];
    expect(contraction?.description).toContain('Amberline Hotels (synthetic) pays');
    expect(contraction?.description).toContain('30.0% below');
    expect(contraction?.description).toContain('Management reports 14 active customers; billing has 13 in September 2026');

    // (e) Five years of billing (T-184b): net revenue retention falls every year, cited to the billing lines.
    const nrr = byTitle['Net revenue retention falling every year, FY2022–FY2025'];
    expect(nrr).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(nrr?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
  });

  it('Finances reads ARR, retention and logo churn by year from the billing export, beside the P&L', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics).toMatchObject({ calculator: 'saas-metrics', metrics: [] });
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    // Hand-computed: every line is a month's billing, so December's revenue by customer is the December lines.
    const lines = readFileSync(join(deal.folder, 'invoice-lines.csv'), 'utf8').trim().split('\n').slice(1).map((line) => line.split(','));
    const december = (year: string) => new Map(lines.filter((row) => row[10] === `${year}-12-01`).map((row) => [row[3] ?? '', BigInt(Math.round(Number(row[7]) * 100))]));
    const cents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
    const ratio = (numerator: bigint, denominator: bigint) => (Number((numerator * 20_000n + denominator) / (2n * denominator)) / 10_000).toFixed(4);
    const arr = YEARS.map((year) => cents([...december(year).values()].reduce((total, value) => total + value, 0n) * 12n));
    const nrr = YEARS.map((year) => {
      if (year === '2021') return null;
      const [before, now] = [december(String(Number(year) - 1)), december(year)];
      const opening = [...before.values()].reduce((total, value) => total + value, 0n);
      const closing = [...before.keys()].reduce((total, customer) => total + (now.get(customer) ?? 0n), 0n);
      return ratio(closing, opening);
    });
    expect(metrics.history?.rows.find((row) => row.key === 'arr')?.values).toEqual(arr);
    expect(metrics.history?.rows.find((row) => row.key === 'nrr')?.values).toEqual(nrr);
    expect(metrics.history?.rows.find((row) => row.key === 'grr')?.values.slice(1).every((value) => value !== null && Number(value) <= 1)).toBe(true);
    expect(metrics.history?.rows.find((row) => row.key === 'logo_churn')?.values[0]).toBeNull();
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 of 5 years)', 'FY2021–FY2025 (5 of 5 years)']);
    expect(metrics.history?.asks).toEqual([]);
  });

  it('partial history states its coverage and asks the seller for the missing years', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('No income and expenses imported yet: ask the seller for FY2021–FY2025 income statements');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2025 income statements.' }]);
  });

  it('is refused to another tenant', async () => {
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
