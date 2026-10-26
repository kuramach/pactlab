import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

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
 * T-062 acceptance: pactlab-demo-data/telecom-media/<CURRENCY> loaded into a
 * fresh telecom deal surfaces the four planted findings as cited drafts; the
 * subscriber gap, priced by the reviewer, reaches a valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('telecom and media pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('TELECOM_MEDIA', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'TELECOM_MEDIA', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(4);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's figures for this folder: "reports 12,382; … bills 11,638".
    const [, reported, billed] = deal.readme.match(/reports ([0-9,]+); `subscribers-by-month.csv` bills ([0-9,]+)/) ?? [];
    const gap = byTitle['Reported subscribers exceed billed subscribers'];
    expect(gap).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(gap?.description).toContain(`reports ${reported} subscribers`);
    expect(gap?.description).toContain(`bills ${billed} in September 2026`);
    expect(gap?.evidence.filter((link) => link.documentCitation)).toHaveLength(1);
    expect(gap?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);

    const churn = byTitle['Churn rising against the reported rate'];
    expect(churn).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(churn?.description).toMatch(/to [0-9,]+ in December 2025, then fell about 0\.[0-9]% a month/);
    expect(churn?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/churn: 0\.9%/i);

    const region = byTitle['Regional concentration'];
    const share = deal.readme.match(/North region is ([0-9.]+%) of September 2026 revenue/)?.[1];
    expect(share).toBeTruthy();
    expect(region).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(region?.description).toContain(`The North region is ${share} of September 2026 revenue`);

    const wholesale = byTitle['Wholesale price review ahead'];
    expect(wholesale).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(wholesale?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringContaining('1 January 2027') });
  });

  it('the reviewer prices the subscriber gap; accepted, it reaches a valuation run', async () => {
    const gap = (await findings()).find((finding) => finding.title === 'Reported subscribers exceed billed subscribers');
    const id = gap?.id ?? '';
    const priced = await deal.call('PATCH', `/v1/deals/${deal.dealId}/findings/${id}`, 'lead', {
      expectedVersion: gap?.version ?? 1,
      pricedRisk: { type: 'PRICE_REDUCTION', currency, low: '150000.00', high: '400000.00', basis: 'Unbilled subscribers at ARPU, capitalised (synthetic).' },
    });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    const version = Number((priced.body as { version: number }).version);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: version, decision: 'SUBMITTED', rationale: 'KPI pack and billing extract compared' })).status).toBe(201);
    const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: version + 1, decision: 'ACCEPTED', rationale: 'Billed count is the basis' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '6000000.00', multiple: '3' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: id, point: 'LOW' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const lines = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result.bridge.lines;
    const line = lines.find((entry) => entry.kind === 'FINDING_ADJUSTMENT');
    expect(line?.findingId).toBe(id);
    expect(line?.amount.amount).toBe('-150000.00');
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
