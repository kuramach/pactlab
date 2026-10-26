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
 * T-067 acceptance: pactlab-demo-data/hotels/<CURRENCY> loaded into a fresh
 * deal surfaces the five planted findings as cited drafts; the PIP, priced
 * from the franchise agreement, reaches an NOI ÷ cap-rate run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('hotels pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HOTELS', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the five planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'HOTELS', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(5);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 5 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's PIP estimate for this folder, e.g. "USD 3,600,000".
    const estimate = deal.readme.match(/PIP estimated at ([A-Z]{3}) ([0-9,]+)/);
    const pip = byTitle['Brand PIP required on change of ownership'];
    expect(pip).toMatchObject({ domain: 'PROPERTY', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: estimate?.[1] } });
    expect(pip?.pricedRisk?.high).toBe((estimate?.[2] ?? '').replaceAll(',', ''));
    expect(pip?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([2, 2]);

    const revpar = byTitle['RevPAR trailing the competitive set'];
    expect(revpar).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(revpar?.description).toMatch(/trails the competitive set by [67]\.[0-9]% in October 2025, widening to 1[12]\.[0-9]% by September 2026/);

    const [, channel, share] = deal.readme.match(/\*\*Channel concentration\*\* — (.+?) is ([0-9.]+%) of revenue/) ?? [];
    expect(byTitle['Channel concentration']?.description).toContain(`${channel} is ${share} of September 2026 revenue`);

    const seasonal = byTitle['Seasonal demand'];
    expect(seasonal).toMatchObject({ domain: 'OPERATIONAL', direction: 0 });
    expect(seasonal?.description).toMatch(/July and August room revenue is 1\.9× January's/);

    const fee = byTitle['Management contract termination fee'];
    expect(fee).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(fee?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/three times the prior year.s base management fee/) });
  });

  it('accepting the PIP takes the estimate off the price in an NOI ÷ cap-rate run', async () => {
    const pip = (await findings()).find((finding) => finding.title === 'Brand PIP required on change of ownership');
    const lines = await acceptAndValue(deal, { id: pip?.id ?? '', version: pip?.version ?? 1 }, { assumptions: { method: 'NOI_CAP_RATE', noi: '2400000.00', capRate: '0.08' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: pip?.id, amount: { amount: `-${pip?.pricedRisk?.low}.00` } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
