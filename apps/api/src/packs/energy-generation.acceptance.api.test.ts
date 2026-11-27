import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoModelResponse } from '../demo-seed/seed';
import { ACCEPTANCE_CURRENCIES, type AcceptanceDeal, acceptAndValue, csvRows, HISTORY_YEARS as YEARS, type PackMetricsBody, startAcceptanceDeal } from './acceptance-kit';

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
type EnergyView = {
  currency: string;
  register: { plants: number; interests: number; leases: number; confirmedEntries: number; corroboratedEntries: number; proposedEntries: number };
  production: { analysisDate: string; interestDecline: string; contractedShare: string; capacityKw: string };
  reserves: { reportOnFile: boolean; categories: { category: string; volume: string | null; value: string | null }[]; assumedDecline: { percent: string } | null; mismatch: boolean };
  decimals: { errors: { interestId: string; direction: string; stated: string; computed: string }[] };
  leases: { share: string; material: boolean; holdYears: number; holdSource: string };
  liabilities: { lines: { kind: string; assetName: string | null; status: string; estimate: string; booked: string; gap: string }[] };
  ppa: { plantId: string; contractedShare: string }[];
  documents: { id: string; fileName: string }[];
  guardrail: string;
};

const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
const gateway = () => new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } });
const PLANT = 'Cinder Ridge Station (synthetic)';

/**
 * T-142 acceptance: pactlab-demo-data/energy-generation/<CURRENCY> loaded into a fresh deal runs end
 * to end — the asset and interest register, the production and reserves model and the liability
 * model on the Assets tab, every planted defect as a cited draft (an ash-pond remediation estimate
 * absent from the liability schedule, an ARO underfunded by ~40%, ~25% of acreage not held by
 * production expiring within 18 months, a division-order decimal error), entries read from the
 * reports by a scripted model and confirmed by a person, and the bridge.
 */
