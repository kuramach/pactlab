import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { floorPlanGroups, floorPlanOf, latestEstimates, median } from './market-rents';
import { multifamilyMetrics } from './metrics';
import { BELOW_MARKET_RANGE_SHARE, MULTIFAMILY_BELOW_MARKET_RANGE, MULTIFAMILY_DEFERRED_MAINTENANCE, MULTIFAMILY_DELINQUENCY_CONCENTRATION, MULTIFAMILY_LOSS_TO_LEASE, MULTIFAMILY_OM_NOI } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const unit = (id: string, building: string, status: string, inPlace: string, market: string) =>
  row(id, 'multifamily.unit', { unit: id, building, status, in_place_rent: inPlace, market_rent: market });
const units0 = [unit('A01', 'A', 'occupied', '900.00', '1000.00'), unit('A02', 'A', 'occupied', '1000.00', '1000.00'), unit('B01', 'B', 'vacant', '0.00', '1100.00'), unit('B02', 'B', 'occupied', '1100.00', '1200.00')];
const months = Array.from({ length: 12 }, (_, index) => row(`M${index}`, 'multifamily.t12_month', { month: `2026-${String(index + 1).padStart(2, '0')}`, net_operating_income: '10000.00' }));
const inspections = [row('I1', 'multifamily.inspection', { unit: 'A01', building: 'A', estimated_repair_cost: '5000.00' }), row('I2', 'multifamily.inspection', { unit: 'B01', building: 'B', estimated_repair_cost: '3000.00' }), row('I3', 'multifamily.inspection', { unit: 'A02', building: 'A', estimated_repair_cost: '0.00' })];
const delinquency = [row('D1', 'multifamily.delinquency', { unit: 'B02', building: 'B', balance_due: '1100.00' }), row('D2', 'multifamily.delinquency', { unit: 'B01', building: 'B', balance_due: '500.00' }), row('D3', 'multifamily.delinquency', { unit: 'A01', building: 'A', balance_due: '200.00' })];
const memorandum: PackRulePage = { documentId: '01900000-0000-7000-8000-0000000f0001', pageNumber: 1, text: 'Larkfield — offering memorandum\n4 units. Stabilized net operating income: USD 150,000.\nCapital plan: USD 4,000 (USD 1,000 per door) covers all deferred maintenance.' };
const units = units0.map((entry) => ({ ...entry, canonical: { ...entry.canonical, type: '1BR' } }));
const evidence = [...units, ...months, ...inspections, ...delinquency];
/** A stored RentCast estimate for one floor plan (as the market-rents service writes it). */
const estimate = (id: string, plan: string, rent: string, low: string, high: string, retrievedOn = '2026-11-25') =>
  row(id, 'market.rent_estimate', { floor_plan: plan, floor_plan_label: plan, rent, rent_range_low: low, rent_range_high: high, currency: 'USD', retrieved_on: retrievedOn, source: 'RentCast' });
// The four units above have no type: give them floor plans.
const typed = (id: string, type: string, status: string, inPlace: string, market: string, sqft = '') => row(id, 'multifamily.unit', { unit: id, building: 'A', type, sqft, status, in_place_rent: inPlace, market_rent: market });
const estimates = [estimate('E1', '1BR', '1100.00', '1050.00', '1150.00')];

