import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  status: string;
  direction: number | null;
  pricedRisk: { type: string; low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};

/**
 * T-061 acceptance: pactlab-demo-data/healthcare/<CURRENCY> loaded into a fresh
 * healthcare deal through the real APIs surfaces the four planted findings as
 * cited drafts; the priced medical-director exposure reaches a valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('healthcare pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('HEALTHCARE', currency);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'HEALTHCARE', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(4);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const government = byTitle['Revenue concentrated in government programmes'];
    // The README's share for this folder, e.g. "63.6% of September 2026 revenue".
    const share = deal.readme.match(/are ([0-9.]+%) of September 2026 revenue/)?.[1];
    expect(government).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(share).toBeTruthy();
    expect(JSON.stringify(government)).toContain(share ?? '');

    const fee = byTitle['Medical-director fee above documented duties'];
    expect(fee).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: { type: 'INDEMNITY', currency } });
    expect(fee?.evidence.map((link) => link.documentCitation?.pageNumber)).toEqual([1, 1, 2]);

    const privacy = byTitle['Privacy risk assessment out of date'];
    expect(privacy).toMatchObject({ domain: 'REGULATORY', direction: 0 });
    expect(privacy?.evidence[0]?.documentCitation?.quote).toMatch(/Assessment date: 14 March 2023/);

    const credentials = byTitle['Provider credentials expiring'];
    expect(credentials).toMatchObject({ domain: 'OPERATIONAL', direction: 0 });
    expect(credentials?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(2);
  });

  it('accepting the priced exposure reaches a valuation run as a holdback', async () => {
    const fee = (await findings()).find((finding) => finding.title === 'Medical-director fee above documented duties');
    const id = fee?.id ?? '';
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Agreement and time records checked' })).status).toBe(201);
    const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Fee exceeds documented duties' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '2000000.00', multiple: '3' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: id, point: 'LOW' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const lines = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result.bridge.lines;
    // An indemnity is held back from cash at close, not taken off the price.
    const line = lines.find((entry) => entry.kind === 'HOLDBACK');
    expect(line?.findingId).toBe(id);
    expect(line?.amount.amount.startsWith('-')).toBe(true);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
