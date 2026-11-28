import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, type AcceptanceDeal, type Body, centsOf, csvRows, HISTORY_YEARS, type PackMetricsBody, ratioOf, startAcceptanceDeal } from './acceptance-kit';

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
 * T-069 and T-162 acceptance: pactlab-demo-data/hospitals/<CURRENCY> loaded into a fresh deal through the
 * real APIs — billing, the census and payer mix, the filed cost reports, capex by year, the healthcare
 * medical-staff and payer-contract registers reused as they are, the five-year P&L and every document —
 * surfaces the T-069 four and the planted (a) largest payer's contract ending seven months after close,
 * (b) cost-report occupancy contradicting the deck, (c) the capex ratio falling across the P&L years
 * against a modern-plant claim, (d) one department's physicians sharing a lapsed privilege date and (e)
 * admissions falling every year across five years of census (T-184c), as cited drafts. The committed regulatory capex still comes off the price in a payer-mix-adjusted EBITDA run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hospitals pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOSPITALS', currency);
    // The P&L by year (FY2021–FY2025), years across the columns, line kinds confirmed by a person.
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
    expect(run.body).toMatchObject({ pack: 'HOSPITALS', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(13);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The T-069 four, unchanged.
    const [, payer, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 net revenue/) ?? [];
    expect(byTitle['Earnings concentrated in one payer']).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(byTitle['Earnings concentrated in one payer']?.description).toContain(`${payer} is ${share} of September 2026 net revenue`);
    expect(byTitle['Accreditation does not transfer automatically']?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/does not transfer automatically/) });
    expect(byTitle['Key-physician dependence']).toMatchObject({ domain: 'PEOPLE', direction: -1, pricedRisk: null });
    const [, capexCurrency, capex] = deal.readme.match(/— ([A-Z]{3}) ([0-9,]+) committed/) ?? [];
    expect(byTitle['Committed regulatory capex']).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: capexCurrency, high: (capex ?? '').replaceAll(',', '') } });

    // (a) The largest payer's agreement ends seven months after the stated closing, the agreement's own date governing.
    const contract = byTitle['The largest payer’s contract ends 7 months after closing: Government programme A (synthetic)'];
    expect(contract).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(contract?.description).toContain('GPA-2021');
    expect(contract?.description).toContain('DRG case rates');
    expect(contract?.evidence.map((item) => item.documentCitation?.quote).filter(Boolean)).toEqual(
      expect.arrayContaining([expect.stringMatching(/GPA-2021 expires on 31 July 2027/), expect.stringMatching(/target closing date of 31 December 2026/)]),
    );
    // (b) Cost-report occupancy contradicts the deck, recorded in the claims register.
    const occupancy = byTitle['Cost report contradicts the deck: Occupancy'];
    expect(occupancy).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(occupancy?.description).toMatch(/54,420 patient days on 80,300 bed days available, 67\.8%/);
    expect(byTitle['Claim verified: Medicare share of patient days']).toMatchObject({ direction: 1 });
    // (c) The capex ratio falls across the five P&L years against a modern-plant claim, priced at the condition assessment's backlog.
    const plant = byTitle['Capex falling while the deck claims a modern plant, FY2021–2025'];
    expect(plant).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency } });
    expect(plant?.description).toContain('FY2021 7.2%');
    expect(plant?.description).toContain('FY2025 2.8%');
    expect(plant?.evidence.map((item) => item.documentCitation?.quote).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringMatching(/modern, recently renovated plant/), expect.stringMatching(/past their useful lives/)]));
    expect(plant?.evidence.filter((item) => item.evidenceItemId).length).toBeGreaterThan(0);
    // (d) Orthopaedics' four physicians share a lapsed privilege renewal date, the verification document's date governing.
    const privileges = byTitle['Orthopaedics: 4 physicians’ privileges lapsed together on 30 June 2026'];
    expect(privileges).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    expect(privileges?.description).toContain('PH-05, PH-06, PH-07, PH-08');
    // Quality claims mapped to the reporting document; the safety grade nothing reports stays unverified.
    expect(byTitle['Quality claim verified: Overall star rating']).toMatchObject({ direction: 1 });
    expect(byTitle['Quality claim not verified: Hospital safety grade']).toMatchObject({ direction: 0 });
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    // (e) Admissions fall every year across the five census years while revenue rises (T-184c).
    const admissions = byTitle['Admissions falling every year, FY2021–FY2025'];
    expect(admissions).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(admissions?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);

    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { status: string; origin: string }[];
    expect(claims.filter((entry) => entry.origin === 'PACK_RULE').map((entry) => entry.status).sort()).toEqual(['CONTRADICTED', 'UNVERIFIED', 'VERIFIED', 'VERIFIED']);
  });

  it('the calculator reads the cost report, the registers, the census history and capex against every P&L year', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('hospitals-operations');
    const value = (key: string) => metrics.metrics.find((metric) => metric.key === key)?.value;
    expect(value('occupancy')).toBe('0.6777');
    expect(value('medicare_share')).toBe('0.4100');
    expect(value('capex_ratio')).toBe('0.0280');
    expect(value('departments_lapsing_together')).toBe('1');
    expect(value('credentials_lapsed')).toBe('4');
    expect(value('contracts_in_window')).toBe('1');
    expect(value('admissions')).toBe(String(12 * (310 + 260 + 190 + 520)));
    // Five years side by side (T-184c), hand-computed from the exports by calendar year: admissions; the average
    // daily census as patient days ÷ the days in the year; the government programmes' share of net revenue.
    const census = csvRows(deal.folder, 'census.csv');
    const payerMix = csvRows(deal.folder, 'payer-mix.csv');
    const total = (rows: string[][], year: string, index: number) => rows.filter((row) => row[0]?.startsWith(year)).reduce((sum, row) => sum + BigInt(row[index] ?? '0'), 0n);
    const days = (year: string) => (Number(year) % 4 === 0 ? 366n : 365n);
    const inYear = (year: string) => payerMix.filter((row) => row[0]?.startsWith(year));
    expect(metrics.history?.years).toEqual(HISTORY_YEARS.map((year) => `FY${year}`));
    const row = (key: string) => metrics.history?.rows.find((entry) => entry.key === key)?.values;
    expect(row('admissions')).toEqual(HISTORY_YEARS.map((year) => String(total(census, year, 2))));
    expect(row('average_daily_census')).toEqual(HISTORY_YEARS.map((year) => ratioOf(total(census, year, 3), days(year), 1)));
    expect(row('government_share')).toEqual(HISTORY_YEARS.map((year) => ratioOf(centsOf(inYear(year).filter((entry) => /government/i.test(entry[1] ?? '')), 3), centsOf(inYear(year), 3))));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(value('average_daily_census')).toBe(ratioOf(BigInt(12 * (Math.trunc(310 * 4.1) + Math.trunc(260 * 3.2) + Math.trunc(190 * 2.4) + Math.trunc(520 * 3.8))), 365n, 1));
    expect(metrics.metrics.find((metric) => metric.key === 'government_share')?.history?.map((point) => point.period)).toEqual(HISTORY_YEARS.map((year) => `FY${year}`));
  });

  it('accepting the capex takes it off the price in a payer-mix-adjusted EBITDA run', async () => {
    const capex = (await findings()).find((finding) => finding.title === 'Committed regulatory capex');
    const lines = await acceptAndValue(deal, { id: capex?.id ?? '', version: capex?.version ?? 1 }, {
      assumptions: {
        method: 'PAYER_MIX_EBITDA',
        ebitda: '6000000.00',
        netRevenue: '40000000.00',
        multiple: '9',
        payers: [{ payer: 'Government programme A (synthetic)', share: '0.567', rateChange: '-0.02' }],
      },
    });
    expect(lines.find((line) => line.kind === 'ENTERPRISE_VALUE')?.amount.amount).toBe('49917600.00'); // (6,000,000 − 40m × 0.567 × 2%) × 9
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: capex?.id, amount: { amount: `-${capex?.pricedRisk?.low}.00` } });
  });

  it('a single-year P&L cannot show the capex trend; a withdrawn import leaves every trend read', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const fy2025 = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8')
      .trim()
      .split('\n')
      .map((row) => row.split(',').filter((_, index) => index === 0 || index === 5).join(','))
      .join('\n');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', `${fy2025}\n`);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const accounts = fy2025.split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping })).status).toBe(200);
    const rerun = await runRules();
    expect(rerun.status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    // One year reads as one year; the capex check needs the trend, so it drafts nothing new from FY2025 alone.
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Capex'))).toHaveLength(1);
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.metrics.find((metric) => metric.key === 'capex_ratio')?.value).toBe('0.0280');
    // Partial history states its coverage and asks the seller for the missing years.
    expect(metrics.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('FY2025 (1 of 5 years): ask the seller for FY2021–FY2024 income statements, or tell us the business started later');
    expect(metrics.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2024 income statements, or tell us the business started later.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status);
  });
});
