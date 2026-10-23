import { D, parseDecimal, sum } from '../../metrics/decimal';
import type { PackRuleEvidence } from '../rule-types';

export const UNIT = 'multifamily.unit';
export const T12 = 'multifamily.t12_month';
export const DELINQUENCY = 'multifamily.delinquency';
export const INSPECTION = 'multifamily.inspection';

export type Decimal = InstanceType<typeof D>;
export const amount = (row: PackRuleEvidence, field: string): Decimal => parseDecimal(row.canonical[field]) ?? new D(0);
export const of = (evidence: readonly PackRuleEvidence[], type: string) => evidence.filter((row) => row.evidenceType === type);
export const total = (rows: readonly PackRuleEvidence[], field: string) => sum(rows.map((row) => amount(row, field)));
export const occupied = (units: readonly PackRuleEvidence[]) => units.filter((row) => row.canonical['status'] === 'occupied');
export const pct = (value: Decimal) => `${value.times(100).toFixed(1)}%`;
export const grouped = (value: Decimal) => value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Loss-to-lease over occupied units: Σ(market − in place) ÷ Σ market. Null without market rent. */
export function lossToLease(units: readonly PackRuleEvidence[]): { ratio: Decimal; monthlyGap: Decimal; units: PackRuleEvidence[] } | null {
  const rows = occupied(units);
  const market = total(rows, 'market_rent');
  if (market.isZero()) return null;
  const gap = market.minus(total(rows, 'in_place_rent'));
  return { ratio: gap.div(market), monthlyGap: gap, units: rows.filter((row) => amount(row, 'market_rent').greaterThan(amount(row, 'in_place_rent'))) };
}
