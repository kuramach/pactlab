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
 * T-063 acceptance: pactlab-demo-data/professional-services/<CURRENCY> loaded
 * into a fresh deal surfaces the three planted findings as cited drafts; the
 * utilization gap, priced by the reviewer, reaches a valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('professional services pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('PROFESSIONAL_SERVICES', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the three planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'PROFESSIONAL_SERVICES', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(3);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder: "reports 78%; … gives 64.7%".
    const [, reported, measured] = deal.readme.match(/reports ([0-9.]+%); `timesheets-summary.csv` gives ([0-9.]+%)/) ?? [];
    const utilization = byTitle['Utilization below the reported level'];
    expect(utilization).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(utilization?.description).toContain(`reports ${reported} utilization; timesheets give ${measured} billable`);
    expect(utilization?.evidence.filter((link) => link.documentCitation)).toHaveLength(1);

    const [, client, share] = deal.readme.match(/\*\* — (.+?) is ([0-9.]+%) of September 2026 revenue/) ?? [];
    const termination = byTitle['Largest client terminable for convenience'];
    expect(termination).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(termination?.description).toContain(`${client} is ${share} of September 2026 revenue`);
    expect(termination?.evidence.find((link) => link.documentCitation)?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringMatching(/sixty days. written notice/) });

    const attrition = byTitle['Rising attrition in delivery roles'];
    expect(attrition).toMatchObject({ domain: 'PEOPLE', direction: -1 });
    expect(attrition?.description).toMatch(/^Monthly delivery leavers rose from 1 in October 2025 to 4 in September 2026/);
  });

  it('the reviewer prices the utilization gap; accepted, it reaches a valuation run', async () => {
    const utilization = (await findings()).find((finding) => finding.title === 'Utilization below the reported level');
    const lines = await acceptAndValue(deal, { id: utilization?.id ?? '', version: utilization?.version ?? 1 }, {
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '200000.00', high: '500000.00', basis: 'Normalised margin at measured utilization (synthetic).' },
    });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: utilization?.id, amount: { amount: '-200000.00' } });
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
