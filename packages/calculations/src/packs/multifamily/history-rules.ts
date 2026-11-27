import { D } from '../../metrics/decimal';
import { grouped, percent } from '../common';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleProposal } from '../rule-types';
import { recentRunCheck } from '../history-span';
import { cagr, MULTIFAMILY_KEY_EXPENSES, multifamilyHistory, OCCUPANCY, UNIT_SNAPSHOT, yearRanges, type OccupancyYear, type OperatingYear } from './history';
import { T12, type Decimal } from './shared';

/**
 * Multifamily checks over five years of history (T-183, ADR 0057). Deterministic, versioned, decimal-only,
 * drafts for a reviewer, each cited to the imported rows behind it. Thresholds are named constants, listed
 * in docs/agent/packs.md. The rules read the imported years only: nothing is drafted about a year not imported.
 */

/** Occupancy erosion: down this many points (as a fraction), first year to last… */
export const OCCUPANCY_EROSION_POINTS = '0.03';
/** …or a year's average below this in any of the last three years. */
export const OCCUPANCY_FLOOR = '0.90';
/** Rent growth below expense growth: an expense's compound growth beats rent's by this many points or more. */
export const RENT_EXPENSE_GAP_POINTS = '0.02';
/** A last-year spike: the latest year's NOI growth beats the earlier years' average by this many points or more. */
export const NOI_SPIKE_POINTS = '0.05';

const fiscal = (year: string) => `FY${year}`;
const span = (first: string, last: string) => (first === last ? fiscal(first) : `${fiscal(first)}–${fiscal(last)}`);
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;
const cite = (...groups: readonly (readonly string[])[]) => {
  // Spread the cap across the groups so each year cited keeps some of its rows.
  const each = Math.max(1, Math.floor(MAX_CITED / Math.max(1, groups.length)));
  return [...new Set(groups.flatMap((ids) => ids.slice(0, each)))].slice(0, MAX_CITED);
};
const HISTORY_TYPES = [PNL_LINE, OCCUPANCY, UNIT_SNAPSHOT, T12];

/** Pact currency, for reading P&L lines: undeclared lines are the pact's, and a line in another currency is left out. */
const currencyOf = (evidence: readonly { evidenceType: string; canonical: Readonly<Record<string, string | null>> }[]) =>
  evidence.find((row) => row.evidenceType === PNL_LINE && row.canonical['currency'])?.canonical['currency'] ?? '';

export const MULTIFAMILY_OCCUPANCY_EROSION: PackRule = {
  id: 'multifamily-occupancy-erosion',
  version: '1',
  evidenceTypes: [OCCUPANCY, UNIT_SNAPSHOT],
  detect: ({ evidence }) => {
    const years = multifamilyHistory(evidence, '').occupancy;
    const first = years[0];
    const last = years.at(-1);
    if (!first || !last || years.length < 2) return [];
    const drop = new D(first.average).minus(last.average);
    const eroded = drop.gte(OCCUPANCY_EROSION_POINTS);
    const low = years.slice(-3).filter((year) => new D(year.average).lt(OCCUPANCY_FLOOR));
    if (!eroded && low.length === 0) return [];
    const line = (year: OccupancyYear) => `${fiscal(year.year)} ${percent(new D(year.average))} (low ${percent(new D(year.low))} in ${year.lowPeriod})`;
    return [
      {
        key: `${first.year}-${last.year}`,
        domain: 'PROPERTY',
        title: `Occupancy eroding, ${span(first.year, last.year)}`,
        description:
          `Average occupancy by year: ${years.map(line).join(', ')}.` +
          (eroded ? ` Down ${points(drop)} from ${fiscal(first.year)} to ${fiscal(last.year)}; the check drafts at ${points(new D(OCCUPANCY_EROSION_POINTS))}.` : '') +
          (low.length ? ` Below ${percent(new D(OCCUPANCY_FLOOR))} in ${low.map((year) => fiscal(year.year)).join(', ')}.` : '') +
          ' From the imported occupancy history; the rent roll shows only today. Price it as a haircut on the occupancy the scenarios assume.',
        severity: eroded && low.length ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(first.evidenceIds, ...low.map((year) => year.evidenceIds), last.evidenceIds),
      },
    ];
  },
};

