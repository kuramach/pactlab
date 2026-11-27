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
 * T-065 and T-164 acceptance: pactlab-demo-data/ecommerce-dtc/<CURRENCY> loaded into a fresh deal through
 * the real APIs — billing, cohorts, ad spend, orders by channel, the stock report, the five-year P&L and
 * every document — surfaces the folder's planted findings as cited drafts: the T-065 three, and (a) the
 * deck's LTV computed on gross revenue, contradicted by the contribution-margin recompute; (b) 64% of
 * revenue through a marketplace account registered to the founder personally; (c) 22% of stock older than
 * 180 days, priced; and (d) CAC rising and contribution compressing across five years, which a single
 * year misses. The priced stock write-down reaches a valuation run; the Channels view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('e-commerce and DTC pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('ECOMMERCE_DTC', currency);
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
    expect(run.body).toMatchObject({ pack: 'ECOMMERCE_DTC', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(13);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-065, unchanged.
    const [, marketplace, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 revenue/) ?? [];
    const majority = byTitle['Majority of revenue through one marketplace'];
    expect(majority).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(majority?.description).toContain(`${marketplace} is ${share} of September 2026 revenue`);
    expect(majority?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/delist products on thirty days. notice/) });
    expect(byTitle['Repeat purchase declining in recent cohorts']?.description).toMatch(/^Cohorts from July 2025 keep 2[67]\.[0-9]% of customers in their second month, against 3[89]\.[0-9]% for the 3 earlier cohorts/);
    expect(byTitle['Acquisition cost rising on paid social']?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    // (a) The deck's LTV is on gross revenue: contradicted by the contribution recompute, cited to the deck and the exports.
    const ltv = byTitle['Claim contradicted: Customer lifetime value'];
    expect(ltv).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(ltv?.description).toContain('it is computed on gross revenue');
    expect(ltv?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^12-month customer lifetime value \(LTV\): [A-Z]{3} \d+\.$/);
    expect(ltv?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['Claim verified: Paid customer acquisition cost']?.direction).toBe(1);
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { statement: string; status: string; origin: string }[];
    expect(claims.filter((claim) => claim.origin === 'PACK_RULE').map((claim) => claim.status).sort()).toEqual(['CONTRADICTED', 'VERIFIED']);

    // (b) 64% of net sales through a marketplace account the founder holds personally, cited to the account schedule.
    const account = byTitle['Platform account held personally: Marketvale marketplace (MV-20417)'];
    expect(account).toMatchObject({ domain: 'LEGAL', direction: -1 });
    expect(account?.description).toMatch(/^6[34]\.[0-9]% of net sales/);
    expect(account?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^Account MV-20417, the Marketvale seller account, is registered to the founder personally/);

    // (c) 22% of stock older than 180 days, priced as a write-down in the pact's currency.
    const aged = Object.values(byTitle).find((finding) => finding.title.startsWith('Aged inventory: 22.'));
    expect(aged).toMatchObject({ domain: 'OPERATIONAL', direction: -1 });
    expect(aged?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency });

    // (d) CAC rising while contribution compresses, by year, cited to the orders export and the P&L.
    const cac = byTitle['Acquisition cost rising every year, 2021–2025'];
    expect(cac).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(cac?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(3);
    expect(byTitle['Contribution margin compressing every year, 2021–2025']).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(byTitle['Advertising and marketing growing faster than revenue, 2021–2025']).toMatchObject({ direction: -1 });
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    // (e) Five years of the orders export (T-184b): discounts take a larger share of gross sales every year.
    const discounts = byTitle['Discount rate rising every year, FY2021–FY2025'];
    expect(discounts).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(discounts?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
  });

  it('the Channels view recomputes channels and unit economics, reads the accounts and the stock, and every P&L year with its file', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/ecommerce`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      channels: { trailing: Body; byChannel: { channel: string }[] };
      accounts: { account: string; owner: string; material: boolean }[];
      unitEconomics: { cohortValue: Body | null; paid: Body | null };
      inventory: Body | null;
      reconciliation: { years: { year: string; reconciles: boolean }[] };
      trend: { years: { year: string; files: { fileName: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'ecommerce-channels-1', currency, canRunChecks: true });
    expect(body.channels.trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(body.channels.byChannel).toHaveLength(4);
    expect(body.accounts.find((entry) => entry.account === 'MV-20417')).toMatchObject({ owner: 'PERSONAL', material: true });
    expect(body.accounts.find((entry) => entry.account === 'SHOP-5531')).toMatchObject({ owner: 'COMPANY' });
    // Wholesale accounts the documents do not mention: absence is shown as absence.
    expect(body.accounts.filter((entry) => entry.owner === 'UNSTATED').map((entry) => entry.account).sort()).toEqual(['WH-FJORD', 'WH-TRAIL']);
    expect(body.unitEconomics.cohortValue).toMatchObject({ horizon: 12, cohorts: ['2024-10', '2025-01', '2025-04', '2025-07', '2025-10'] });
    expect(body.inventory).toMatchObject({ asOf: '2026-09-30', agedDays: 180 });
    expect(body.reconciliation.years.map((year) => [year.year, year.reconciles])).toEqual(YEARS.map((year) => [year, true]));
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual(YEARS.map((year) => [year, ['pnl.csv']]));
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('ecommerce-channels');
    // Five years side by side (T-184b), hand-computed from the orders export: Σ discounts ÷ Σ gross sales by year.
    const orders = csvRows(deal.folder, 'channel-orders.csv');
    const discountOf = (year: string) => {
      const inYear = orders.filter((row) => row[0]?.startsWith(year));
      return ratioOf(centsOf(inYear, 7), centsOf(inYear, 6));
    };
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.find((row) => row.key === 'discount_rate')?.values).toEqual(YEARS.map(discountOf));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 of 5 years)', 'FY2021–FY2025 (5 of 5 years)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(metrics.metrics.find((metric) => metric.key === 'net_order_value')?.history?.map((point) => point.period)).toEqual(YEARS.map((year) => `FY${year}`));
    expect(Number(metrics.metrics.find((metric) => metric.key === 'stock_aged_share')?.value)).toBeCloseTo(0.22, 2);
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/ecommerce`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/ecommerce`, 'other')).status).toBe(404);
  });

  it('accepted, the priced stock write-down reaches a valuation run', async () => {
    const aged = (await findings()).find((finding) => finding.title.startsWith('Aged inventory: '));
    const lines = await acceptAndValue(deal, { id: aged?.id ?? '', version: aged?.version ?? 1 });
    const [whole = '0', fraction = ''] = (aged?.pricedRisk?.low ?? '').split('.');
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: aged?.id, amount: { amount: `-${whole}.${fraction.padEnd(2, '0')}` } });
  });

  it('a withdrawn P&L leaves the trend: the view reads no years and the reconciliation reads none', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/ecommerce`, 'lead')).body as { trend: { years: unknown[] }; reconciliation: { years: unknown[] }; years: { cac: string | null }[] };
    expect(after.trend.years).toEqual([]);
    expect(after.reconciliation.years).toEqual([]);
    // Contribution by year still reads from the orders export; acquisition cost by year needs the P&L and is shown as missing.
    expect(after.years.every((year) => year.cac === null)).toBe(true);
    // Partial history (T-184b): no income and expenses; the coverage says so and the seller is asked for them.
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('No income and expenses imported yet: ask the seller for FY2021–FY2025 income statements');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2025 income statements.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
