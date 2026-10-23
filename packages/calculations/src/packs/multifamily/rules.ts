import { D } from '../../metrics/decimal';
import { findMatch, MAX_CITED, type PackRule } from '../rule-types';
import { amount, DELINQUENCY, grouped, INSPECTION, lossToLease, of, pct, T12, total, UNIT } from './shared';

/**
 * Multifamily pack rules (T-059, ADR 0008 pack 7). Deterministic, versioned,
 * decimal-only; drafts for a reviewer. Upside (loss-to-lease) is confirmed
 * value, never a reason to pay more.
 */
const STATED_NOI = /net operating income\s*:?\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const CAPITAL_PLAN = /capital plan\s*:?\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const figure = (text: string | undefined) => new D((text ?? '0').replaceAll(',', ''));

export const MULTIFAMILY_OM_NOI: PackRule = {
  id: 'multifamily-om-noi',
  version: '1',
  evidenceTypes: [T12],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const months = of(evidence, T12);
    const stated = findMatch(pages, STATED_NOI);
    if (months.length === 0 || !stated) return [];
    const actual = total(months, 'net_operating_income');
    const claimed = figure(stated.match[2]);
    if (actual.lessThanOrEqualTo(0) || claimed.lessThanOrEqualTo(actual.times('1.02'))) return [];
    const currency = stated.match[1]?.toUpperCase() ?? '';
    return [
      {
        key: `${stated.page.documentId}:${stated.page.pageNumber}`,
        domain: 'FINANCIAL',
        title: 'Offering memorandum NOI above the T-12',
        description: `The memorandum states net operating income of ${currency} ${grouped(claimed)}; the trailing twelve months sum to ${currency} ${grouped(actual)} (${pct(claimed.div(actual).minus(1))} higher). The memorandum's figure uses pro-forma rents.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'Value the property on the T-12 NOI; the memorandum figure is pro forma, so no separate price adjustment.',
        evidenceIds: months.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: stated.page.documentId, pageNumber: stated.page.pageNumber, quote: stated.quote }],
      },
    ];
  },
};

export const MULTIFAMILY_DEFERRED_MAINTENANCE: PackRule = {
  id: 'multifamily-deferred-maintenance',
  version: '1',
  evidenceTypes: [INSPECTION, UNIT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const repairs = of(evidence, INSPECTION).filter((row) => amount(row, 'estimated_repair_cost').greaterThan(0));
    const plan = findMatch(pages, CAPITAL_PLAN);
    if (repairs.length === 0 || !plan) return [];
    const estimate = total(repairs, 'estimated_repair_cost');
    const budget = figure(plan.match[2]);
    if (estimate.lessThanOrEqualTo(budget)) return [];
    const currency = plan.match[1]?.toUpperCase() ?? '';
    const doors = of(evidence, UNIT).length || of(evidence, INSPECTION).length;
    return [
      {
        key: `${plan.page.documentId}:${plan.page.pageNumber}`,
        domain: 'PROPERTY',
        title: 'Deferred maintenance above the capital plan',
        description: `Unit inspections estimate ${currency} ${grouped(estimate)} of repairs (${currency} ${grouped(estimate.div(doors))} per door across ${doors} units) against a ${currency} ${grouped(budget)} capital plan.`,
        severity: estimate.greaterThan(budget.times('1.25')) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: {
          type: 'REMEDIATION_COST',
          currency,
          low: estimate.minus(budget).toFixed(2),
          high: estimate.toFixed(2),
          basis: 'Inspection repair estimates; low end is the excess over the capital plan, high end the full estimate if the plan is not funded.',
        },
        evidenceIds: repairs.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: plan.page.documentId, pageNumber: plan.page.pageNumber, quote: plan.quote }],
      },
    ];
  },
};

export const MULTIFAMILY_DELINQUENCY_CONCENTRATION: PackRule = {
  id: 'multifamily-delinquency-concentration',
  version: '1',
  evidenceTypes: [DELINQUENCY],
  detect: ({ evidence }) => {
    const rows = of(evidence, DELINQUENCY);
    if (rows.length < 2) return [];
    const byBuilding = new Map<string, typeof rows>();
    for (const row of rows) {
      const building = row.canonical['building'] ?? '';
      byBuilding.set(building, [...(byBuilding.get(building) ?? []), row]);
    }
    const [building, units] = [...byBuilding.entries()].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))[0] ?? ['', []];
    const share = new D(units.length).div(rows.length);
    if (units.length < 2 || share.lessThan('0.5')) return [];
    return [
      {
        key: `building:${building}`,
        domain: 'OPERATIONAL',
        title: `Delinquency concentrated in Building ${building}`,
        description: `${units.length} of ${rows.length} delinquent units (${pct(share)}) are in Building ${building}, owing ${grouped(total(units, 'balance_due'))} in the deal's currency.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A collections covenant and a downside case, not a price term.',
        evidenceIds: units.slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

export const MULTIFAMILY_LOSS_TO_LEASE: PackRule = {
  id: 'multifamily-loss-to-lease',
  version: '1',
  evidenceTypes: [UNIT],
  detect: ({ evidence }) => {
    const ltl = lossToLease(of(evidence, UNIT));
    if (!ltl || ltl.ratio.lessThanOrEqualTo('0.02')) return [];
    return [
      {
        key: 'occupied-units',
        domain: 'PROPERTY',
        title: 'Loss-to-lease (upside, not price)',
        description: `Occupied units rent ${pct(ltl.ratio)} below market: ${grouped(ltl.monthlyGap.times(12))} a year in the deal's currency if leases reset to market. Confirmed value — never a reason to pay more.`,
        severity: 'LOW',
        confidence: 'MEDIUM',
        direction: 1,
        valueConfirmation: {
          valueDriver: 'Below-market in-place rents (loss-to-lease)',
          impliedValue: null,
          basis: `Rent roll: market rent exceeds in-place rent by ${pct(ltl.ratio)} across occupied units (${grouped(ltl.monthlyGap.times(12))} a year).`,
        },
        evidenceIds: ltl.units.slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

export const MULTIFAMILY_RULES: readonly PackRule[] = [MULTIFAMILY_OM_NOI, MULTIFAMILY_DEFERRED_MAINTENANCE, MULTIFAMILY_DELINQUENCY_CONCENTRATION, MULTIFAMILY_LOSS_TO_LEASE];
