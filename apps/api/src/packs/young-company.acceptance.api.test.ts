import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAcceptanceDeal, type AcceptanceDeal, type Body, type PackMetricsBody } from './acceptance-kit';

/**
 * T-185 acceptance: a young business. pactlab-demo-data/venture-raise/USD (Loopwise) began trading in January 2024:
 * its billing and P&L hold FY2024 and FY2025, its whole history. Without a history start Pactlab asks for five years
 * "or tell us the business started later"; with the start set to 2024 the two years are complete, with no ask and no
 * missing-year finding.
 */
describe('a young business: two years since the start are complete (T-185)', { timeout: 90_000 }, () => {
  let deal: AcceptanceDeal;
  const metricsOf = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as Body & PackMetricsBody & { historyStart: { year: number | null } };

  beforeAll(async () => {
    deal = await startAcceptanceDeal('VENTURE_RAISE', 'USD');
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const accounts = csv.trim().split('\n').slice(1).map((line) => line.split(',')[0] ?? '');
    const kind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /hosting/i.test(account) ? 'COGS' : 'OPEX');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, kind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 2 } });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('without a history start, asks as today: five years, "or tell us the business started later"', async () => {
    const metrics = await metricsOf();
    expect(metrics.historyStart.year).toBeNull();
    expect(metrics.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('FY2024–FY2025 (2 of 5 years): ask the seller for FY2021–FY2023 income statements, or tell us the business started later');
    expect(metrics.history?.asks.map((ask) => ask.needs)).toEqual([['INCOME_STATEMENT'], ['BILLING_INVOICE_LINE']]);
  });

  it('with the history start two years back, the two years are complete: no ask and no missing-year finding', async () => {
    const set = await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'lead', { year: 2024 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const metrics = await metricsOf();
    expect(metrics.historyStart.year).toBe(2024);
    expect(metrics.history?.years).toEqual(['FY2024', 'FY2025']);
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual([
      'FY2024–FY2025 (2 of 2 years since the business started)',
      'FY2024–FY2025 (2 of 2 years since the business started)',
    ]);
    expect(metrics.history?.asks).toEqual([]);
    // The checks draft nothing about years the business never had.
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).status).toBe(200);
    const titles = ((await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as { title: string }[]).map((finding) => finding.title);
    expect(titles.filter((title) => /FY202[123]|missing|earlier years/i.test(title))).toEqual([]);
  });

  it('only the deal lead or an analyst sets it; another tenant cannot', async () => {
    expect([403, 404]).toContain((await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'target_contributor', { year: 2023 })).status);
    expect((await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'other', { year: 2023 })).status).toBe(404);
    expect((await metricsOf()).historyStart.year).toBe(2024);
  });
});
