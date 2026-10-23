import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { multifamilyMetrics } from './metrics';
import { MULTIFAMILY_DEFERRED_MAINTENANCE, MULTIFAMILY_DELINQUENCY_CONCENTRATION, MULTIFAMILY_LOSS_TO_LEASE, MULTIFAMILY_OM_NOI } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const unit = (id: string, building: string, status: string, inPlace: string, market: string) =>
  row(id, 'multifamily.unit', { unit: id, building, status, in_place_rent: inPlace, market_rent: market });
const units = [unit('A01', 'A', 'occupied', '900.00', '1000.00'), unit('A02', 'A', 'occupied', '1000.00', '1000.00'), unit('B01', 'B', 'vacant', '0.00', '1100.00'), unit('B02', 'B', 'occupied', '1100.00', '1200.00')];
const months = Array.from({ length: 12 }, (_, index) => row(`M${index}`, 'multifamily.t12_month', { month: `2026-${String(index + 1).padStart(2, '0')}`, net_operating_income: '10000.00' }));
const inspections = [row('I1', 'multifamily.inspection', { unit: 'A01', building: 'A', estimated_repair_cost: '5000.00' }), row('I2', 'multifamily.inspection', { unit: 'B01', building: 'B', estimated_repair_cost: '3000.00' }), row('I3', 'multifamily.inspection', { unit: 'A02', building: 'A', estimated_repair_cost: '0.00' })];
const delinquency = [row('D1', 'multifamily.delinquency', { unit: 'B02', building: 'B', balance_due: '1100.00' }), row('D2', 'multifamily.delinquency', { unit: 'B01', building: 'B', balance_due: '500.00' }), row('D3', 'multifamily.delinquency', { unit: 'A01', building: 'A', balance_due: '200.00' })];
const memorandum: PackRulePage = { documentId: '01900000-0000-7000-8000-0000000f0001', pageNumber: 1, text: 'Larkfield — offering memorandum\n4 units. Stabilized net operating income: USD 150,000.\nCapital plan: USD 4,000 (USD 1,000 per door) covers all deferred maintenance.' };
const evidence = [...units, ...months, ...inspections, ...delinquency];

describe('multifamily metrics', () => {
  it('computes occupancy, loss-to-lease, NOI, delinquency and repairs per door in decimals', () => {
    const report = multifamilyMetrics({ currency: 'USD', evidence });
    const value = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric.value]));
    expect(report).toMatchObject({ calculator: 'multifamily-metrics', version: 'multifamily-metrics-1', currency: 'USD' });
    expect(value).toMatchObject({
      occupancy: '0.7500',
      units: '4',
      annual_in_place_rent: '36000.00',
      loss_to_lease: '0.0625', // (100 + 0 + 100) ÷ 3,200
      t12_noi: '120000.00',
      delinquent_balance: '1800.00',
      delinquent_units: '3',
      capex_per_door: '2000.00',
    });
  });

  it('says which import is missing instead of inventing a figure', () => {
    const report = multifamilyMetrics({ currency: 'EUR', evidence: [] });
    const noi = report.metrics.find((metric) => metric.key === 't12_noi');
    expect(noi).toMatchObject({ value: null, unavailableReason: 'Import the T-12 operating statement.' });
  });
});

describe('multifamily rules', () => {
  it('memorandum NOI above the T-12 is a neutral finding citing both', () => {
    const [finding] = MULTIFAMILY_OM_NOI.detect({ evidence, pages: [memorandum] });
    expect(finding).toMatchObject({ domain: 'FINANCIAL', direction: 0, severity: 'HIGH' });
    expect(finding?.description).toContain('USD 150,000');
    expect(finding?.description).toContain('USD 120,000 (25.0% higher)');
    expect(finding?.quotes?.[0]?.quote).toBe('net operating income: USD 150,000');
    expect(finding?.evidenceIds).toHaveLength(12);
    expect(MULTIFAMILY_OM_NOI.detect({ evidence, pages: [{ ...memorandum, text: 'Net operating income: USD 121,000.' }] })).toEqual([]);
  });

  it('deferred maintenance above the capital plan is priced as remediation', () => {
    const [finding] = MULTIFAMILY_DEFERRED_MAINTENANCE.detect({ evidence, pages: [memorandum] });
    expect(finding).toMatchObject({ domain: 'PROPERTY', direction: -1, severity: 'HIGH', evidenceIds: ['I1', 'I2'] });
    expect(finding?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency: 'USD', low: '4000.00', high: '8000.00' });
    expect(finding?.description).toContain('USD 2,000 per door across 4 units');
    expect(MULTIFAMILY_DEFERRED_MAINTENANCE.detect({ evidence, pages: [{ ...memorandum, text: 'Capital plan: USD 9,000.' }] })).toEqual([]);
  });

  it('delinquency concentrated in one building is neutral', () => {
    const [finding] = MULTIFAMILY_DELINQUENCY_CONCENTRATION.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ title: 'Delinquency concentrated in Building B', direction: 0, evidenceIds: ['D1', 'D2'] });
    expect(finding?.description).toMatch(/^2 of 3 delinquent units \(66\.7%\)/);
  });

  it('loss-to-lease is confirmed value, never a price increase', () => {
    const [finding] = MULTIFAMILY_LOSS_TO_LEASE.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ domain: 'PROPERTY', direction: 1, evidenceIds: ['A01', 'B02'] });
    expect(finding?.pricedRisk).toBeUndefined();
    expect(finding?.valueConfirmation?.basis).toContain('6.2%'); // 6.25% rounded half-to-even, as everywhere
    expect(MULTIFAMILY_LOSS_TO_LEASE.detect({ evidence: [unit('X', 'A', 'occupied', '1000.00', '1010.00')], pages: [] })).toEqual([]);
  });
});
