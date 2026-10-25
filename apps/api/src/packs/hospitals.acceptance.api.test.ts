import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, acceptAndValue, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

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

/**
 * T-069 acceptance: pactlab-demo-data/hospitals/<CURRENCY> loaded into a fresh
 * deal surfaces the four planted findings as cited drafts; the committed
 * regulatory capex, priced from the cost report, comes off the price in a
 * payer-mix-adjusted EBITDA run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hospitals pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOSPITALS', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'HOSPITALS', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(4);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder.
    const [, payer, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 net revenue/) ?? [];
    const concentration = byTitle['Earnings concentrated in one payer'];
    expect(concentration).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(concentration?.description).toContain(`${payer} is ${share} of September 2026 net revenue`);

    const accreditation = byTitle['Accreditation does not transfer automatically'];
    expect(accreditation).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    expect(accreditation?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/does not transfer automatically/) });

    const physicians = byTitle['Key-physician dependence'];
    expect(physicians).toMatchObject({ domain: 'PEOPLE', direction: -1, pricedRisk: null });
    expect(physicians?.evidence[0]?.documentCitation?.quote).toMatch(/two interventional cardiologists perform about 80% of procedures/);

    const [, capexCurrency, capex] = deal.readme.match(/— ([A-Z]{3}) ([0-9,]+) committed/) ?? [];
    const capexFinding = byTitle['Committed regulatory capex'];
    expect(capexFinding).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: capexCurrency, high: (capex ?? '').replaceAll(',', '') } });
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

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
