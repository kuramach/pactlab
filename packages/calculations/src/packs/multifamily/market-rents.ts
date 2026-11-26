import { D, parseDecimal } from '../../metrics/decimal';
import type { PackRuleEvidence } from '../rule-types';
import { amount, occupied, type Decimal } from './shared';

/**
 * Market rents for a rent roll (T-158, ADR 0045): the rent roll's units grouped into floor plans, one
 * market estimate per plan (RentCast), and each occupied unit compared with its plan's estimate. All
 * deterministic: the provider supplies the estimate, code does every comparison.
 */
export const MARKET_RENT = 'market.rent_estimate';
/** The rent roll's evidence type (re-exported for the market-rents service). */
export { UNIT as RENT_ROLL_UNIT } from './shared';
/** What a figure needs while market rents have not been retrieved (not an import: the Home card offers the retrieval). */
export const MARKET_RENTS_NEED = 'MARKET_RENTS';
/**
 * Most provider calls one retrieval makes for one pact. RentCast's plans include 50 (Developer) to 25,000
 * (Scale) requests a month, overage billed per request (rentcast.io/api, read 2026-11-25); a garden-style
 * community has well under ten floor plans, and a same-day re-run makes no calls.
 */
export const MAX_FLOOR_PLAN_CALLS = 10;
/** Comparables asked for per estimate. */
export const MARKET_COMP_COUNT = 15;

export interface FloorPlan {
  /** Stable, e.g. `2BR` or `2BR/1BA`; the estimate's source record id. */
  readonly key: string;
  /** e.g. "Studio", "2 bed", "2 bed, 1 bath". */
  readonly label: string;
  readonly bedrooms: number;
  /** Null when the rent roll does not say. */
  readonly bathrooms: string | null;
}

export interface FloorPlanGroup {
  readonly plan: FloorPlan;
  readonly units: number;
  readonly occupied: number;
  /** Median rentable area of the plan's units with one, whole square feet; null when none has it. */
  readonly medianSquareFeet: string | null;
}

const STUDIO = /\b(?:studio|efficiency)\b/i;
const BEDS = /(\d+)\s*(?:bedrooms?|beds?|br|bd)(?![a-z])/i;
const BATHS = /(\d+(?:\.5)?)\s*(?:bathrooms?|baths?|ba)(?![a-z])/i;
const BY = /^\s*(\d+)\s*x\s*(\d+(?:\.5)?)\s*$/i;

const whole = (value: string | null | undefined): number | null => {
  const parsed = parseDecimal(value ?? null);
  return parsed && parsed.isInteger() && parsed.greaterThanOrEqualTo(0) && parsed.lessThan(20) ? parsed.toNumber() : null;
};
const halves = (value: string | null | undefined): string | null => {
  const parsed = parseDecimal(value ?? null);
  return parsed && parsed.greaterThan(0) && parsed.lessThan(20) && parsed.times(2).isInteger() ? parsed.toString() : null;
};

/** A unit's floor plan from the rent roll: its bedrooms and bathrooms fields if present, else its unit type ("1BR", "2BR/2BA", "2x1", "Studio"). */
export function floorPlanOf(unit: PackRuleEvidence): FloorPlan | null {
  const type = unit.canonical['type'] ?? '';
  const by = BY.exec(type);
  const bedrooms = whole(unit.canonical['bedrooms']) ?? (by ? whole(by[1]) : null) ?? (STUDIO.test(type) ? 0 : whole(BEDS.exec(type)?.[1]));
  if (bedrooms === null) return null;
  const bathrooms = halves(unit.canonical['bathrooms']) ?? (by ? halves(by[2]) : null) ?? halves(BATHS.exec(type)?.[1]);
  const beds = bedrooms === 0 ? 'Studio' : `${bedrooms} bed`;
  return { key: `${bedrooms}BR${bathrooms ? `/${bathrooms}BA` : ''}`, label: bathrooms ? `${beds}, ${bathrooms} bath` : beds, bedrooms, bathrooms };
}

/** The middle value (the mean of the two middle ones for an even count), unrounded. */
export function median(values: readonly Decimal[]): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : (sorted[middle - 1] ?? new D(0)).plus(sorted[middle] ?? new D(0)).div(2);
}

