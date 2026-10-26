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
 * T-064 acceptance: pactlab-demo-data/pharma-biotech/<CURRENCY> loaded into a
 * fresh deal surfaces the three planted findings as cited drafts; the patent
 * exposure, priced by the reviewer, reaches a DCF valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('pharma and biotech pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('PHARMA_BIOTECH', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the three planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'PHARMA_BIOTECH', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(3);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const patent = byTitle['Key patent expires earlier than the forecast assumes'];
    expect(patent).toMatchObject({ domain: 'LEGAL', direction: -1, pricedRisk: null });
    expect(patent?.description).toMatch(/^The forecast assumes Product A exclusivity through 2031; its composition-of-matter patents expire by 2028-/);
    expect(patent?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(2);
    expect(patent?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/exclusivity\s+through\s+2031/);

    const supplier = byTitle['Open manufacturing observations at the supplier'];
    expect(supplier).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    expect(supplier?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/^Open observations: 3/) });

    // The README's figure for this folder: "the royalty line alone is 58.2% of September 2026 revenue".
    const share = deal.readme.match(/royalty line alone is ([0-9.]+%) of September 2026 revenue/)?.[1];
    const partner = byTitle['Partner concentration'];
    expect(share).toBeTruthy();
    expect(partner).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(partner?.description).toMatch(/^Aldermoor Therapeutics is [0-9.]+% of September 2026 revenue/);
    expect(partner?.description).toContain(`Its largest line, Aldermoor Therapeutics — royalties on Product A (synthetic), is ${share}.`);
  });

  it('the reviewer prices the patent exposure; accepted, it reaches a DCF run', async () => {
    const patent = (await findings()).find((finding) => finding.title === 'Key patent expires earlier than the forecast assumes');
    const lines = await acceptAndValue(deal, { id: patent?.id ?? '', version: patent?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '2500000.00', high: '6000000.00', basis: 'Product A royalties 2028–2031 at generic erosion (synthetic).' },
      assumptions: {
        method: 'DCF',
        baseRevenue: '8000000',
        years: [1, 2, 3, 4, 5].map(() => ({ growth: '0.04', fcfMargin: '0.30' })),
        discountRate: '0.12',
        terminal: { kind: 'GORDON', growth: '0.01' },
      },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: patent?.id, amount: { amount: '-2500000.00' } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