describe('multifamily metrics', () => {
  it('computes occupancy, loss-to-lease, NOI, delinquency and repairs per door in decimals', () => {
    const report = multifamilyMetrics({ currency: 'USD', evidence });
    const value = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric.value]));
    expect(report).toMatchObject({ calculator: 'multifamily-metrics', version: 'multifamily-metrics-3', currency: 'USD' });
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
    expect(noi).toMatchObject({ value: null, unavailableReason: 'Import the T-12 operating statement.', needs: ['MULTIFAMILY_T12'] });
  });

  it('names the import each missing figure needs, so it can be asked of the seller (Kumar, 2026-11-25)', () => {
    const empty = multifamilyMetrics({ currency: 'USD', evidence: [] });
    const needs = Object.fromEntries(empty.metrics.map((metric) => [metric.key, metric.needs ?? null]));
    expect(needs).toMatchObject({ occupancy: ['MULTIFAMILY_RENT_ROLL'], t12_noi: ['MULTIFAMILY_T12'], delinquent_balance: ['MULTIFAMILY_DELINQUENCY'], capex_per_door: ['MULTIFAMILY_RENT_ROLL', 'MULTIFAMILY_INSPECTION'] });
    expect(needs).toMatchObject({ market_rent_annual: ['MULTIFAMILY_RENT_ROLL'] });
    const full = multifamilyMetrics({ currency: 'USD', evidence: [...evidence, ...estimates] });
    // The current-year figures are all there; the five-year figures (T-183) still ask for the history.
    expect(full.metrics.filter((metric) => metric.coverage === undefined).every((metric) => metric.needs === undefined)).toBe(true);
    expect(full.metrics.find((metric) => metric.key === 'noi_cagr')?.needs).toEqual(['INCOME_STATEMENT']);
    expect(full.metrics.find((metric) => metric.key === 'occupancy_average')?.needs).toEqual(['MULTIFAMILY_OCCUPANCY']);
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

describe('market rents (T-158)', () => {
  it('reads each unit\'s floor plan from its type, or its bedroom and bathroom fields', () => {
    const plan = (type: string, extra: Record<string, string> = {}) => floorPlanOf(row('U', 'multifamily.unit', { type, ...extra }))?.key ?? null;
    expect(['1BR', '2 BR', '2BR/2BA', '2 bed 1 bath', '2bd2ba', '3x2', 'Studio', '1BR/1.5BA', 'Penthouse', ''].map((type) => plan(type))).toEqual(['1BR', '2BR', '2BR/2BA', '2BR/1BA', '2BR/2BA', '3BR/2BA', '0BR', '1BR/1.5BA', null, null]);
    expect(plan('', { bedrooms: '2', bathrooms: '1' })).toBe('2BR/1BA');
    expect(floorPlanOf(row('U', 'multifamily.unit', { type: 'studio' }))?.label).toBe('Studio');
    expect(floorPlanOf(row('U', 'multifamily.unit', { type: '2BR/2BA' }))?.label).toBe('2 bed, 2 bath');
  });

  it('groups the rent roll by floor plan, most units first, with the median square footage', () => {
    const roll = [typed('1', '2BR', 'occupied', '1', '1', '950'), typed('2', '2BR', 'vacant', '0', '1', '970'), typed('3', '2BR', 'occupied', '1', '1', '1010'), typed('4', '1BR', 'occupied', '1', '1', '680'), typed('5', '1BR', 'occupied', '1', '1', '700'), typed('6', 'Loft', 'occupied', '1', '1')];
    const { groups, unplanned } = floorPlanGroups(roll);
    expect(groups.map((group) => [group.plan.key, group.units, group.occupied, group.medianSquareFeet])).toEqual([['2BR', 3, 2, '970'], ['1BR', 2, 2, '690']]);
    expect(unplanned).toBe(1);
    expect(median([])).toBeNull();
  });

  it('uses the newest estimate for each floor plan', () => {
    const latest = latestEstimates([estimate('E1', '1BR', '1000.00', '950.00', '1050.00', '2026-11-20'), estimate('E2', '1BR', '1100.00', '1050.00', '1150.00', '2026-11-25'), estimate('E0', '2BR', '1500.00', '1400.00', '1600.00')]);
    expect(latest.get('1BR')?.id).toBe('E2');
    expect(latest.get('2BR')?.id).toBe('E0');
  });

  it('works out market rent and loss-to-lease vs market over occupied units, cited, labelled apart from the rent roll\'s', () => {
    const report = multifamilyMetrics({ currency: 'USD', evidence: [...units, ...estimates] });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    // Three occupied 1BR units at a 1,100 estimate: 3,300 a month, 39,600 a year; in place 900 + 1,000 + 1,100 = 3,000.
    expect(byKey['market_rent_annual']).toMatchObject({ value: '39600.00', label: 'Market rent, annual (from RentCast)', source: 'RentCast', evidenceIds: ['E1'], sourceCount: 4 });
    expect(byKey['loss_to_lease_market']).toMatchObject({ value: '0.0909', label: 'Loss-to-lease vs market (from RentCast)', source: 'RentCast' }); // 300 ÷ 3,300
    expect(byKey['market_rent_annual']?.formula).toContain('3 of 3 occupied units have an estimate');
    expect(byKey['loss_to_lease']).toMatchObject({ value: '0.0625', label: 'Loss-to-lease (from the rent roll)', source: 'Rent roll' });
  });

  it('asks for the retrieval while there are no estimates, and never mixes currencies', () => {
    const none = multifamilyMetrics({ currency: 'USD', evidence: units });
    expect(none.metrics.find((metric) => metric.key === 'market_rent_annual')).toMatchObject({ value: null, needs: ['MARKET_RENTS'], unavailableReason: 'Check rents against the market (RentCast).' });
    const euro = multifamilyMetrics({ currency: 'EUR', evidence: [...units, ...estimates] });
    expect(euro.metrics.find((metric) => metric.key === 'loss_to_lease_market')).toMatchObject({ value: null, unavailableReason: 'Market estimates are in USD; this pact reports in EUR.' });
    const otherPlan = multifamilyMetrics({ currency: 'USD', evidence: [...units, estimate('E9', '3BR', '2000.00', '1900.00', '2100.00')] });
    expect(otherPlan.metrics.find((metric) => metric.key === 'market_rent_annual')).toMatchObject({ value: null, needs: ['MARKET_RENTS'] });
  });

  it('drafts the below-range finding at the named share, citing the estimates and the units', () => {
    // A01 (900) and B02 (1,100 vs a 1,150 low on 2BR) are below their ranges; A02 (1,000) is not (1BR low 950).
    const roll = [typed('A01', '1BR', 'occupied', '900.00', '0'), typed('A02', '1BR', 'occupied', '1000.00', '0'), typed('B02', '2BR', 'occupied', '1100.00', '0'), typed('B03', '2BR', 'vacant', '0.00', '0')];
    const market = [estimate('E1', '1BR', '1000.00', '950.00', '1050.00'), estimate('E2', '2BR', '1250.00', '1150.00', '1350.00')];
    const [finding] = MULTIFAMILY_BELOW_MARKET_RANGE.detect({ evidence: [...roll, ...market], pages: [] });
    expect(BELOW_MARKET_RANGE_SHARE).toBe('0.25');
    expect(finding).toMatchObject({ domain: 'PROPERTY', direction: 1, severity: 'LOW', title: 'In-place rents below the market range (RentCast)', evidenceIds: ['E1', 'E2', 'A01', 'B02'] });
    expect(finding?.pricedRisk).toBeUndefined();
    expect(finding?.description).toMatch(/^2 of 3 occupied units with a market estimate \(66\.7%\) rent below/);
    expect(finding?.description).toContain('The rule drafts at 25.0% of units or more');
    expect(finding?.description).toContain('3,000 a year'); // (1,000 − 900 + 1,250 − 1,100) × 12
  });

  it('stays quiet under the threshold, for one unit, or without estimates', () => {
    const market = [estimate('E1', '1BR', '1000.00', '950.00', '1050.00')];
    const many = Array.from({ length: 9 }, (_, index) => typed(`U${index}`, '1BR', 'occupied', index < 2 ? '900.00' : '1000.00', '0'));
    expect(MULTIFAMILY_BELOW_MARKET_RANGE.detect({ evidence: [...many, ...market], pages: [] })).toEqual([]); // 2 of 9 = 22.2%
    expect(MULTIFAMILY_BELOW_MARKET_RANGE.detect({ evidence: [typed('X', '1BR', 'occupied', '900.00', '0'), ...market], pages: [] })).toEqual([]);
    expect(MULTIFAMILY_BELOW_MARKET_RANGE.detect({ evidence: many, pages: [] })).toEqual([]);
  });
});