describe.each(ACCEPTANCE_CURRENCIES)('energy generation & rights pack acceptance (%s)', { timeout: 60_000 }, (currency) => {
  let deal: AcceptanceDeal;
  const findings = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/findings`, 'lead')).body['items'] as FindingView[];
  const assets = async () => (await deal.call('GET', `/v1/deals/${deal.dealId}/energy`, 'lead')).body as unknown as EnergyView;

  beforeAll(async () => {
    deal = await startAcceptanceDeal('ENERGY_GENERATION', currency, { gateway: gateway() });
  }, 180_000);
  afterAll(async () => deal?.close());

  it('the Assets tab shows the register, production, decimals, leases and liabilities, with the guardrail', async () => {
    const view = await assets();
    expect(view.currency).toBe(currency);
    expect(view.register).toMatchObject({ plants: 1, interests: 20, leases: 26 });
    expect(view.production.analysisDate).toBe('2026-09-30');
    expect(Number(view.production.interestDecline)).toBeCloseTo(0.1, 2);
    expect(Number(view.production.contractedShare)).toBeGreaterThan(0.7);
    expect(view.production.capacityKw).toBe('600000');
    expect(view.decimals.errors).toEqual([expect.objectContaining({ interestId: 'OG-007', direction: 'OVERPAID', stated: '0.12500000', computed: '0.09375000' })]);
    expect(view.leases).toMatchObject({ share: '0.2500', material: true, holdYears: 5, holdSource: 'DEFAULT' });
    expect(view.liabilities.lines.map((line) => [line.kind, line.assetName, line.status])).toEqual([
      ['aro', PLANT, 'SHORTFALL'],
      ['ccr', PLANT, 'UNBOOKED'],
    ]);
    const aro = view.liabilities.lines.find((line) => line.kind === 'aro');
    expect(Number(aro?.booked) / Number(aro?.estimate)).toBeCloseTo(0.6, 5);
    expect(view.ppa.map((cliff) => cliff.plantId)).toEqual(['PL-001']);
    // Reserves are only what a person confirms from the report: none yet.
    expect(view.reserves.reportOnFile).toBe(true);
    expect(view.reserves.categories.every((category) => category.volume === null)).toBe(true);
    expect(view.reserves).toMatchObject({ assumedDecline: { percent: '12' }, mismatch: false });
    expect(view.guardrail).toMatch(/certifies no reserves/);
    const page = await deal.call('GET', `/v1/deals/${deal.dealId}/energy/assets?limit=5`, 'lead');
    expect(page.body).toMatchObject({ total: 21, limit: 5 });
    expect((page.body['items'] as { assetId: string }[]).map((asset) => asset.assetId)).toEqual(['OG-001', 'OG-002', 'OG-003', 'OG-004', 'OG-005']);
    const rest = await deal.call('GET', `/v1/deals/${deal.dealId}/energy/assets?limit=50&cursor=${String(page.body['nextCursor'])}`, 'lead');
    expect((rest.body['items'] as { assetId: string }[]).map((asset) => asset.assetId).at(-1)).toBe('PL-001');
    expect(rest.body['nextCursor']).toBeNull();
  });

  it('every planted defect surfaces as a cited draft; a re-run adds nothing', async () => {
    const run = await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ pack: 'ENERGY_GENERATION', unresolvedQuotes: 0 });
    const promised = Number(/You should see exactly these (\d+) findings/.exec(deal.readme)?.[1]);
    expect(Number(run.body['created']) + Number(run.body['existing'])).toBe(promised);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'lead')).body).toMatchObject({ created: 0, existing: promised });

    const byTitle = Object.fromEntries((await findings()).map((finding) => [finding.title, finding]));
    for (const [, title] of deal.readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)) expect(byTitle[title ?? ''], title).toBeDefined();
    // (a) the ash-pond estimate absent from the liability schedule: a remediation cost at the plan's figure.
    const ash = byTitle[`Unbooked environmental liability: Coal ash (CCR) closure at ${PLANT}`];
    expect(ash).toMatchObject({ direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency } });
    expect(ash?.evidence.some((link) => link.documentCitation?.quote.includes('ash pond'))).toBe(true);
    // (b) the ARO booked at 60% of the study: an escrow at the shortfall.
    const aro = byTitle[`ARO shortfall: ${PLANT}`];
    expect(aro).toMatchObject({ direction: -1, pricedRisk: { type: 'ESCROW', currency } });
    expect(aro?.description).toMatch(/\(60\.0% of the estimate\)/);
    // (c) a quarter of the acreage not held by production, expiring within 18 months.
    const leases = byTitle['Lease expiry risk: acreage not held by production'];
    expect(leases).toMatchObject({ domain: 'LEGAL', direction: -1 });
    expect(leases?.description).toMatch(/covering 25\.0% of the net acres .* within 18 months/);
    // (d) the division-order decimal, with its direction and size.
    const [, decimalTitle] = deal.readme.match(/\*\*(Royalty decimal error: .+?)\*\*/) ?? [];
    expect(byTitle[decimalTitle ?? '']).toMatchObject({ domain: 'FINANCIAL', direction: -1 });
    expect(byTitle[decimalTitle ?? '']?.description).toMatch(/overpaid by 0\.03125000/);
    expect(byTitle[`PPA cliff: ${PLANT}`]).toMatchObject({ direction: 0 });
  });

  it('five years of production: generation, oil and gas by year, hand-computed, with the plant\'s decline drafted (T-184b)', async () => {
    const metrics = (await deal.call('GET', `/v1/deals/${deal.dealId}/metrics/pack`, 'lead')).body as PackMetricsBody;
    const rows = csvRows(deal.folder, 'production-history.csv');
    const volumeOf = (product: string) => (year: string) => String(rows.filter((row) => row[2]?.startsWith(year) && row[3] === product).reduce((total, row) => total + BigInt(row[4] ?? '0'), 0n));
    expect(metrics.history?.years).toEqual(YEARS.map((year) => `FY${year}`));
    expect(metrics.history?.rows.find((row) => row.key === 'power_mwh')?.values).toEqual(YEARS.map(volumeOf('power')));
    expect(metrics.history?.rows.find((row) => row.key === 'oil_bbl')?.values).toEqual(YEARS.map(volumeOf('oil')));
    expect(metrics.history?.coverage.find((entry) => entry.key === 'drivers')?.summary).toBe('FY2021–FY2025 (5 of 5 years)');
    expect(metrics.metrics.find((metric) => metric.key === 'generation_mwh')?.history?.map((point) => point.period)).toEqual(YEARS.map((year) => `FY${year}`));
    const trend = (await findings()).find((finding) => finding.title === 'Net generation (MWh) falling every year, FY2021–FY2025');
    expect(trend).toMatchObject({ domain: 'OPERATIONAL', direction: -1 });
  });

  it('AI reads the reports; nothing counts until a person confirms, and the energy checks add nothing new', async () => {
    const before = await assets();
    const read = async (name: string) => {
      const document = before.documents.find((entry) => entry.fileName === name);
      const response = await deal.call('POST', `/v1/deals/${deal.dealId}/energy/extract`, 'lead', { documentId: document?.id });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body;
    };
    expect(await read('05-reserve-report.pdf')).toMatchObject({ proposed: 7, rejected: [] });
    expect(await read('06-ash-pond-closure-plan.pdf')).toMatchObject({ proposed: 1 });
    expect(await read('07-decommissioning-study.pdf')).toMatchObject({ proposed: 1 });
    expect(await read('07-decommissioning-study.pdf')).toMatchObject({ proposed: 0 });
    const proposed = (await deal.call('GET', `/v1/deals/${deal.dealId}/energy/items?status=PROPOSED`, 'lead')).body as { items: { id: string; kind: string; value: string }[]; total: number };
    expect(proposed.total).toBe(9);
    expect((await assets()).register).toMatchObject({ confirmedEntries: 0, proposedEntries: 9 });
    // A figure not in the quote is refused at confirmation.
    const pdp = proposed.items.find((item) => item.kind === 'RESERVES' && item.value === '1240');
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/energy/items/${pdp?.id}/decision`, 'lead', { decision: 'CONFIRM', value: '1300' })).status).toBe(422);
    for (const item of proposed.items) expect((await deal.call('POST', `/v1/deals/${deal.dealId}/energy/items/${item.id}/decision`, 'lead', { decision: 'CONFIRM' })).status).toBe(200);
    const after = await assets();
    // The liability estimates and the decline restate the report sentences: confirmed, never counted twice.
    expect(after.register).toMatchObject({ confirmedEntries: 9, corroboratedEntries: 3, proposedEntries: 0 });
    expect(after.reserves.categories.map((category) => [category.category, category.volume])).toEqual([
      ['PDP', '1240'],
      ['PDNP', '310'],
      ['PUD', '880'],
    ]);
    expect(after.liabilities.lines.map((line) => line.gap)).toEqual(before.liabilities.lines.map((line) => line.gap));
    const checks = await deal.call('POST', `/v1/deals/${deal.dealId}/energy/checks`, 'lead');
    expect(checks.status, JSON.stringify(checks.body)).toBe(200);
    expect(checks.body).toMatchObject({ created: 0, unresolvedQuotes: 0 });
  });

  it('accepting the ARO shortfall holds back the escrow on the bridge, on the capacity value', async () => {
    const aro = (await findings()).find((finding) => finding.title === `ARO shortfall: ${PLANT}`);
    const lines = await acceptAndValue(deal, { id: aro?.id ?? '', version: aro?.version ?? 1 }, { assumptions: { method: 'ARR_MULTIPLE', arr: (await assets()).production.capacityKw, multiple: '200' } });
    const line = lines.find((entry) => entry.findingId === aro?.id);
    expect(line, JSON.stringify(lines)).toBeDefined();
    expect(Number(line?.amount.amount)).toBe(-Number(aro?.pricedRisk?.high));
  });

  it('accepting the unbooked ash-pond liability takes the closure plan’s figure off the price', async () => {
    const ash = (await findings()).find((finding) => finding.title.startsWith('Unbooked environmental liability'));
    const lines = await acceptAndValue(deal, { id: ash?.id ?? '', version: ash?.version ?? 1 }, { assumptions: { method: 'ARR_MULTIPLE', arr: (await assets()).production.capacityKw, multiple: '200' } });
    expect(lines.find((line) => line.kind === 'FINDING_ADJUSTMENT')).toMatchObject({ findingId: ash?.id, amount: { amount: `-${Number(ash?.pricedRisk?.low).toFixed(2)}` } });
  });

  it('the register is the buyer’s: refused to the seller and invisible to another tenant', async () => {
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/energy`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/energy/items`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('POST', `/v1/deals/${deal.dealId}/energy/checks`, 'target_contributor')).status).toBe(403);
    expect((await deal.call('GET', `/v1/deals/${deal.dealId}/energy`, 'other')).status).toBe(404);
    expect([403, 404]).toContain((await deal.call('POST', `/v1/deals/${deal.dealId}/findings/pack-rules/run`, 'target_contributor')).status);
  });
});
