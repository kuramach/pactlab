import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, startAcceptanceDeal, type AcceptanceDeal, type Body } from './acceptance-kit';

type Metric = { key: string; value: string | null; coverage?: string; history?: { period: string; value: string | null }[]; needs?: string[] };
type History = { years: string[]; rows: { key: string; values: (string | null)[] }[]; asks: { needs: string[]; note: string }[]; longRun?: (Metric & { recovery?: { fallYear: string; peakYear: string; recoveredYear: string | null; years: number | null } })[] };
/** What a person confirms each line of the P&L as: the two revenue lines, every other line an operating expense. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : 'OPEX');
/** A four-place ratio as the README prints it: one decimal of a percent, halves away from zero (the generator's ROUND_HALF_UP). */
const percent = (value: string | null | undefined) => {
  const basis = Math.round(Number(value) * 10_000);
  const tenths = Math.sign(basis) * Math.round(Math.abs(basis) / 10);
  return `${(tenths / 10).toFixed(1)}%`;
};

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
 * T-183: five years of history — the P&L by year (years as columns) and 60 months of occupancy import
 * deterministically, the history figures match the README's hand-computed ones, the planted history defects
 * surface as cited drafts, and two years alone read as "2 of 5 years" with an ask of the seller.
 * T-185: twenty years (FY2007–FY2026) — every year read, the long-run figures match the README's, the five-year
 * figures and checks are unchanged, "the recent run is better than the long run" drafts once, and a history start
 * two years back makes two years complete, with no ask.
 */
