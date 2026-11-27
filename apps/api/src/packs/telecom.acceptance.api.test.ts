import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CURRENCIES, csvRows, HISTORY_YEARS as YEARS, ratioOf, startAcceptanceDeal, type AcceptanceDeal, type Body, type PackMetricsBody } from './acceptance-kit';

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

/** Line kinds a person confirms for the demo P&L: revenue lines, "cost of" lines, the rest operating costs. */
const lineKind = (account: string) => (/revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX');

/**
 * T-062 and T-168 acceptance: pactlab-demo-data/telecom-media/<CURRENCY> loaded into a fresh telecom deal
 * through the real APIs — billing, subscribers by month, subscriber movements, the rights register,
 * advertising and affiliate revenue, capex, the five-year P&L and every document — surfaces the folder's
 * planted findings as cited drafts: the T-062 four, and (a) the movements export's churn contradicting the
 * deck's lower figure; (b) the largest affiliate agreement expiring nine months after the closing; (c) one
 * advertiser at 34% of ad revenue; and (d) content cost per subscriber rising while ARPU stays flat across the
 * five P&L years, which a single year misses; and (e) monthly churn rising every year across the five years
 * of the movements export. The subscriber gap, priced by the reviewer, reaches a
 * valuation run; the Subscribers view is the buyer's.
 */
describe.each(ACCEPTANCE_CURRENCIES)('telecom and media pack acceptance (%s)', { timeout: 90_000 }, (currency) => {
  let deal: AcceptanceDeal;
  let pnlUploadId = '';
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings?limit=100`, 'lead')).body['items'] as FindingView[];
  const runRules = () => deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');

  beforeAll(async () => {
    deal = await startAcceptanceDeal('TELECOM_MEDIA', currency);
    // The P&L by year (FY2021–FY2025, T-184b), years across the columns, line kinds confirmed by a person.
    const csv = readFileSync(join(deal.folder, 'pnl.csv'), 'utf8');
    const uploaded = await deal.upload(`/v1/deals/${deal.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl.csv`, 'lead', csv);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    pnlUploadId = uploaded.body['id'] as string;
    const accounts = csv.trim().split('\n').slice(1).map((row) => row.split(',')[0] ?? '');
    const mapping = { ...(uploaded.body['suggestedMapping'] as Body), lineKinds: Object.fromEntries(accounts.map((account) => [account, lineKind(account)])) };
    const imported = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/import`, 'lead', { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: accounts.length * 5 } });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('every planted finding surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await runRules();
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'TELECOM_MEDIA', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(promised).toBe(14);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await runRules()).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    // The README's list is exactly what the checks draft.
    const listed = [...(deal.readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(Object.keys(byTitle).sort());

    // T-062, unchanged. The README's figures for this folder: "reports 12,382; … bills 11,638".
    const [, reported, billed] = deal.readme.match(/reports ([0-9,]+); `subscribers-by-month.csv` bills ([0-9,]+)/) ?? [];
    const gap = byTitle['Reported subscribers exceed billed subscribers'];
    expect(gap).toMatchObject({ domain: 'FINANCIAL', direction: -1, pricedRisk: null });
    expect(gap?.description).toContain(`reports ${reported} subscribers`);
    expect(gap?.description).toContain(`bills ${billed} in September 2026`);
    expect(gap?.evidence.filter((link) => link.documentCitation)).toHaveLength(1);
    expect(gap?.evidence.filter((link) => link.evidenceItemId)).toHaveLength(12);
    const churnTurning = byTitle['Churn rising against the reported rate'];
    expect(churnTurning).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(churnTurning?.description).toMatch(/to [0-9,]+ in December 2025, then fell about 0\.[0-9]% a month/);
    expect(churnTurning?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toMatch(/churn: 0\.9%/i);
    const share = deal.readme.match(/North region is ([0-9.]+%) of September 2026 revenue/)?.[1];
    expect(byTitle['Regional concentration']).toMatchObject({ domain: 'COMMERCIAL', direction: 0 });
    expect(byTitle['Regional concentration']?.description).toContain(`The North region is ${share} of September 2026 revenue`);
    expect(byTitle['Wholesale price review ahead']?.evidence[0]?.documentCitation).toMatchObject({ pageNumber: 2, quote: expect.stringContaining('1 January 2027') });

    // (a) The movements export's churn contradicts the deck's 0.9%, cited to the deck and the export.
    const churn = byTitle['Claim contradicted: Monthly churn'];
    expect(churn).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(churn?.description).toMatch(/opening subscribers for October 2025 to September 2026, 1\.[45]% a month/);
    expect(churn?.evidence.find((link) => link.documentCitation)?.documentCitation?.quote).toBe('Average monthly churn was 0.9% over the twelve months to September 2026.');
    expect(churn?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
    expect(byTitle['Claim verified: Subscribers']?.direction).toBe(1);
    expect(byTitle['Claim verified: ARPU']?.direction).toBe(1);
    const claims = (await deal.call('GET', `/v1/deals/${deal.dealId}/claims`, 'lead')).body['items'] as { status: string; origin: string }[];
    expect(claims.filter((entry) => entry.origin === 'PACK_RULE').map((entry) => entry.status).sort()).toEqual(['CONTRADICTED', 'VERIFIED', 'VERIFIED']);

    // (b) AF-01 expires nine months after the stated closing; the agreement governs over the register's 2028.
    const rights = byTitle['Material agreement ends within 12 months of the closing: AF-01'];
    expect(rights).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(rights?.description).toMatch(/ends on 30 September 2027 \(as the agreement states\), 9 months after the closing, measured from the expected closing of 31 December 2026/);
    expect(rights?.evidence.map((link) => link.documentCitation?.quote).filter(Boolean)).toEqual(['Agreement AF-01 expires on 30 September 2027.', expect.stringMatching(/^Agreement AF-01 does not renew automatically/), 'The expected closing date is 31 December 2026.']);
    expect(Object.keys(byTitle).some((title) => /: (?:AF-0[234]|CA-01|SR-01|CL-01)$/.test(title))).toBe(false);

    // (c) One advertiser at 34% of advertising revenue; the affiliate stream is spread.
    const advertiser = byTitle['Advertising revenue concentrated in one counterparty: Brightline Motors (synthetic)'];
    expect(advertiser).toMatchObject({ domain: 'COMMERCIAL', direction: -1 });
    expect(advertiser?.description).toMatch(/advertising revenue for October 2025 to September 2026, 34\.0%/);
    expect(Object.keys(byTitle).some((title) => title.startsWith('Affiliate revenue concentrated'))).toBe(false);

    // (d) Content cost per subscriber rising across the five years while ARPU stays flat.
    const squeeze = byTitle['Content costs rising against flat ARPU, 2021–2025'];
    expect(squeeze).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(squeeze?.description).toMatch(/^Content and programming cost per subscriber a month rose every year — 2021 [0-9.]+, 2022 [0-9.]+, 2023 [0-9.]+, 2024 [0-9.]+, 2025 [0-9.]+, 1\.[0-9]+×/);
    expect(Object.keys(byTitle).some((title) => title.startsWith('Capex intensity rising'))).toBe(false);
    expect(byTitle['P&L trend, 2021–2025']).toMatchObject({ direction: 0 });
    expect(byTitle['Content and programming costs growing faster than revenue, 2021–2025']).toMatchObject({ direction: -1 });
    // (e) Five years of the movements export (T-184b): churn rises every year, cited to the export's rows.
    const churnTrend = byTitle['Monthly churn rising every year, FY2021–FY2025'];
    expect(churnTrend).toMatchObject({ domain: 'COMMERCIAL', direction: -1, pricedRisk: null });
    expect(churnTrend?.evidence.filter((link) => link.evidenceItemId).length).toBeGreaterThan(0);
  });

  it('the Subscribers view recomputes churn and ARPU, reads the claims, the rights window, counterparties and every P&L year with its file', async () => {
    const view = await deal.call('GET', `/v1/deals/${deal.dealId}/telecom`, 'lead');
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const body = view.body as Body & {
      subscribers: { trailing: Body; years: { year: string }[] };
      claims: { key: string; status: string }[];
      rights: { from: { date: string; basis: string }; agreements: { agreementId: string; state: string; material: boolean; endsOn: string; registerEndsOn: string; endBasis: string }[] };
      concentration: { streams: { stream: string; counterparties: { counterparty: string; share: string }[] }[] };
      squeeze: { arpuFlat: boolean; years: { year: string }[] };
      trend: { years: { year: string; files: { fileName: string }[] }[] };
    };
    expect(body).toMatchObject({ version: 'telecom-subscribers-1', currency, canRunChecks: true, documentsRead: true });
    expect(body.subscribers.trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(body.subscribers.years.map((year) => year.year)).toEqual(YEARS);
    expect(body.claims.map((claim) => [claim.key, claim.status])).toEqual([['SUBSCRIBERS', 'VERIFIED'], ['CHURN', 'CONTRADICTED'], ['ARPU', 'VERIFIED']]);
    expect(body.rights.from).toMatchObject({ date: '2026-12-31', basis: 'EXPECTED_CLOSING' });
    expect(body.rights.agreements.find((entry) => entry.agreementId === 'AF-01')).toMatchObject({ state: 'ENDS_IN_WINDOW', material: true, endsOn: '2027-09-30', registerEndsOn: '2028-09-30', endBasis: 'DOCUMENT' });
    expect(body.rights.agreements.find((entry) => entry.agreementId === 'AF-03')).toMatchObject({ state: 'RENEWS' });
    expect(body.rights.agreements.find((entry) => entry.agreementId === 'CL-01')).toMatchObject({ state: 'ENDS_IN_WINDOW', material: false });
    expect(body.concentration.streams.map((stream) => [stream.stream, stream.counterparties[0]?.counterparty])).toEqual([['advertising', 'Brightline Motors (synthetic)'], ['affiliate', 'Rivermark Cable (synthetic)']]);
    expect(body.squeeze).toMatchObject({ arpuFlat: true });
    expect(body.squeeze.years.map((year) => year.year)).toEqual(YEARS);
    expect(body.trend.years.map((year) => [year.year, year.files.map((file) => file.fileName)])).toEqual(YEARS.map((year) => [year, ['pnl.csv']]));
    // The pack's own figures on Finances.
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(metrics.calculator).toBe('telecom-subscribers');
    // Five years side by side (T-184b), hand-computed from the export: Σ disconnects ÷ Σ opening subscribers by year.
    const rows = csvRows(deal.folder, 'subscriber-movements.csv');
    const churnOf = (year: string) => {
      const inYear = rows.filter((row) => row[0]?.startsWith(year));
      const sum = (index: number) => inYear.reduce((total, row) => total + BigInt(row[index] ?? '0'), 0n);
      return ratioOf(sum(5), sum(3), 6);
    };
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.find((row) => row.key === 'monthly_churn')?.values).toEqual(YEARS.map(churnOf));
    expect(metrics.history?.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 years; earlier years not provided)', 'FY2021–FY2025 (5 years; earlier years not provided)']);
    expect(metrics.history?.asks).toEqual([]);
    expect(metrics.metrics.find((metric) => metric.key === 'arpu')?.history?.map((point) => point.period)).toEqual(YEARS.map((year) => `FY${year}`));
    expect(Number(metrics.metrics.find((metric) => metric.key === 'monthly_churn')?.value)).toBeCloseTo(0.015, 2);
    expect(Number(metrics.metrics.find((metric) => metric.key === 'largest_advertising_share')?.value)).toBeCloseTo(0.34, 2);
    // The buyer's own side only; another tenant sees nothing.
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/telecom`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/telecom`, 'other')).status).toBe(404);
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

  it('a withdrawn P&L leaves the trend: the view reads no years and no squeeze', async () => {
    const withdrawn = await deal.call('POST', `/v1/deals/${deal.dealId}/uploads/${pnlUploadId}/withdraw`, 'lead', { reason: 'Wrong version of the statement (synthetic)' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const after = (await deal.call('GET', `/v1/deals/${deal.dealId}/telecom`, 'lead')).body as { trend: { years: unknown[] }; squeeze: { years: unknown[] }; subscribers: { years: unknown[] } };
    expect(after.trend.years).toEqual([]);
    expect(after.squeeze.years).toEqual([]);
    // ARPU and churn by year still read from the movements export.
    expect(after.subscribers.years).toHaveLength(5);
    // Partial history (T-184b): no income and expenses; the coverage says so and the seller is asked for them.
    const partial = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    expect(partial.history?.coverage.find((entry) => entry.key === 'operating')?.summary).toBe('No income and expenses imported yet: ask the seller for FY2021–FY2025 income statements, or tell us the business started later');
    expect(partial.history?.asks).toEqual([{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2025 income statements, or tell us the business started later.' }]);
  });

  it('is refused to a target contributor and invisible to another tenant', async () => {
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'other')).status).toBe(404);
  });
});
