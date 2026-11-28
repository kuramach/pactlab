import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, type AcceptanceDeal, type Body, type PackMetricsBody, startAcceptanceDeal } from './acceptance-kit';

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
 * T-067 and T-166 acceptance: pactlab-demo-data/hotels/<CURRENCY> loaded into a fresh deal through the real APIs —
 * billing, the operating history (five years), the STR benchmark, the agreements register, the PIP schedule, the
 * capex budget, the five-year P&L and every document — surfaces the T-067 five and the planted (a) a PIP item due
 * within twelve months of closing that no budget line funds, (b) the deck's RevPAR index of 112 against the STR
 * report's 97, (c) the franchise ending three years after closing with liquidated damages, and (d) brand fees
 * growing faster than rooms revenue across FY2021–FY2025, as cited drafts. The PIP, priced from the franchise
 * agreement, still comes off the price in an NOI ÷ cap-rate run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hotels pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOTELS', currency);
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
    expect(run.body).toMatchObject({ pack: 'HOTELS', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(12);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The T-067 five, unchanged in what they check.
    const estimate = deal.readme.match(/PIP estimated at ([A-Z]{3}) ([0-9,]+)/);
    const pip = byTitle['Brand PIP required on change of ownership'];
    expect(pip).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: estimate?.[1] } });
    expect(pip?.pricedRisk?.high).toBe((estimate?.[2] ?? '').replaceAll(',', ''));
    expect(pip?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);
    expect(byTitle['RevPAR trailing the competitive set']?.description).toMatch(/trails the competitive set by 1\.[0-9]% in October 2025, widening to 5\.[0-9]% by September 2026/);
    const [, channel, share] = deal.readme.match(/\*\*Channel concentration\*\* — (.+?) is ([0-9.]+%) of revenue/) ?? [];
    expect(byTitle['Channel concentration']?.description).toContain(`${channel} is ${share} of September 2026 revenue`);
    expect(byTitle['Seasonal demand']?.description).toMatch(/July and August room revenue is 1\.9× January's/);
    expect(byTitle['Management contract termination fee']).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });

    // (a) A PIP item due within twelve months of closing that no budget line funds: an escrow at the unbudgeted amount.
    const [, pipCurrency, unbudgeted] = deal.readme.match(/PIP-01 \(([A-Z]{3}) ([0-9,]+)\) is due/) ?? [];
    const due = byTitle['PIP due within 12 months of closing and unbudgeted: PIP-01'];
    expect(due).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'ESCROW', currency: pipCurrency, low: (unbudgeted ?? '').replaceAll(',', '') } });
    expect(due?.description).toContain('30 June 2027');
    expect(due?.evidence.filter((item) => item.evidenceItemId).length).toBeGreaterThan(0);
    // (b) The deck's RevPAR index of 112 against the STR benchmark's, in the claims register.
    const [, measured] = deal.readme.match(/`str-benchmark\.csv` gives ([0-9.]+)/) ?? [];
    const index = byTitle['STR report contradicts the deck: RevPAR index'];
    expect(index).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(index?.description).toContain(`gives ${measured} for October 2025 to September 2026`);
    expect(index?.evidence.map((item) => item.documentCitation?.quote).filter(Boolean)).toEqual([expect.stringMatching(/RevPAR index of 112/)]);
    expect(byTitle['Claim verified: Occupancy']).toMatchObject({ direction: 1 });
    // (c) The franchise ends three years after the stated closing, the agreement's own date and penalty governing.
    const franchise = byTitle['The franchise ends 3 years after closing: Meridale Hotels (synthetic)'];
    expect(franchise).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(franchise?.description).toMatch(/MER-2009 .* ends on 31 December 2029 \(as the agreement states\)/);
    expect(franchise?.description).toMatch(new RegExp(`Leaving the brand early costs ${currency} 2,[0-9]{3},000 \\(as the agreement states\\)`));
    expect(franchise?.evidence.map((item) => item.documentCitation?.quote).filter(Boolean)).toEqual(
      expect.arrayContaining([expect.stringMatching(/MER-2009 expires on 31 December 2029/), expect.stringMatching(/liquidated damages/), expect.stringMatching(/target closing date of 31 December 2026/)]),
    );
    // (d) Brand fees growing faster than rooms revenue across the five P&L years.
    const fees = byTitle['Brand fees growing faster than rooms revenue, 2021–2025'];
    expect(fees).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(fees?.description).toContain('2021 7.5%');
    expect(fees?.description).toContain('2025 9.9%');
    expect(byTitle['Management agreement terms survive a sale: Coastline Hospitality Management (synthetic)']).toMatchObject({ domain: 'LEGAL', direction: -1 });
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });

    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { status: string; origin: string }[];
    expect(claims.filter((entry) => entry.origin === 'PACK_RULE').map((entry) => entry.status).sort()).toEqual(['CONTRADICTED', 'VERIFIED']);
  });

  it('the calculator reads the trailing year, the index, the agreements, the PIP and brand fees against every P&L year', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('hotels-performance');
    const value = (key: string) => metrics.metrics.find((metric) => metric.key === key)?.value;
    expect(value('occupancy')).toMatch(/^0\.65[0-9]{2}$/);
    expect(value('revpar_index')).toMatch(/^0\.96[0-9]{2}$/);
    expect(value('franchise_months_left')).toBe('39');
    expect(value('management_months_left')).toBe('99');
    expect(value('brand_fee_ratio')).toBe('0.0990');
    expect(Number(value('pip_due_unbudgeted'))).toBeGreaterThan(0);
    expect(metrics.history?.years.slice(-5)).toEqual(['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
  });

  it('accepting the PIP takes the estimate off the price in an NOI ÷ cap-rate run', async () => {
    const pip = (await findings()).find((finding) => finding.title === 'Brand PIP required on change of ownership');
    const lines = await acceptAndValue(deal, { id: pip?.id ?? '', version: pip?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '2400000.00', capRate: '0.08' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: pip?.id, amount: { amount: `-${pip?.pricedRisk?.low}.00` } });
  });

  it('a single-year P&L cannot show the brand-fee trend; a withdrawn import leaves every trend read', async () => {
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
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    // One year reads as one year; the brand-fee trend needs three, so FY2025 alone drafts nothing new.
    expect(titles).toContain('P&L for 2025: one year imported');
    expect(titles.filter((title) => title.startsWith('Brand fees'))).toHaveLength(1);
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.metrics.find((metric) => metric.key === 'brand_fee_ratio')?.value).toBe('0.0990');
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status);
  });
});
