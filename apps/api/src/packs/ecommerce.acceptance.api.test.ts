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
 * T-065 acceptance: pactlab-demo-data/ecommerce-dtc/<CURRENCY> loaded into a
 * fresh deal surfaces the three planted findings as cited drafts; the cohort
 * decline, priced by the reviewer, reaches a valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('e-commerce and DTC pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('ECOMMERCE_DTC', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the three planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'ECOMMERCE_DTC', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(3);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder.
    const [, marketplace, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 revenue/) ?? [];
    const majority = byTitle['Majority of revenue through one marketplace'];
    expect(majority).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(majority?.description).toContain(`${marketplace} is ${share} of September 2026 revenue`);
    expect(majority?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/delist products on thirty days. notice/) });

    const cohorts = byTitle['Repeat purchase declining in recent cohorts'];
    expect(cohorts).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(cohorts?.description).toMatch(/^Cohorts from July 2025 keep 2[67]\.[0-9]% of customers in their second month, against 3[89]\.[0-9]% for the 3 earlier cohorts/);

    const cac = byTitle['Acquisition cost rising on paid social'];
    expect(cac).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(cac?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);
    expect(byTitle['Acquisition cost rising on search']).toBeUndefined();
  });

  it('the reviewer prices the cohort decline; accepted, it reaches a valuation run', async () => {
    const cohorts = (await findings()).find((finding) => finding.title === 'Repeat purchase declining in recent cohorts');
    const lines = await acceptAndValue(deal, { id: cohorts?.id ?? '', version: cohorts?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '300000.00', high: '750000.00', basis: 'Lifetime value at recent-cohort retention (synthetic).' },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: cohorts?.id, amount: { amount: '-300000.00' } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
