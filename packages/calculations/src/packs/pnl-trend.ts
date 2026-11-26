import { D, parseDecimal } from '../metrics/decimal';
import { pnlForPeriod, pnlPeriods, type PnlLineInput, type PnlLineKindInput, type PnlPeriod } from '../pnl/pnl';
import { percent } from './common';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from './rule-types';

/**
 * The multi-year P&L trend (Kumar, 2026-11-26 — every pack): the imported statements by fiscal
 * year, read through the P&L reader (`pnl-1`), and the trend findings a single year would miss —
 * revenue falling, gross or operating margin drifting down, and the vertical's key expense lines
 * outpacing revenue. Shared by every pack; a pack names its key expense lines. Deterministic and
 * decimal-only; every figure cites the imported rows it adds up. One imported year still reads
 * (the pack's calculator reports it); a trend needs two years or more.
 */
export const PNL_LINE = 'finance.pnl_line';
export const PNL_TREND_VERSION = 'pnl-trend-1';

type Decimal = InstanceType<typeof D>;
const KINDS = new Set<string>(['REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME', 'OTHER_EXPENSE']);

/** One of a vertical's key expense lines, found by the line names a statement uses. */
export interface PnlExpenseLine {
  readonly key: string;
  /** "Clinical supplies" — how findings and metrics name it. */
  readonly label: string;
  /** Matches the imported line names (accounts) that make it up. */
  readonly match: RegExp;
}

export interface PnlYear {
  readonly year: string;
  readonly period: PnlPeriod;
  readonly revenue: Decimal;
  readonly grossMargin: Decimal | null;
  readonly operatingMargin: Decimal | null;
  /** Per key expense line: its total and its share of revenue (null without revenue). */
  readonly expenses: Readonly<Record<string, { readonly amount: Decimal; readonly ratio: Decimal | null; readonly evidenceIds: readonly string[] }>>;
}

/**
 * Every complete fiscal year in the imported P&L, oldest first: a year the file states, or twelve
 * imported months rolled up. A partial year is never scaled up. When two imports hold the same line
 * for the same period, the newer row is read (ids are UUIDv7), so a re-sent statement never doubles.
 * Withdrawn imports never reach here: the pack evidence loader reads active evidence only.
 */
