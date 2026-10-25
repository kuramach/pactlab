import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal } from './acceptance-kit';

type FindingView = {
  id: string;
  title: string;
  domain: string;
  status: string;
  direction: number | null;
  pricedRisk: { low: string; high: string; currency: string } | null;
  valueConfirmation: { valueDriver: string } | null;
  evidence: { evidenceItemId: string | null; documentCitation: { pageNumber: number; quote: string } | null }[];
};
const decimal2 = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};

/**
 * T-059 acceptance: pactlab-demo-data/multifamily/<CURRENCY> loaded into a
 * fresh multifamily deal — property metrics, the four planted findings as
 * cited drafts, and a NOI ÷ cap-rate valuation in which the accepted
 * maintenance drag lowers the price while loss-to-lease is confirmed value only.
 */
describe.each(ACCEPTANCE_CURRENCIES)('multifamily pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
  const readme = (pattern: RegExp) => deal.readme.match(pattern)?.slice(1) ?? [];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY', currency, { dataClasses: { '01-offering-memorandum.md': 'FINANCIAL' } });
  }, 120_000);
  afterAll(async () => deal?.close());

  it('shows property metrics from the imported extracts', async () => {
    const response = await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ calculator: 'multifamily-metrics', currency });
    const value = Object.fromEntries((response.body['metrics'] as { key: string; value: string }[]).map((metric) => [metric.key, metric.value]));
    const [ltl] = readme(/occupied units are ([0-9.]+)% below market/);
    expect(`${(Number(value['loss_to_lease']) * 100).toFixed(1)}`).toBe(ltl);
    const [noi] = readme(/`t12\.csv` sums to [A-Z]{3} ([0-9,]+)/);
    expect(Math.round(Number(value['t12_noi'])).toLocaleString('en-US')).toBe(noi);
    expect(value['units']).toBe('96');
  });

  it('the four planted findings surface as cited drafts; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    // Checks already ran after each extract import (T-060); this run adds the ones that also need the documents.
    expect(run.body).toMatchObject({ pack: 'MULTIFAMILY', unresolvedQuotes: 0 });
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(4);
    expect(Number(run.body['existing'])).toBeGreaterThan(0);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: 4 });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    const [stated] = readme(/the memorandum states ([A-Z]{3} [0-9,]+)/);
    const noi = byTitle['Offering memorandum NOI above the T-12'];
    expect(noi).toMatchObject({ domain: 'FINANCIAL', direction: 0 });
    expect(noi?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe(`net operating income: ${stated}`);

    const [repairs, plan] = readme(/estimates ([A-Z]{3} [0-9,]+) of repairs against a ([A-Z]{3} [0-9,]+) capital plan/);
    const maintenance = byTitle['Deferred maintenance above the capital plan'];
    expect(maintenance).toMatchObject({ domain: 'PROPERTY', direction: -1 });
    expect(maintenance?.pricedRisk?.currency).toBe(currency);
    expect(maintenance?.pricedRisk?.high.split('.')[0]).toBe((repairs ?? '').replace(/^[A-Z]{3} /, '').replaceAll(',', ''));
    expect(maintenance?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe(`Capital plan: ${plan}`);
    expect(maintenance?.evidence.find((link) => link.documentCitation)?.documentCitation?.pageNumber).toBe(2);

    expect(byTitle['Delinquency concentrated in Building C']).toMatchObject({ domain: 'OPERATIONAL', direction: 0 });
    expect(byTitle['Loss-to-lease (upside, not price)']).toMatchObject({ domain: 'PROPERTY', direction: 1, pricedRisk: null });
  });

  it('values on NOI ÷ cap rate: the accepted drag lowers the price, loss-to-lease is confirmed value only', async () => {
    const all = await findings();
    const maintenance = all.find((finding) => finding.title === 'Deferred maintenance above the capital plan');
    const upside = all.find((finding) => finding.title === 'Loss-to-lease (upside, not price)');
    for (const finding of [maintenance, upside]) {
      const id = finding?.id ?? '';
      expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'lead', { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Checked against the extracts' })).status).toBe(201);
      const accepted = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/${id}/reviews`, 'reviewer', { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Confirmed from the inspections and rent roll' });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    }

    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body['metrics'] as { key: string; value: string }[];
    const noi = metrics.find((metric) => metric.key === 't12_noi')?.value ?? '0';
    const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
    const created = await deal.call('POST', scenarios, 'lead', {
      name: 'T-12 NOI at a 5.5% cap rate',
      values: {
        assumptions: { method: 'NOI_CAP_RATE', noi, capRate: '0.055' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId: maintenance?.id, point: 'HIGH' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scenarioId = (created.body['scenario'] as { id: string }).id;
    const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const result = (ran.body['latestRun'] as { result: { method: { method: string }; enterpriseValue: { amount: string }; bridge: { lines: { kind: string; findingId?: string; amount: { amount: string } }[] } } }).result;
    expect(result.method.method).toBe('NOI_CAP_RATE');
    // NOI ÷ 0.055, rounded to cents: checked as a decimal string, never through a float.
    expect(result.enterpriseValue.amount).toMatch(/^\d+\.\d{2}$/);
    const line = result.bridge.lines.find((entry) => entry.kind === 'FINDING_ADJUSTMENT');
    expect(line?.findingId).toBe(maintenance?.id);
    expect(line?.amount.amount).toBe(`-${decimal2(maintenance?.pricedRisk?.high ?? '0')}`);
    expect(result.bridge.lines.some((entry) => entry.findingId === upside?.id)).toBe(false);
    const confirmed = ran.body['confirmedValue'] as { items: { findingId: string }[] };
    expect(confirmed.items.map((item) => item.findingId)).toContain(upside?.id);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'target_contributor')).status);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status).toBe(404);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
