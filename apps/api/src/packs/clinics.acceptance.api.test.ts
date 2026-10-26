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
 * T-068 acceptance: pactlab-demo-data/small-clinics/<CURRENCY> loaded into a
 * fresh deal surfaces the three planted findings as cited drafts; the
 * equipment replacement, priced by the reviewer, reaches a DCF run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('small clinics pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('SMALL_CLINICS', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the three planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'SMALL_CLINICS', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(3);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder: "P07 earns 73.8% of Site 3 revenue".
    const [, provider, share, site] = deal.readme.match(/— (P[0-9]+) earns ([0-9.]+%) of (Site [0-9]+) revenue/) ?? [];
    const carries = byTitle[`One provider carries ${site}`];
    expect(carries).toMatchObject({ domain: 'PEOPLE', direction: -1 });
    expect(carries?.description).toContain(`${provider} earns ${share} of ${site} revenue`);
    expect(carries?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    const coding = byTitle['High-complexity coding above policy'];
    expect(coding).toMatchObject({ domain: 'REGULATORY', direction: -1 });
    expect(coding?.description).toMatch(/^From 2025-Q4 to 2026-Q3, 31\.0%–36\.0% of visits are coded at the highest complexity against the 15\.0%/);
    expect(coding?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/about 15% of visits/);

    const equipment = byTitle['Imaging equipment past its useful life'];
    expect(equipment).toMatchObject({ domain: 'OPERATIONAL', direction: -1, pricedRisk: null });
    expect(equipment?.evidence).toHaveLength(2);
    expect(equipment?.description).toMatch(/^2 items are in service past their useful life at 2026-09-30: Panoramic X-ray unit at Site 1 \(acquired 2014-05-01/);
  });

  it('the reviewer prices the replacements as remediation; accepted, they reach a DCF run', async () => {
    const equipment = (await findings()).find((finding) => finding.title === 'Imaging equipment past its useful life');
    const lines = await acceptAndValue(deal, { id: equipment?.id ?? '', version: equipment?.version ?? 1 }, {
      pricedRisk: { type: 'REMEDIATION_COST', currency, low: '180000.00', high: '240000.00', basis: 'Two replacement quotes (synthetic).' },
      assumptions: {
        method: 'DCF',
        baseRevenue: '2800000',
        years: [1, 2, 3, 4, 5].map(() => ({ growth: '0.05', fcfMargin: '0.18' })),
        discountRate: '0.12',
        terminal: { kind: 'GORDON', growth: '0.02' },
      },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: equipment?.id, amount: { amount: '-180000.00' } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
