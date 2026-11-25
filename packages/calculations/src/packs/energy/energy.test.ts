import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { decimalChecks, documentDecline, documentEstimates, energyHoldYears, energyRows, leaseExposure, liabilityKindOf, liabilityModel, monthsBetween, ppaCliffs, productionModel, recomputedNri } from './assets';
import { energyMetrics } from './metrics';
import {
  ENERGY_ARO_SHORTFALL,
  ENERGY_COMPLIANCE_CAPEX_GAP,
  ENERGY_DECLINE_MISMATCH,
  ENERGY_LEASE_EXPIRY,
  ENERGY_PPA_CLIFF,
  ENERGY_RESERVE_REPORT_MISSING,
  ENERGY_ROYALTY_DECIMAL,
  ENERGY_TITLE_DEFECT,
  ENERGY_UNBOOKED_ENVIRONMENTAL,
} from './rules';

let next = 0;
const row = (evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id: `e-${(next += 1)}`, evidenceType, sourceRecordId: Object.values(canonical)[0] ?? '', canonical });
const plant = (id: string, extra: Record<string, string> = {}) => row('energy.plant', { plant_id: id, name: 'Cinder Ridge Station', fuel: 'coal', capacity_mw: '600', commissioned_year: '1982', ppa_counterparty: 'Valley Power Co-op', ppa_expires_on: '2028-06-30', ...extra });
const interest = (id: string, lease: string, type = 'working', share = '0.5', nri = '0.375') => row('energy.interest', { interest_id: id, name: `Well ${id}`, lease_id: lease, interest_type: type, interest_share: share, division_order_nri: nri });
const lease = (id: string, acres: string, extra: Record<string, string> = {}) => row('energy.lease', { lease_id: id, net_acres: acres, royalty_rate: '0.25', held_by_production: 'yes', ...extra });
const output = (asset: string, periodEnd: string, product: string, volume: string, revenue: string, salesType = '') => row('energy.production', { record_id: `${asset}-${periodEnd}-${product}`, asset_id: asset, period_end: periodEnd, product, volume, gross_revenue: revenue, sales_type: salesType });
const booked = (kind: string, amount: string, asset = 'PL-1') => row('energy.liability', { liability_id: `L-${kind}`, asset_id: asset, kind, booked_amount: amount });
const page = (text: string, documentId = 'doc-1', pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const MONTHS = Array.from({ length: 24 }, (_, index) => {
  const month = index + 10; // October 2024 onwards
  const year = 2024 + Math.floor((month - 1) / 12);
  const mm = ((month - 1) % 12) + 1;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return `${year}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
});
/** 24 months of oil, the second year `factor` × the first. */
const history = (asset: string, factor: string, first = 100) => MONTHS.map((month, index) => output(asset, month, 'oil', String(index < 12 ? first : first * Number(factor)), '7000'));

describe('energy asset model (T-142)', () => {
  it('recomputes NRI from the lease royalty chain for working, mineral and royalty interests', () => {
    const rows = energyRows([interest('OG-1', 'LS-1', 'working', '0.5'), interest('OG-2', 'LS-2', 'mineral', '0.5'), lease('LS-1', '100', { overriding_royalty: '0.05' }), lease('LS-2', '100', { royalty_rate: '0.1875' })]);
    const leases = new Map(rows.leases.map((item) => [item.id, item]));
    expect(recomputedNri(rows.interests[0]!, leases.get('LS-1'))?.toFixed(5)).toBe('0.35000');
    expect(recomputedNri(rows.interests[1]!, leases.get('LS-2'))?.toFixed(5)).toBe('0.09375');
    expect(recomputedNri(rows.interests[0]!, undefined)).toBeNull();
  });

  it('flags a division-order decimal off the chain, with the direction and the yearly size', () => {
    const evidence = [interest('OG-7', 'LS-7', 'mineral', '0.5', '0.125'), lease('LS-7', '80', { royalty_rate: '0.1875' }), ...history('OG-7', '0.9')];
    const rows = energyRows(evidence);
    const [check] = decimalChecks(rows, productionModel(rows));
    expect(check).toMatchObject({ interestId: 'OG-7', direction: 'OVERPAID' });
    expect(check?.difference.toFixed(5)).toBe('0.03125');
    // Twelve trailing months of 7,000 gross revenue: 84,000 × 0.03125.
    expect(check?.yearly.toFixed(2)).toBe('2625.00');
    const [finding] = ENERGY_ROYALTY_DECIMAL.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ title: 'Royalty decimal error: Well OG-7', direction: -1 });
    expect(finding?.pricedRisk).toBeUndefined();
    expect(finding?.description).toMatch(/overpaid by 0\.03125000/);
    const under = ENERGY_ROYALTY_DECIMAL.detect({ evidence: [interest('OG-8', 'LS-8', 'mineral', '0.5', '0.05'), lease('LS-8', '80', { royalty_rate: '0.1875' })], pages: [] });
    expect(under[0]).toMatchObject({ direction: 0 });
    expect(ENERGY_ROYALTY_DECIMAL.detect({ evidence: [interest('OG-9', 'LS-9', 'mineral', '0.5', '0.09375'), lease('LS-9', '80', { royalty_rate: '0.1875' })], pages: [] })).toEqual([]);
  });

  it('measures decline year on year in BOE and compares it with the report’s assumption', () => {
    const steep = [interest('OG-1', 'LS-1'), lease('LS-1', '100'), ...history('OG-1', '0.75')];
    const rows = energyRows(steep);
    expect(productionModel(rows).interestDecline?.toFixed(4)).toBe('0.2500');
    const report = page('The reserve report assumes an annual decline of 12% for the producing wells.');
    expect(documentDecline([report])?.percent.toFixed(0)).toBe('12');
    const [finding] = ENERGY_DECLINE_MISMATCH.detect({ evidence: steep, pages: [report] });
    expect(finding).toMatchObject({ direction: -1, quotes: [{ quote: 'The reserve report assumes an annual decline of 12% for the producing wells.' }] });
    expect(finding?.description).toMatch(/fell 25% .* against the 12% annual decline/);
    expect(ENERGY_DECLINE_MISMATCH.detect({ evidence: [interest('OG-1', 'LS-1'), lease('LS-1', '100'), ...history('OG-1', '0.9')], pages: [report] })).toEqual([]);
    // A confirmed entry stands in for the sentence.
    const entry = row('energy.decline_assumption', { value: '10' });
    expect(ENERGY_DECLINE_MISMATCH.detect({ evidence: [...steep, entry], pages: [] })[0]?.evidenceIds).toContain(entry.id);
    // Gas counts at six mcf to the barrel.
    expect(productionModel(energyRows([interest('G-1', 'LS-1'), output('G-1', '2026-09-30', 'gas', '600', '100')])).interestTrailingBoe.toFixed(0)).toBe('100');
  });

  it('quantifies acreage not held by production expiring inside the hold', () => {
    const evidence = [
      interest('OG-1', 'LS-1'),
      ...history('OG-1', '0.9'),
      lease('LS-1', '300'),
      lease('LS-2', '50', { held_by_production: 'no', expires_on: '2027-03-31' }),
      lease('LS-3', '50', { held_by_production: 'no', expires_on: '2028-02-29' }),
      lease('LS-4', '40', { held_by_production: 'no', expires_on: '2035-01-01' }), // outside a five-year hold
      lease('LS-5', '10', { held_by_production: 'no', expires_on: '2026-01-01' }), // already lapsed
    ];
    const rows = energyRows(evidence);
    const exposure = leaseExposure(rows, '2026-09-30', energyHoldYears([]).years);
    expect(exposure.holdEnds).toBe('2031-09-30');
    expect(exposure.share?.toFixed(4)).toBe('0.2222');
    expect(exposure.lapsed).toEqual(['LS-5']);
    expect(monthsBetween('2026-09-30', '2028-02-29')).toBe(17);
    expect(monthsBetween('2026-09-30', '2028-03-31')).toBe(18);
    expect(monthsBetween('2026-09-15', '2026-10-20')).toBe(2);
    const [finding] = ENERGY_LEASE_EXPIRY.detect({ evidence, pages: [] });
    expect(finding?.description).toMatch(/^2 leases covering 22\.2% of the net acres .* within 17 months/);
    expect(energyHoldYears([{ text: 'The buyer plans a hold period of 3 years.' }])).toEqual({ years: 3, stated: true });
  });

  it('reads liability estimates from report sentences, and the obligation they speak of', () => {
    expect(liabilityKindOf('closure of the ash pond')).toBe('ccr');
    expect(liabilityKindOf('decommissioning study')).toBe('aro');
    expect(liabilityKindOf('mine reclamation')).toBe('reclamation');
    expect(liabilityKindOf('groundwater remediation')).toBe('remediation');
    const pages = [page('The closure plan for the Cinder Ridge Station ash pond estimates closure costs of USD 18,400,000. The pond holds 2 million tons of ash.')];
    expect(documentEstimates(pages).map((estimate) => [estimate.kind, estimate.amount.toFixed(0), estimate.currency])).toEqual([['ccr', '18400000', 'USD']]);
  });

  it('drafts an unbooked coal-ash obligation and an ARO shortfall, each priced from the evidence', () => {
    const evidence = [plant('PL-1'), booked('aro', '25200000'), booked('remediation', '1000000')];
    const pages = [
      page('The closure plan for the Cinder Ridge Station ash pond estimates closure and groundwater remediation costs of USD 18,400,000.', 'env'),
      page('The decommissioning study estimates the cost to retire and decommission Cinder Ridge Station at USD 42,000,000.', 'study'),
    ];
    const model = liabilityModel(energyRows(evidence), pages);
    expect(model.lines.map((line) => [line.kind, line.assetId, line.status, line.gap.toFixed(0)])).toEqual([
      ['aro', 'PL-1', 'SHORTFALL', '16800000'],
      ['ccr', 'PL-1', 'UNBOOKED', '18400000'],
    ]);
    const [unbooked] = ENERGY_UNBOOKED_ENVIRONMENTAL.detect({ evidence, pages });
    expect(unbooked).toMatchObject({ title: 'Unbooked environmental liability: Coal ash (CCR) closure at Cinder Ridge Station', direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: 'USD', low: '18400000.00' } });
    const [aro] = ENERGY_ARO_SHORTFALL.detect({ evidence, pages });
    expect(aro).toMatchObject({ title: 'ARO shortfall: Cinder Ridge Station', pricedRisk: { type: 'ESCROW', high: '16800000.00' } });
    expect(aro?.description).toMatch(/books USD 25,200,000 for it \(60\.0% of the estimate\)/);
    // Booked within the margin: no shortfall.
    expect(ENERGY_ARO_SHORTFALL.detect({ evidence: [plant('PL-1'), booked('aro', '40000000')], pages })).toEqual([]);
    // A confirmed entry with the same kind and amount is the same estimate, cited both ways.
    const entry = row('energy.liability_estimate', { kind: 'ccr', asset_ref: 'Cinder Ridge Station', value: '18400000', currency: 'USD' });
    const merged = liabilityModel(energyRows([...evidence, entry]), pages).lines.find((line) => line.kind === 'ccr');
    expect(merged).toMatchObject({ estimateIds: [entry.id] });
    expect(merged?.quotes).toHaveLength(1);
  });

  it('quantifies the contracted share that turns merchant when a PPA ends inside the hold', () => {
    const lines = MONTHS.flatMap((month) => [output('PL-1', month, 'power', '300000', '12000000', 'contracted'), output('PL-1', month, 'power', '60000', '3000000', 'merchant')]);
    const evidence = [plant('PL-1'), ...lines];
    const rows = energyRows(evidence);
    const [cliff] = ppaCliffs(rows, productionModel(rows), 5);
    expect(cliff?.contractedShare?.toFixed(2)).toBe('0.80');
    const [finding] = ENERGY_PPA_CLIFF.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ title: 'PPA cliff: Cinder Ridge Station', direction: 0 });
    expect(finding?.description).toMatch(/80\.0% of its revenue .* contracted and 20\.0% merchant/);
    expect(ENERGY_PPA_CLIFF.detect({ evidence: [plant('PL-1', { ppa_expires_on: '2040-01-01' }), ...lines], pages: [] })).toEqual([]);
  });

  it('flags a stated break in the chain of title, and not a clean opinion', () => {
    const defect = page('Requirement 4: there is a break in the chain of title between the 1962 mineral deed and the 1987 assignment covering Tract 3.');
    expect(ENERGY_TITLE_DEFECT.detect({ evidence: [], pages: [defect] })[0]).toMatchObject({ direction: -1, domain: 'LEGAL' });
    expect(ENERGY_TITLE_DEFECT.detect({ evidence: [], pages: [page('The examiner found no breaks in the chain of title.')] })).toEqual([]);
  });

  it('finds required controls missing from the capex plan, priced at the stated cost', () => {
    const permit = page('The renewed permit requires installation of a dry ash handling system by 2028 at an estimated cost of USD 9,500,000.', 'permit');
    const plan = page('Capital expenditure plan 2027–2031: turbine overhaul, coal yard paving.', 'plan');
    const [finding] = ENERGY_COMPLIANCE_CAPEX_GAP.detect({ evidence: [], pages: [permit, plan] });
    expect(finding).toMatchObject({ title: 'Compliance capex gap: dry ash handling system', pricedRisk: { type: 'REMEDIATION_COST', low: '9500000.00' } });
    expect(finding?.quotes).toHaveLength(2);
    expect(ENERGY_COMPLIANCE_CAPEX_GAP.detect({ evidence: [], pages: [permit, page('Capital expenditure plan: dry ash handling system, 2027.', 'plan')] })).toEqual([]);
  });

  it('says a reserve report is missing rather than estimating reserves', () => {
    const evidence = [interest('OG-1', 'LS-1'), lease('LS-1', '100'), ...history('OG-1', '0.9')];
    expect(ENERGY_RESERVE_REPORT_MISSING.detect({ evidence, pages: [] })[0]).toMatchObject({ title: 'Reserve report missing', direction: 0 });
    expect(ENERGY_RESERVE_REPORT_MISSING.detect({ evidence, pages: [page('Third-party reserve report as of 30 September 2026.')] })).toEqual([]);
    expect(ENERGY_RESERVE_REPORT_MISSING.detect({ evidence: [...evidence, row('energy.reserves', { category: 'PDP', value: '1240' })], pages: [] })).toEqual([]);
  });

  it('reports the register as figures, each naming the import a missing figure needs', () => {
    const empty = energyMetrics({ currency: 'USD', evidence: [] });
    expect(empty.metrics.find((metric) => metric.key === 'capacity_mw')).toMatchObject({ value: null, needs: ['ENERGY_PLANTS'] });
    const lines = MONTHS.map((month) => output('PL-1', month, 'power', '219000', '10000000', 'contracted'));
    const full = energyMetrics({ currency: 'USD', evidence: [plant('PL-1'), ...lines] });
    const value = (key: string) => full.metrics.find((metric) => metric.key === key)?.value;
    expect(value('capacity_mw')).toBe('600.0');
    // 12 × 219,000 MWh ÷ (600 MW × 8,760 h) = 0.5.
    expect(value('capacity_factor')).toBe('0.5000');
    expect(value('contracted_share')).toBe('1.0000');
  });
});