export const MULTIFAMILY_RENT_BELOW_EXPENSE_GROWTH: PackRule = {
  id: 'multifamily-rent-below-expense-growth',
  version: '1',
  evidenceTypes: [PNL_LINE, OCCUPANCY, UNIT_SNAPSHOT],
  detect: ({ evidence }) => {
    const history = multifamilyHistory(evidence, currencyOf(evidence));
    // Compare like with like: the years both histories hold.
    const shared = history.operating.filter((year) => year.basis !== 'T12' && history.occupancy.some((entry) => entry.year === year.year && entry.averageRent !== null));
    const first = shared[0];
    const last = shared.at(-1);
    if (!first || !last || shared.length < 2) return [];
    const years = Number(last.year) - Number(first.year);
    const rentFirst = history.occupancy.find((year) => year.year === first.year) as OccupancyYear;
    const rentLast = history.occupancy.find((year) => year.year === last.year) as OccupancyYear;
    const rent = cagr(rentFirst.averageRent, rentLast.averageRent, years);
    if (rent === null) return [];
    const expenses: { key: string; label: string; from: string; to: string; ids: (year: OperatingYear) => readonly string[] }[] = [
      { key: 'operating-expenses', label: 'Operating expenses', from: first.expenses, to: last.expenses, ids: (year) => year.evidenceIds },
      ...MULTIFAMILY_KEY_EXPENSES.map((expense) => ({
        key: expense.key,
        label: expense.label,
        from: first.keyExpenses.find((entry) => entry.key === expense.key)?.amount ?? '0',
        to: last.keyExpenses.find((entry) => entry.key === expense.key)?.amount ?? '0',
        ids: (year: OperatingYear) => year.keyExpenses.find((entry) => entry.key === expense.key)?.evidenceIds ?? [],
      })),
    ];
    return expenses.flatMap((expense): PackRuleProposal[] => {
      const growth = cagr(expense.from, expense.to, years);
      if (growth === null || new D(growth).minus(rent).lt(RENT_EXPENSE_GAP_POINTS)) return [];
      return [
        {
          key: `${expense.key}:${first.year}-${last.year}`,
          domain: 'FINANCIAL',
          title: `${expense.label} growing faster than rent, ${span(first.year, last.year)}`,
          description:
            `${expense.label} grew from ${grouped(new D(expense.from))} in ${fiscal(first.year)} to ${grouped(new D(expense.to))} in ${fiscal(last.year)}, ${percent(new D(growth))} a year, ` +
            `while average in-place rent grew ${percent(new D(rent))} a year (${rentFirst.averageRent} to ${rentLast.averageRent} a month). ` +
            `The check drafts at ${points(new D(RENT_EXPENSE_GAP_POINTS))} or more. From the imported P&L and occupancy history; price it as a haircut on the NOI growth the scenarios assume.`,
          severity: new D(growth).minus(rent).gte(new D(RENT_EXPENSE_GAP_POINTS).times(2)) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: cite(expense.ids(first), expense.ids(last), rentFirst.evidenceIds, rentLast.evidenceIds),
        },
      ];
    });
  },
};

