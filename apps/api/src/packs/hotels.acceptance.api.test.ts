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
  valueConfirmation: { valueDriver: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/** Line kinds a person confirms for the demo P&L: the two revenue lines, the rest operating expenses. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : 'OPEX');

/**
 * T-067 and T-166 acceptance: pactlab-demo-data/hotels/<CURRENCY> loaded into a fresh deal through the real APIs —
 * billing, five years of operating history, the STR benchmark, the seller's capex schedule, the three-year P&L and
 * every document (the franchise agreement, the PIP, the management agreement, the deck and the STR report) —
 * surfaces the T-067 five and the planted (a) a PIP item due six months after closing with no line in the capex
 * schedule, (b) the deck's RevPAR index of 112 against the STR benchmark's 97.0, (c) the franchise term ending three
 * years after closing with liquidated damages and (d) franchise and brand fees outgrowing rooms revenue across
 * FY2023–FY2025, as cited drafts. The PIP still comes off the price in an NOI ÷ cap-rate run, and the unfunded item
 * is held back as an escrow.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hotels pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOTELS', currency);
    // The P&L by year (FY2023–FY2025), years across the columns, line kinds confirmed by a person.
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 3 } });
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
    // The T-067 five, unchanged.
    const estimate = deal.readme.match(/PIP estimated at ([A-Z]{3}) ([0-9,]+)/);
    const pip = byTitle['Brand PIP required on change of ownership'];
    expect(pip).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: estimate?.[1] } });
    expect(pip?.pricedRisk?.high).toBe((estimate?.[2] ?? '').replaceAll(',', ''));
    expect(pip?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);
    const revpar = byTitle['RevPAR trailing the competitive set'];
    expect(revpar).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(revpar?.description).toMatch(/trails the competitive set by 0\.[0-9]% in October 2025, widening to 5\.[0-9]% by September 2026/);
    const [, channel, share] = deal.readme.match(/\*\*Channel concentration\*\* — (.+?) is ([0-9.]+%) of revenue/) ?? [];
    expect(byTitle['Channel concentration']?.description).toContain(`${channel} is ${share} of September 2026 revenue`);
    expect(byTitle['Seasonal demand']).toMatchObject({ domain: 'OPERATIONAL', direction: 0 });
    expect(byTitle['Seasonal demand']?.description).toMatch(/July and August room revenue is 1\.9× January's/);
    const fee = byTitle['Management contract termination fee'];
    expect(fee).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(fee?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/three times the prior year.s base management fee/) });

    // (a) The guest-room PIP item, due six months after the stated closing, has no line in the seller's capex schedule.
    const [, nearCurrency, nearAmount] = deal.readme.match(/due 30 June 2027, estimated at ([A-Z]{3}) ([0-9,]+)/) ?? [];
    const near = byTitle['PIP work due within 12 months of closing is not in the seller’s capex budget'];
    expect(near).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'ESCROW', currency: nearCurrency, low: (nearAmount ?? '').replaceAll(',', '') } });
    expect(near?.description).toContain('due 30 June 2027, 6 months after the closing');
    expect(near?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringMatching(/^Item 1: guest room soft goods renovation/), expect.stringMatching(/target closing date of 31 December 2026/)]));
    // (b) The deck's RevPAR index of 112 against the STR benchmark's 97.0, in the claims register.
    const index = byTitle['The STR benchmark contradicts the deck: RevPAR index against the competitive set'];
    expect(index).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(index?.description).toContain('The STR benchmark gives 97.0 for October 2025 to September 2026');
    expect(index?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/RevPAR index of 112/);
    expect(byTitle['Performance claim verified: Occupancy']).toMatchObject({ direction: 1, pricedRisk: null, valueConfirmation: { valueDriver: 'Occupancy verified against the operating history' } });
    // (c) The franchise term ends three years after the stated closing, with liquidated damages to leave early.
    const term = byTitle['Franchise term ends in year 3 of the hold'];
    expect(term).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(term?.description).toContain('31 December 2029, 3 years after the expected closing on 31 December 2026');
    expect(term?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringMatching(/term runs from 1 January 2010 to 31 December 2029/), expect.stringMatching(/liquidated damages of/)]));
    // (d) Franchise and brand fees outgrowing rooms revenue across the three P&L years; one year alone does not show it.
    const fees = byTitle['Franchise and brand fees growing faster than rooms revenue, FY2023–FY2025'];
    expect(fees).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(fees?.description).toMatch(/FY2023 7\.5% .* FY2024 8\.5% .* FY2025 9\.6%/);
    // The management agreement binds a purchaser; the P&L trend reads every year.
    expect(byTitle['Management agreement survives a sale: runs to 31 December 2038']).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(byTitle['P&L trend, 2023–2025']).toMatchObject({ direction: 0 });
  });

  it('the calculator reads the operating history, the STR benchmark, the P&L and the capex schedule; history asks for the missing years', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('hotels-performance');
    const value = (key: string) => metrics.metrics.find((metric) => metric.key === key)?.value;
    expect(value('revpar_index')).toBe('97.0');
    expect(value('occupancy_index')).toBe('101.0');
    expect(value('brand_fees_share')?.slice(0, 5)).toBe('0.096');
    expect(Number(value('scheduled_capex'))).toBeGreaterThan(0);
    // The P&L here is by year, so seasonality from the statements says what it needs.
    expect(metrics.metrics.find((metric) => metric.key === 'statement_seasonality')).toMatchObject({ value: null });
    expect(metrics.history?.years).toEqual(expect.arrayContaining(['FY2023', 'FY2024', 'FY2025']));
    expect(JSON.stringify(metrics.history?.asks)).toContain('FY2021');
  });

  it('accepting the PIP takes the estimate off the price in an NOI ÷ cap-rate run', async () => {
    const pip = (await findings()).find((finding) => finding.title === 'Brand PIP required on change of ownership');
    const lines = await acceptAndValue(deal, { id: pip?.id ?? '', version: pip?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '2400000.00', capRate: '0.08' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: pip?.id, amount: { amount: `-${pip?.pricedRisk?.low}.00` } });
  });

  it('accepted, the unfunded near-term PIP item is held back as an escrow', async () => {
    const near = (await findings()).find((finding) => finding.title === 'PIP work due within 12 months of closing is not in the seller’s capex budget');
    const lines = await acceptAndValue(deal, { id: near?.id ?? '', version: near?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '2400000.00', capRate: '0.08' } });
    expect(lines.find((line) => line.kind === 'HOLDBACK')).toMatchObject({ findingId: near?.id, amount: { amount: `-${near?.pricedRisk?.low}.00` } });
  });

  it('a single-year P&L shows no fee trend; a withdrawn import leaves every trend read', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const fy2025 = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8')
      .trim()
      .split('\n')
      .map((row) => row.split(',').filter((_, index) => index === 0 || index === 3).join(','))
      .join('\n');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`, 'lead', `${fy2025}\n`);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const accounts = fy2025.split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping })).status).toBe(200);
    expect((await runRules()).status).toBe(200);
    const titles = (await findings()).map((finding) => finding.title);
    expect(titles).toContain('P&L for 2025: one year imported');
    // The brand-fee trend needs every year: FY2025 alone drafts nothing new.
    expect(titles.filter((title) => title.startsWith('Franchise and brand fees growing'))).toHaveLength(1);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status);
  });
});