describe.each(ACCEPTANCE_CURRENCIES)('multifamily pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const metricsOf = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as Body & { metrics: Metric[]; history?: History };
  const importPnl = async (fileName: string, csv: string) => {
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=${fileName}`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const accounts = csv.trim().split('\n').slice(1).map((line) => (line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(',')[0] ?? ''));
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${uploaded.body['id'] as string}/import`, 'lead', { mapping });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    return { uploaded, imported, accounts };
  };
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
  const readme = (pattern: RegExp) => deal.readme.match(pattern)?.slice(1) ?? [];

  beforeAll(async () => {
    deal = await startAcceptanceDeal('MULTIFAMILY', currency, { dataClasses: { '01-offering-memorandum.md': 'FINANCIAL' } });
    // The operating statement by year, FY2007–FY2026 across the columns, line kinds confirmed by a person.
    const { uploaded, imported, accounts } = await importPnl('pnl.csv', readFileSync(join(deal.folder, 'pnl.csv'), 'utf8'));
    pnlUploadId = uploaded.body['id'] as string;
    expect(imported.body).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 20, issuesCount: 0 } });
  }, 180_000);
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
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBeGreaterThanOrEqual(8);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect(Number(run.body['existing'])).toBeGreaterThan(0);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-183: the planted history defects, each a cited draft resting on the imported rows.
    for (const title of ['Occupancy eroding, FY2022–FY2026', 'Repairs and maintenance growing faster than rent, FY2022–FY2026', "NOI jump in FY2026 above the history's trend"]) {
      const finding = byTitle[title];
      expect(finding, title).toMatchObject({ status: 'DRAFT', direction: -1, pricedRisk: null });
      expect(finding?.evidence.filter((link) => link.evidenceItemId).length, title).toBeGreaterThan(0);
    }
    expect(byTitle['P&L trend, 2022–2026']).toMatchObject({ direction: 0 });
    // T-185: the recent run against the twenty years, once.
    const run20 = byTitle['The recent run is better than the long run: NOI margin, FY2022–FY2026 against FY2007–FY2026'];
    expect(run20, 'recent run').toMatchObject({ status: 'DRAFT', direction: -1, pricedRisk: null });
    expect(run20?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
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

  it('reads every year provided: the five-year figures are unchanged and match the README\'s hand-computed values', async () => {
    const report = await metricsOf();
    const metric = Object.fromEntries(report.metrics.map((entry) => [entry.key, entry]));
    const [figures = ''] = readme(/Figures the history checks reproduce: (.+)/);
    const [noiGrowth, revenueGrowth] = /NOI growth (-?[0-9.]+%) a year and revenue growth (-?[0-9.]+%) a year/.exec(figures)?.slice(1) ?? [];
    expect(percent(metric['noi_cagr']?.value)).toBe(noiGrowth);
    expect(percent(metric['revenue_cagr']?.value)).toBe(revenueGrowth);
    expect(percent(metric['rent_growth']?.value)).toBe(/\((-?[0-9.]+%) a year\); occupancy/.exec(figures)?.[1]);
    expect(percent(metric['expense_ratio']?.value)).toBe(/expense ratio ([0-9.]+%) in FY2026/.exec(figures)?.[1]);
    expect(percent(metric['vacancy_trailing_3y']?.value)).toBe(/trailing three-year vacancy ([0-9.]+%)/.exec(figures)?.[1]);
    const occupancy = [...(/occupancy (FY2022 .+?); expense ratio/.exec(figures)?.[1] ?? '').matchAll(/(FY\d{4}) ([0-9.]+%)/g)].map((match) => [match[1], match[2]]);
    expect(metric['occupancy_average']?.history?.slice(-5).map((point) => [point.period, percent(point.value)])).toEqual(occupancy);
    const rents = [...figures.matchAll(/(FY\d{4}) [A-Z]{3} ([0-9,]+\.\d{2})/g)].map((match) => [match[1], (match[2] ?? '').replaceAll(',', '')]);
    expect(metric['average_rent']?.history?.slice(-5).map((point) => [point.period, point.value])).toEqual(rents);
    for (const key of ['noi_latest', 'occupancy_average', 'average_rent']) expect(metric[key]?.coverage, key).toBe('FY2007–FY2026 (20 years)');
    expect(metric['noi_latest']?.history).toHaveLength(20);
    // The FY2026 year is the T-12: the T-12 NOI and the P&L's FY2026 NOI are one figure.
    expect(metric['noi_latest']?.value).toBe(metric['t12_noi']?.value);
    expect(report.history?.years).toEqual(Array.from({ length: 20 }, (_, index) => `FY${2007 + index}`));
    expect(report.history?.asks).toEqual([]);
  });

  it('computes the long-run figures over all twenty years, matching the README\'s hand-computed values', async () => {
    const report = await metricsOf();
    const long = Object.fromEntries((report.history?.longRun ?? []).map((entry) => [entry.key, entry]));
    const [figures = ''] = readme(/Long-run figures the history checks reproduce: (.+)/);
    const pick = (pattern: RegExp) => pattern.exec(figures)?.slice(1) ?? [];
    const [revenue10, revenueFull] = pick(/revenue growth (-?[0-9.]+%) a year over ten years \(FY2017–FY2026\) and (-?[0-9.]+%) over the full history/);
    expect(percent(long['revenue_cagr_10y']?.value)).toBe(revenue10);
    expect(percent(long['revenue_cagr_full']?.value)).toBe(revenueFull);
    const [noi10, noiFull] = pick(/NOI growth (-?[0-9.]+%) and (-?[0-9.]+%);/);
    expect(percent(long['noi_cagr_10y']?.value)).toBe(noi10);
    expect(percent(long['noi_cagr_full']?.value)).toBe(noiFull);
    for (const [key, label] of [['revenue_worst_year', "revenue's"], ['noi_worst_year', "NOI's"]] as const) {
      const [year, fall, peak, back, years] = pick(new RegExp(`${label} worst year (FY\\d{4}), down ([0-9.]+%), recovered to the (FY\\d{4}) peak in (FY\\d{4}) \\((\\d+) years\\)`));
      expect(long[key], key).toMatchObject({ recovery: { fallYear: year, peakYear: peak, recoveredYear: back, years: Number(years) } });
      expect(percent(long[key]?.value), key).toBe(fall);
    }
    expect(long['revenue_worst_year']?.recovery?.fallYear).toBe('FY2009');
    const [occFall] = pick(/occupancy's worst year FY2009, down ([0-9.]+) points/);
    expect((Number(long['occupancy_worst_year']?.value) * 100).toFixed(1)).toBe(occFall);
    const [marginFull, marginRecent] = pick(/NOI margin through the cycle ([0-9.]+%) \(last five years ([0-9.]+%)\)/);
    expect(percent(long['noi_margin_average_full']?.value)).toBe(marginFull);
    expect(percent(long['noi_margin_average_recent']?.value)).toBe(marginRecent);
    const [occFull, occRecent] = pick(/occupancy through the cycle ([0-9.]+%) \(last five years ([0-9.]+%)\)/);
    expect(percent(long['occupancy_average_full']?.value)).toBe(occFull);
    expect(percent(long['occupancy_average_recent']?.value)).toBe(occRecent);
    expect(long['revenue_cagr_full']?.coverage).toBe('FY2007–FY2026 (20 years)');
  });

  it('two years alone read as "2 of 5 years" with an ask; a history start two years back makes them complete; the saved format is reused with no AI', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Only two years were shared (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    // The same statement with only FY2025 and FY2026: the confirmed layout is read the same way (ADR 0042).
    const two = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8').trim().split('\n').map((line) => {
      const cells = line.match(/("[^"]*"|[^,]+)/g) ?? [];
      return [cells[0], ...cells.slice(-2)].join(',');
    }).join('\n');
    const { uploaded } = await importPnl('pnl-fy2025-fy2026.csv', `${two}\n`);
    expect((uploaded.body['assist'] as { source: string }).source).toBe('FORMAT');
    const runs = await deal.ownerQuery(`SELECT count(*)::int AS n FROM ai_runs WHERE deal_id = $1`, [deal.dealId]);
    expect(runs.rows[0]?.['n']).toBe(0);

    const report = await metricsOf();
    const metric = Object.fromEntries(report.metrics.map((entry) => [entry.key, entry]));
    expect(metric['noi_latest']?.coverage).toBe('FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 operating statements, or tell us the business started later');
    // Nothing is extrapolated: the years not imported stay empty.
    expect(report.history?.rows.find((row) => row.key === 'noi')?.values.slice(-5, -2)).toEqual([null, null, null]);
    expect(report.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2022–FY2024 operating statements, or tell us the business started later.' }]);
    // Occupancy still covers twenty years.
    expect(metric['occupancy_average']?.coverage).toBe('FY2007–FY2026 (20 years)');

    // The deal lead sets the history start two years back (the property was acquired in FY2025): no ask; audited.
    expect([403, 404]).toContain((await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'target_contributor', { year: 2025 })).status);
    const set = await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'lead', { year: 2025 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toEqual({ historyStartYear: 2025 });
    const started = await metricsOf();
    const startedMetric = Object.fromEntries(started.metrics.map((entry) => [entry.key, entry]));
    expect(startedMetric['noi_latest']?.coverage).toBe('FY2025–FY2026 (2 of 2 years since the business started)');
    expect(started.history?.asks).toEqual([]);
    expect(started['historyStart']).toEqual({ year: 2025, suggested: null });
    const audited = await deal.ownerQuery(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'deal.history_start_set' AND outcome = 'SUCCEEDED'`, [deal.dealId]);
    expect(audited.rows[0]?.['n']).toBe(1);
    // Clearing it asks as before.
    expect((await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'lead', { year: null })).body).toEqual({ historyStartYear: null });
    expect((await deal.call('PUT', `/v1/deals/${deal.dealId}/metrics/history-start`, 'lead', { year: 1700 })).status).toBe(400);
    expect((await metricsOf()).history?.asks).toHaveLength(1);
  });

  it('a gap inside the long history is asked for, and only that year', async () => {
    const current = (await deal.ownerQuery(`SELECT id FROM source_uploads WHERE deal_id = $1 AND status = 'IMPORTED' AND target = 'FINANCIAL_PNL'`, [deal.dealId])).rows;
    for (const row of current) expect((await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${row['id'] as string}/withdraw`, 'lead', { reason: 'Replaced (synthetic)' })).status).toBe(200);
    // FY2007–FY2026 with FY2019 left out.
    const lines = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8').trim().split('\n').map((line): string[] => line.match(/("[^"]*"|[^,]+)/g) ?? []);
    const drop = (lines[0] ?? []).indexOf('FY2019');
    const gap = lines.map((cells) => cells.filter((_, index) => index !== drop).join(',')).join('\n');
    await importPnl('pnl-without-fy2019.csv', `${gap}\n`);
    const report = await metricsOf();
    const metric = Object.fromEntries(report.metrics.map((entry) => [entry.key, entry]));
    expect(metric['noi_latest']?.coverage).toBe('FY2007–FY2018, FY2020–FY2026 (19 of 20 years): ask the seller for FY2019 operating statements');
    expect(report.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2019 operating statements.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'target_contributor')).status);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'other')).status).toBe(404);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