export function pnlYears(evidence: readonly PackRuleEvidence[], expenses: readonly PnlExpenseLine[] = []): PnlYear[] {
  const newest = new Map<string, PackRuleEvidence>();
  for (const row of evidence) {
    if (row.evidenceType !== PNL_LINE) continue;
    const { account, month, amount, line_kind: kind } = row.canonical;
    if (!account || !month || !amount || !kind || !KINDS.has(kind) || !parseDecimal(amount)) continue;
    const key = `${account}|${month}`;
    const seen = newest.get(key);
    if (!seen || seen.id < row.id) newest.set(key, row);
  }
  const lines: PnlLineInput[] = [...newest.values()].map((row) => ({
    evidenceId: row.id,
    account: row.canonical['account'] ?? '',
    period: row.canonical['month'] ?? '',
    amount: row.canonical['amount'] ?? '0',
    kind: row.canonical['line_kind'] as PnlLineKindInput,
  }));
  const periods = pnlPeriods(lines);
  const candidates = [...new Set(periods.map((period) => period.period.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort();
  return candidates.flatMap((year) => {
    const period = pnlForPeriod(periods, year);
    if (!period) return [];
    const revenue = new D(period.revenue);
    const share = (value: Decimal) => (revenue.gt(0) ? value.div(revenue) : null);
    const byExpense: Record<string, { amount: Decimal; ratio: Decimal | null; evidenceIds: string[] }> = {};
    for (const expense of expenses) {
      const rows = period.sources.filter((row) => (row.kind === 'COGS' || row.kind === 'OPEX') && expense.match.test(row.account));
      const amount = rows.reduce((total, row) => total.plus(row.amount), new D(0)).abs();
      byExpense[expense.key] = { amount, ratio: rows.length ? share(amount) : null, evidenceIds: rows.map((row) => row.evidenceId) };
    }
    return [
      {
        year,
        period,
        revenue,
        grossMargin: share(revenue.minus(period.costOfRevenue)),
        operatingMargin: share(new D(period.ebitda)),
        expenses: byExpense,
      },
    ];
  });
}

/** Points, as a reader writes them: 0.016 → "1.6 points". */
const points = (value: Decimal) => `${value.abs().times(100).toFixed(1)} points`;
const growth = (from: Decimal, to: Decimal) => (from.gt(0) ? to.minus(from).div(from) : null);
const signed = (value: Decimal | null) => (value === null ? 'n/a' : `${value.gte(0) ? '+' : ''}${percent(value)}`);
const fallsEveryYear = (values: readonly (Decimal | null)[]) => values.length >= 2 && values.every((value, index) => value !== null && (index === 0 || value.lt(values[index - 1] as Decimal)));
const risesEveryYear = (values: readonly (Decimal | null)[]) => values.length >= 2 && values.every((value, index) => value !== null && (index === 0 || value.gt(values[index - 1] as Decimal)));

export interface PnlTrendConfig {
  readonly id: string;
  readonly version?: string;
  /** The vertical's key expense lines (e.g. clinical supplies for a clinic). */
  readonly expenses: readonly PnlExpenseLine[];
  /** A margin drift is drafted when it falls every year and by at least this much in total (default 2 points). */
  readonly marginDrift?: string;
  /** An expense line is drafted when its share of revenue rises every year and by at least this much (default 1 point). */
  readonly expenseDrift?: string;
}

/**
 * Trend findings over every imported fiscal year: revenue falling every year, a margin falling every
 * year by the drift or more, and a key expense line growing faster than revenue every year. Drags the
 * reviewer prices (an assumption haircut), each citing the rows of the years it compares.
 */
export function pnlTrendRule(config: PnlTrendConfig): PackRule {
  const marginDrift = new D(config.marginDrift ?? '0.02');
  const expenseDrift = new D(config.expenseDrift ?? '0.01');
  return {
    id: config.id,
    version: config.version ?? '1',
    evidenceTypes: [PNL_LINE],
    detect: ({ evidence }) => {
      const years = pnlYears(evidence, config.expenses);
      if (years.length < 2) return [];
      const first = years[0] as PnlYear;
      const last = years.at(-1) as PnlYear;
      const span = `${first.year}–${last.year}`;
      const revenueNote = `Revenue ${years.map((year) => `${year.year} ${year.revenue.toFixed(0)}`).join(', ')} (${signed(growth(first.revenue, last.revenue))} over ${span}).`;
      const cite = (picked: readonly string[]) => [...new Set(picked)].slice(0, MAX_CITED);
      const revenueIds = years.flatMap((year) => year.period.sources.filter((row) => row.kind === 'REVENUE').map((row) => row.evidenceId));
      const allIds = years.flatMap((year) => year.period.sources.map((row) => row.evidenceId));
      const drag = (key: string, title: string, description: string, evidenceIds: readonly string[], severity: PackRuleProposal['severity'] = 'MEDIUM'): PackRuleProposal => ({
        key: `${key}:${span}`,
        domain: 'FINANCIAL',
        title,
        description: `${description} Read from the imported P&L by fiscal year (${PNL_TREND_VERSION}); one year alone shows only its own figures.`,
        severity,
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'A haircut to the growth or margin assumption in the scenarios, sized by the reviewer.',
        evidenceIds: cite(evidenceIds),
      });
      const found: PackRuleProposal[] = [];

      if (fallsEveryYear(years.map((year) => year.revenue))) {
        found.push(drag('revenue', `Revenue falling across ${span}`, `Revenue fell in every year: ${revenueNote}`, revenueIds, 'HIGH'));
      }
      for (const [key, label, pick] of [
        ['gross-margin', 'Gross margin', (year: PnlYear) => year.grossMargin],
        ['operating-margin', 'Operating margin', (year: PnlYear) => year.operatingMargin],
      ] as const) {
        const values = years.map(pick);
        const drop = (values[0] as Decimal | null)?.minus((values.at(-1) as Decimal | null) ?? 0);
        if (!fallsEveryYear(values) || !drop || drop.lt(marginDrift)) continue;
        found.push(
          drag(
            key,
            `${label} falling across ${span}`,
            `${label} fell in every year, by ${points(drop)} in total: ${years.map((year, index) => `${year.year} ${percent(values[index] as Decimal)}`).join(', ')}. ${revenueNote}`,
            allIds,
            drop.gte(marginDrift.times(2)) ? 'HIGH' : 'MEDIUM',
          ),
        );
      }
      for (const expense of config.expenses) {
        const ratios = years.map((year) => year.expenses[expense.key]?.ratio ?? null);
        const amounts = years.map((year) => year.expenses[expense.key]?.amount ?? new D(0));
        const outpaces = years.every((year, index) => {
          if (index === 0) return true;
          const lineGrowth = growth(amounts[index - 1] as Decimal, amounts[index] as Decimal);
          const revenueGrowth = growth((years[index - 1] as PnlYear).revenue, year.revenue);
          return lineGrowth !== null && revenueGrowth !== null && lineGrowth.gt(revenueGrowth);
        });
        const rise = (ratios.at(-1) as Decimal | null)?.minus((ratios[0] as Decimal | null) ?? 0);
        if (!risesEveryYear(ratios) || !outpaces || !rise || rise.lt(expenseDrift)) continue;
        found.push(
          drag(
            `expense:${expense.key}`,
            `${expense.label} outpacing revenue`,
            `${expense.label} grew faster than revenue in every year (${signed(growth(amounts[0] as Decimal, amounts.at(-1) as Decimal))} against revenue ${signed(growth(first.revenue, last.revenue))} over ${span}); their share of revenue rose ${points(rise)}: ${years.map((year, index) => `${year.year} ${(amounts[index] as Decimal).toFixed(0)} (${percent(ratios[index] as Decimal)})`).join(', ')}.`,
            [...years.flatMap((year) => year.expenses[expense.key]?.evidenceIds ?? []), ...revenueIds],
            rise.gte(expenseDrift.times(2)) ? 'HIGH' : 'MEDIUM',
          ),
        );
      }
      return found;
    },
  };
}