/** The median of decimal strings at a fixed scale (nulls and non-decimals skipped); null when there are none. */
export function medianString(values: readonly (string | null)[], places: number): string | null {
  const middle = median(values.flatMap((value) => {
    const parsed = parseDecimal(value);
    return parsed ? [parsed] : [];
  }));
  return middle ? middle.toFixed(places) : null;
}

/** The rent roll's floor plans, most units first, and how many units have none (no bedroom count in their type). */
export function floorPlanGroups(units: readonly PackRuleEvidence[]): { groups: FloorPlanGroup[]; unplanned: number } {
  const byPlan = new Map<string, { plan: FloorPlan; rows: PackRuleEvidence[] }>();
  let unplanned = 0;
  for (const unit of units) {
    const plan = floorPlanOf(unit);
    if (!plan) {
      unplanned += 1;
      continue;
    }
    const entry = byPlan.get(plan.key) ?? { plan, rows: [] };
    entry.rows.push(unit);
    byPlan.set(plan.key, entry);
  }
  const groups = [...byPlan.values()].map(({ plan, rows }) => {
    const areas = rows.flatMap((row) => {
      const area = parseDecimal(row.canonical['sqft'] ?? null);
      return area && area.greaterThan(0) ? [area] : [];
    });
    const middle = median(areas);
    return { plan, units: rows.length, occupied: occupied(rows).length, medianSquareFeet: middle ? middle.toFixed(0) : null };
  });
  groups.sort((a, b) => b.units - a.units || a.plan.key.localeCompare(b.plan.key));
  return { groups, unplanned };
}

/** The estimate each floor plan uses: the newest retrieval, then the newest record (ids are time-ordered). */
export function latestEstimates(evidence: readonly PackRuleEvidence[]): Map<string, PackRuleEvidence> {
  const latest = new Map<string, PackRuleEvidence>();
  for (const row of evidence) {
    if (row.evidenceType !== MARKET_RENT) continue;
    const plan = row.canonical['floor_plan'] ?? row.sourceRecordId;
    const held = latest.get(plan);
    const newer = !held || (row.canonical['retrieved_on'] ?? '') > (held.canonical['retrieved_on'] ?? '') || ((row.canonical['retrieved_on'] ?? '') === (held.canonical['retrieved_on'] ?? '') && row.id > held.id);
    if (newer) latest.set(plan, row);
  }
  return latest;
}

export interface MarketComparison {
  /** Occupied units whose floor plan has an estimate, each with it. */
  readonly covered: readonly { readonly unit: PackRuleEvidence; readonly estimate: PackRuleEvidence }[];
  readonly occupied: number;
  /** The estimates the covered units use, in floor-plan order. */
  readonly estimates: readonly PackRuleEvidence[];
  /** Currencies of those estimates (RentCast: USD). */
  readonly currencies: readonly string[];
  /** Σ market and Σ in-place monthly rent over covered units. */
  readonly market: Decimal;
  readonly inPlace: Decimal;
}

/** Every occupied unit against its floor plan's market estimate. */
export function marketComparison(units: readonly PackRuleEvidence[], evidence: readonly PackRuleEvidence[]): MarketComparison {
  const estimates = latestEstimates(evidence);
  const live = occupied(units);
  const covered = live.flatMap((unit) => {
    const plan = floorPlanOf(unit);
    const estimate = plan ? estimates.get(plan.key) : undefined;
    return estimate ? [{ unit, estimate }] : [];
  });
  const used = [...new Map(covered.map(({ estimate }) => [estimate.id, estimate])).values()].sort((a, b) => (a.canonical['floor_plan'] ?? '').localeCompare(b.canonical['floor_plan'] ?? ''));
  let market = new D(0);
  let inPlace = new D(0);
  for (const { unit, estimate } of covered) {
    market = market.plus(amount(estimate, 'rent'));
    inPlace = inPlace.plus(amount(unit, 'in_place_rent'));
  }
  return { covered, occupied: live.length, estimates: used, currencies: [...new Set(used.map((row) => row.canonical['currency'] ?? 'USD'))], market, inPlace };
}
