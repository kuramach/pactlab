import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, pdfOf, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  status: string;
  direction: number | null;
  pricedRisk: { low: string; high: string; currency: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null; commitSha: string | null }[];
};

/**
 * T-058 acceptance: pactlab-demo-data/fintech/<CURRENCY> loaded into a fresh
 * fintech deal through the real APIs surfaces the folder's three planted
 * findings as cited drafts; accepting the priced drag reaches a valuation run.
 */
describe.each(ACCEPTANCE_CURRENCIES)('fintech pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('FINTECH', currency, { dataClasses: { '01-balance-sheet-2026-09-30.md': 'FINANCIAL' } });
    // An HR file with a look-alike clause must never be read by a rule (rule 7).
    const hr = await deal.call('POST', `/v1/deals/${deal.dealId}/documents`, 'lead', {
      fileName: 'hr-notes.pdf',
      contentType: 'application/pdf',
      contentBase64: pdfOf('The Bank may terminate this program on a change of control of the employer.').toString('base64'),
      dataClass: 'HR',
    });
    expect(hr.status).toBe(201);
  }, 120_000);
  afterAll(async () => deal?.close());

  it('the three planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'FINTECH', created: 3, existing: 0, unresolvedQuotes: 0 });
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 3 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const credit = byTitle['Allowance below observed loss experience'];
    expect(credit).toMatchObject({ domain: 'FINANCIAL', status: 'DRAFT', direction: -1 });
    expect(credit?.pricedRisk?.currency).toBe(currency);
    expect(credit?.evidence.some((link) => link.evidenceItemId && link.commitSha === null)).toBe(true);
    // The README's figure for this folder (e.g. USD 15,567), quoted from the balance sheet.
    const allowance = deal.readme.match(/allowance \(([A-Z]{3} [0-9,]+)\)/)?.[1];
    expect(credit?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe(`Allowance for credit losses: ${allowance}`);

    const aml = byTitle['Alerts closed without review evidence'];
    expect(aml).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null });
    const unreviewed = Number(deal.readme.match(/(\d+) of 80 closed alerts/)?.[1]);
    expect(aml?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(Math.min(unreviewed, 40));

    const bank = byTitle['Partner bank can terminate on change of control'];
    expect(bank).toMatchObject({ domain: 'LEGAL', direction: 0 });
    expect(bank?.evidence).toHaveLength(1);
    expect(bank?.evidence[0]?.documentCitation?.pageNumber).toBe(2);
    expect(bank?.evidence[0]?.documentCitation?.quote).toMatch(/^22\.3 The Bank may terminate/);
    // The HR look-alike was never read.
    expect(Object.keys(byTitle).filter((title) => title.startsWith('Partner bank'))).toHaveLength(1);
  });

  it('accepting the priced drag reaches a valuation run as an adjustment', async () => {
    const credit = (await findings()).find((finding) => finding.title === 'Allowance below observed loss experience');
    const id = credit?.id ?? '';
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Loss rate checked against the tape' })).status).toBe(201);
    const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Allowance is short of observed losses' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '1000000.00', multiple: '5' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: id, point: 'HIGH' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const lines = (ran.body['latestRun'] as { result: { bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result.bridge.lines;
    const line = lines.find((entry) => entry.kind === 'FINDING_ADJUSTMENT');
    expect(line?.findingId).toBe(id);
    // Decimal strings: the finding keeps a minimal decimal (52611.2), the bridge two places (52611.20).
    const [whole = '0', fraction = ''] = (credit?.pricedRisk?.high ?? '').split('.');
    expect(line?.amount.amount).toBe(`-${whole}.${fraction.padEnd(2, '0')}`);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
