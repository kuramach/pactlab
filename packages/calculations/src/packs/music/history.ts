import { D, parseDecimal } from '../../metrics/decimal';
import { driverTrendRule, recentRunRule, type DriverSpec, type DriverYear, type PackHistorySpec } from '../history';
import { MAX_CITED, type PackRuleEvidence } from '../rule-types';
import { MUSIC_EVIDENCE } from './catalog';

/**
 * Five years of history for a music catalog (T-184b, ADR 0057): net statement income by calendar year, what a
 * catalog buyer reads first. Statements are periodic (half-years or quarters), so a year counts only when its
 * periods cover all twelve months: one ending 31 December and every earlier one that year, evenly spaced. A
 * catalog has no operating P&L of its own to expect; one imported shows beside the income.
 */
type Decimal = InstanceType<typeof D>;
const DATE = /^(\d{4})-(\d{2})-\d{2}$/;

export function incomeYears(evidence: readonly PackRuleEvidence[]): DriverYear[] {
  const lines = evidence.filter((row) => row.evidenceType === MUSIC_EVIDENCE.ROYALTY && DATE.test((row.canonical['period_end'] ?? '').trim()));
  const ends = [...new Set(lines.map((row) => (row.canonical['period_end'] ?? '').trim()))].sort();
  const years = [...new Set(ends.map((end) => end.slice(0, 4)))].sort();
  return years.flatMap((year) => {
    const inYear = ends.filter((end) => end.startsWith(year));
    const months = inYear.map((end) => Number(end.slice(5, 7)));
    const step = months.length > 1 ? (months[1] as number) - (months[0] as number) : 12;
    const even = step > 0 && 12 % step === 0 && months.length === 12 / step && months.every((month, index) => month === step * (index + 1));
    if (!even) return [];
    const rows = lines.filter((row) => (row.canonical['period_end'] ?? '').startsWith(year));
    const total = rows.reduce((sum: Decimal, row) => sum.plus(parseDecimal(row.canonical['amount'] ?? null) ?? 0), new D(0));
    return [{ year, value: total.toFixed(2), evidenceIds: rows.slice(0, MAX_CITED).map((row) => row.id) }];
  });
}

export const MUSIC_DRIVERS = {
  income: {
    key: 'income',
    label: 'Royalty income',
    unit: 'MONEY',
    evidenceType: MUSIC_EVIDENCE.ROYALTY,
    mode: 'SUM',
    numerator: ['amount'],
    formula: 'Σ net statement income in the year, every work and source (the year’s periods must cover all twelve months)',
    compute: incomeYears,
  },
} as const satisfies Record<string, DriverSpec>;

export const MUSIC_HISTORY: PackHistorySpec = {
  drivers: [MUSIC_DRIVERS.income],
  keyExpenses: [],
  driverImport: 'MUSIC_ROYALTY_STATEMENTS',
  driverLabel: 'Royalty statements',
  driverWhat: 'royalty statements',
};

/** Catalog income falling every year by this share or more, first year to last (10%). */
export const INCOME_DECLINE_SHARE = '0.1';

export const MUSIC_INCOME_TREND = driverTrendRule(
  {
    id: 'music-income-trend',
    driver: MUSIC_DRIVERS.income,
    adverse: 'DOWN',
    threshold: INCOME_DECLINE_SHARE,
    domain: 'FINANCIAL',
    advice: 'The catalog earns less each year: check that the decay the price assumes is at least this steep, and which works and sources carry the decline.',
  },
  MUSIC_HISTORY,
);

/** The recent run against the long run (T-185). */
export const MUSIC_RECENT_RUN = recentRunRule('music', MUSIC_HISTORY);
