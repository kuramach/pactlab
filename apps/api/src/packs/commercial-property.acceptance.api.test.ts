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
 * T-066 and T-165 acceptance: pactlab-demo-data/commercial-property/<CURRENCY> loaded into a fresh deal through
 * the real APIs — billing, the rent roll, three years of CAM reconciliations, the seller's capex schedule, the
 * three-year P&L and every document, the eleven leases among them — surfaces the T-066 four and the planted
 * (a) the rent roll overstating two tenants' rent against their leases, (b) 41% of rent from one tenant whose
 * lease ends in year one of the hold, (c) an NNN recovery shortfall in every one of the three statement years and
 * (d) a PCA-flagged roof liability absent from the seller's capex schedule, as cited drafts. The environmental
 * escrow is still held back in an NOI ÷ cap-rate run, and the roof reaches the bridge as remediation.
 */
describe.each(ACCEPTANCE_CURRENCIES)('commercial property pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('COMMERCIAL_PROPERTY', currency);
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
    expect(run.body).toMatchObject({ pack: 'COMMERCIAL_PROPERTY', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(11);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The T-066 four, unchanged.
    const [, tenant, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of base rent/) ?? [];
    const walt = deal.readme.match(/Weighted average lease term is ([0-9.]+) years/)?.[1];
    const anchor = byTitle['Anchor tenant concentration and near-term expiry'];
    expect(anchor).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(anchor?.description).toContain(`${tenant} is ${share} of base rent and its lease ends 2027-06-30`);
    expect(anchor?.description).toContain(`Weighted average lease term is ${walt} years`);
    expect(anchor?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/Term ends 30 June 2027/);
    const environmental = byTitle['Recognized environmental condition'];
    expect(environmental).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: null });
    expect(environmental?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);
    const cam = byTitle['CAM recoveries below expenses'];
    expect(cam?.description).toMatch(/^In 2025, Repairs and maintenance .* and Security .* recovered less than they cost/);
    const upside = byTitle['Below-market anchor rent (upside, not price)'];
    expect(upside).toMatchObject({ direction: 1, pricedRisk: null, valueConfirmation: { valueDriver: 'Below-market anchor rent' } });
    expect(upside?.description).toMatch(/pays 6\.0% below market rent — the deepest discount on the rent roll/);

    // (a) The rent roll overstates two tenants against their leases; the statements follow the leases.
    const rent = byTitle['Rent roll overstates rent against the leases: 2 tenants'];
    expect(rent).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: null });
    expect(rent?.description).toContain('Pellham Engineering (synthetic), Unit 2');
    expect(rent?.description).toContain('up 2.0% on each of 5 anniversaries');
    expect(rent?.description).toContain('Brightwater Analytics (synthetic), Unit 3');
    expect(rent?.description).toContain('so the statements follow the leases');
    expect(rent?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringMatching(/Base rent increases by 2% on each anniversary/), expect.stringMatching(/Base rent is fixed for the term/)]));
    // (b) 41% of rent from one tenant whose lease ends in year one of the hold, measured from the stated closing.
    const cliff = byTitle['Rent cliff: Corvane Logistics (synthetic) (41.0% of rent) expires in year 1 of the hold'];
    expect(cliff).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(cliff?.description).toContain('6 months after the expected closing on 31 December 2026');
    expect(cliff?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringMatching(/target closing date of 31 December 2026/), expect.stringMatching(/term runs from 1 July 2021 to 30 June 2027/)]));
    // (c) The NNN recoveries fall short of the leases in every one of the three statement years.
    const recoveries = byTitle['NNN recoveries short of the leases in every year, 2023–2025'];
    expect(recoveries).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(recoveries?.description).toContain('proportionate shares summing to 100.0%');
    for (const year of ['2023', '2024', '2025']) expect(recoveries?.description).toContain(`${year}: `);
    // (d) The PCA's roof is absent from the seller's capex schedule: priced as remediation at the PCA's estimate.
    const roof = byTitle['Roof work flagged by the condition report is not in the seller’s capex schedule'];
    const [, roofCurrency, roofAmount] = deal.readme.match(/roof replacement within two years at ([A-Z]{3}) ([0-9,]+)/) ?? [];
    expect(roof).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: roofCurrency, low: (roofAmount ?? '').replaceAll(',', '') } });
    expect(roof?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/^Roof: the membrane roof/);
    // The obligations register is priced into the bridge at its sum; the P&L trend reads every year.
    expect(byTitle['Landlord obligations the buyer inherits: tenant improvements, leasing commissions and committed capex']).toMatchObject({ direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency } });
    expect(byTitle['P&L trend, 2023–2025']).toMatchObject({ direction: 0 });
    expect(byTitle['Repairs and maintenance growing faster than revenue, 2023–2025']).toMatchObject({ direction: -1 });
  });

  it('the calculator reads the rent roll, the CAM years and the capex schedule; history asks for the missing years', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('cre-leases');
    const value = (key: string) => metrics.metrics.find((metric) => metric.key === key)?.value;
    expect(value('largest_tenant_share')?.slice(0, 4)).toBe('0.41');
    expect(value('recovery_ratio')).toBe('0.8974'); // 560,000 ÷ 624,000 in 2025
    expect(Number(value('committed_capex'))).toBeGreaterThan(0);
    expect(metrics.history?.years.slice(-3)).toEqual(['FY2023', 'FY2024', 'FY2025']);
    expect(JSON.stringify(metrics.history?.asks)).toContain('FY2021');
  });

  it('the reviewer prices the environmental condition as an escrow; accepted, it is held back in an NOI ÷ cap-rate run', async () => {
    const environmental = (await findings()).find((finding) => finding.title === 'Recognized environmental condition');
    const lines = await acceptAndValue(deal, { id: environmental?.id ?? '', version: environmental?.version ?? 1 }, {
      pricedRisk: { type: 'ESCROW', currency, low: '250000.00', high: '900000.00', basis: 'Phase II and remediation estimate range (synthetic).' },
      assumptions: { method: 'NOI_CAP_RATE', noi: '1500000.00', capRate: '0.065' },
    });
    expect(lines.find((line) => line.kind === 'HOLDBACK')).toMatchObject({ findingId: environmental?.id, amount: { amount: '-250000.00' } });
  });

  it('accepted, the roof comes off the price in an NOI ÷ cap-rate run', async () => {
    const roof = (await findings()).find((finding) => finding.title === 'Roof work flagged by the condition report is not in the seller’s capex schedule');
    const lines = await acceptAndValue(deal, { id: roof?.id ?? '', version: roof?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '1500000.00', capRate: '0.065' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: roof?.id, amount: { amount: `-${roof?.pricedRisk?.low}.00` } });
  });

  it('a single-year P&L shows no trend; a withdrawn import leaves every trend read', async () => {
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
    // The repairs trend needs every year: FY2025 alone drafts nothing new.
    expect(titles.filter((title) => title.startsWith('Repairs and maintenance growing'))).toHaveLength(1);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status);
  });
});