export const MULTIFAMILY_NOI_SPIKE: PackRule = {
  id: 'multifamily-noi-spike',
  version: '1',
  evidenceTypes: HISTORY_TYPES,
  detect: ({ evidence }) => {
    const history = multifamilyHistory(evidence, currencyOf(evidence));
    const years = history.operating;
    if (years.length < 3) return [];
    const growths = years.slice(1).flatMap((year, index) => {
      const before = years[index] as OperatingYear;
      return Number(before.year) === Number(year.year) - 1 && new D(before.noi).gt(0) ? [{ year, before, growth: new D(year.noi).div(before.noi).minus(1) }] : [];
    });
    const latest = growths.at(-1);
    const earlier = growths.slice(0, -1);
    if (!latest || latest.year !== years.at(-1) || earlier.length === 0 || !latest.growth.gt(0)) return [];
    const average = earlier.reduce((total, entry) => total.plus(entry.growth), new D(0)).div(earlier.length);
    if (latest.growth.minus(average).lt(NOI_SPIKE_POINTS)) return [];
    const { year, before } = latest;
    // What moved: key expenses that fell against revenue, credits booked against costs, and concessions.
    const share = (entry: OperatingYear, key: string) => {
      const found = entry.keyExpenses.find((expense) => expense.key === key);
      return found && new D(entry.revenue).gt(0) ? new D(found.amount).div(entry.revenue) : null;
    };
    const fell = MULTIFAMILY_KEY_EXPENSES.flatMap((expense) => {
      const from = share(before, expense.key);
      const to = share(year, expense.key);
      return from && to && to.lt(from) && from.minus(to).gte('0.005') ? [`${expense.label.toLowerCase()} fell from ${percent(from)} to ${percent(to)} of revenue`] : [];
    });
    const credits = year.credits.map((credit) => `${credit.account} (${grouped(new D(credit.amount))})`);
    const occupancy = new Map(history.occupancy.map((entry) => [entry.year, entry]));
    const concessions = occupancy.get(year.year)?.concessions && occupancy.get(before.year)?.concessions ? [occupancy.get(before.year)?.concessions ?? '0', occupancy.get(year.year)?.concessions ?? '0'] : null;
    const moved = [
      ...fell,
      ...(credits.length ? [`credits booked against costs: ${credits.join(', ')}`] : []),
      ...(concessions && new D(concessions[1] ?? '0').gt(concessions[0] ?? '0') ? [`concessions rose from ${grouped(new D(concessions[0] ?? '0'))} to ${grouped(new D(concessions[1] ?? '0'))}`] : []),
    ];
    return [
      {
        key: `${year.year}`,
        domain: 'FINANCIAL',
        title: `NOI jump in ${fiscal(year.year)} above the history's trend`,
        description:
          `NOI grew ${percent(latest.growth)} in ${fiscal(year.year)} (${grouped(new D(before.noi))} to ${grouped(new D(year.noi))}), against an average of ${percent(average)} a year across ${yearRanges(earlier.map((entry) => entry.year.year))}. ` +
          `The check drafts at ${points(new D(NOI_SPIKE_POINTS))} above the average. ` +
          (moved.length ? `In ${fiscal(year.year)}: ${moved.join('; ')}. ` : '') +
          'A last-year jump is the "dressed for sale" pattern: check one-off items, deferred maintenance and concessions before using this year\'s NOI as the basis.',
        severity: latest.growth.minus(average).gte(new D(NOI_SPIKE_POINTS).times(2)) ? 'HIGH' : 'MEDIUM',
        confidence: 'MEDIUM',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(year.credits.map((credit) => credit.evidenceId), year.evidenceIds, before.evidenceIds),
      },
    ];
  },
};

/**
 * The recent run better than the long run (T-185): the last five years' NOI margin or average occupancy well above
 * the full history's (`RECENT_RUN_POINTS`, over ten years or more). The reviewer asks whether the price assumes the peak lasts.
 */
export const MULTIFAMILY_RECENT_RUN: PackRule = {
  id: 'multifamily-recent-run',
  version: '1',
  evidenceTypes: HISTORY_TYPES,
  detect: ({ evidence }) => {
    const history = multifamilyHistory(evidence, currencyOf(evidence));
    const margin = recentRunCheck('noi_margin', 'NOI margin', history.operatingAll.map((year) => ({ year: year.year, value: year.margin, evidenceIds: year.evidenceIds })), 'FINANCIAL');
    const occupancy = recentRunCheck('occupancy', 'Occupancy (average)', history.occupancyAll.map((year) => ({ year: year.year, value: year.average, evidenceIds: year.evidenceIds })), 'PROPERTY');
    return [margin, occupancy].filter((proposal): proposal is PackRuleProposal => proposal !== null);
  },
};

export const MULTIFAMILY_HISTORY_RULES: readonly PackRule[] = [
  MULTIFAMILY_OCCUPANCY_EROSION,
  MULTIFAMILY_RENT_BELOW_EXPENSE_GROWTH,
  MULTIFAMILY_NOI_SPIKE,
  MULTIFAMILY_RECENT_RUN,
  // Expenses outpacing income, margin drift and the trend record: the shared multi-year rules (ADR 0050).
  ...pnlTrendRules('multifamily', MULTIFAMILY_KEY_EXPENSES),
];
