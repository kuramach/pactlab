import { D } from '../metrics/decimal';
import { grouped, percent } from './common';
import type { PackMetric } from './metrics-types';
import { MAX_CITED, type PackRuleProposal } from './rule-types';

/**
 * History of any length (T-185, ADR 0057 addendum). Five years is the minimum a pack expects, not the most it
 * reads: every complete year provided counts, up to a sanity limit of 30. The years expected (and asked of the
 * seller) are max(latest − 4, history start) … latest, so a business never gets asked for years before it
 * existed; a gap inside the history is asked for. Deterministic and decimal-only.
 */
export const HISTORY_SPAN_VERSION = 'history-span-1';

/** The years a buyer prices on and the minimum expected; the existing trend rules read these. */
export const RECENT_YEARS = 5;
/** Years read at most, counting back from the latest: older years are left out as implausible. */
export const MAX_HISTORY_YEARS = 30;
/** The long-run growth window: a 10-year compound growth rate when ten years or more are read. */
export const LONG_RUN_YEARS = 10;
/** "The recent run is better than the long run" drafts only over at least this many years… */
export const RECENT_RUN_MIN_YEARS = 10;
/** …reading the last five years (three at least)… */
export const RECENT_RUN_WINDOW = 5;
export const RECENT_RUN_MIN_RECENT = 3;
/** …when their average sits this many points (as a fraction) or more above the full history's average. */
export const RECENT_RUN_POINTS = '0.03';

export interface HistoryOptions {
  /** The year the business started, or the property was built or acquired, or the earliest year the seller can provide. */
  readonly historyStartYear?: number | null;
}

const fiscal = (year: string) => `FY${year}`;
const range = (first: number, last: number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => String(first + index));

/** Years as ranges: ["2022","2023","2025"] → "FY2022–FY2023, FY2025". */
export function yearRanges(years: readonly string[]): string {
  const sorted = [...new Set(years)].sort();
  const ranges: string[][] = [];
  for (const year of sorted) {
    const last = ranges.at(-1);
    if (last && Number(last.at(-1)) === Number(year) - 1) last.push(year);
    else ranges.push([year]);
  }
  return ranges.map((entry) => (entry.length === 1 ? fiscal(entry[0] ?? '') : `${fiscal(entry[0] ?? '')}–${fiscal(entry.at(-1) ?? '')}`)).join(', ');
}

export interface HistoryWindow {
  /** The latest year read, or undefined when nothing is. */
  readonly latest: string | undefined;
  /** The history start applied (never after the latest year), or null when none is set. */
  readonly start: number | null;
  /** Every year shown, oldest first: from the earliest year read (within 30) or the first expected year, to the latest. */
  readonly years: readonly string[];
  /** The years expected: max(latest − 4, start) … latest. */
  readonly expected: readonly string[];
  /** latest − 4 … latest: the years the existing trend rules and five-year figures read. */
  readonly recent: readonly string[];
}

/** The window over every kind of history read (operating statements, drivers), so the years line up side by side. */
export function historyWindow(present: readonly string[], options: HistoryOptions = {}): HistoryWindow {
  const latestNumber = Math.max(...present.map(Number).filter(Number.isFinite));
  if (!Number.isFinite(latestNumber)) return { latest: undefined, start: options.historyStartYear ?? null, years: [], expected: [], recent: [] };
  const floor = latestNumber - (MAX_HISTORY_YEARS - 1);
  const start = options.historyStartYear == null ? null : Math.min(options.historyStartYear, latestNumber);
  const expectedFirst = Math.max(latestNumber - (RECENT_YEARS - 1), start ?? -Infinity);
  const earliest = Math.min(...present.map(Number).filter((year) => year >= floor));
  return {
    latest: String(latestNumber),
    start,
    years: range(Math.min(earliest, expectedFirst), latestNumber),
    expected: range(expectedFirst, latestNumber),
    recent: range(latestNumber - (RECENT_YEARS - 1), latestNumber),
  };
}

/** The years of a window a kind of history is read in: the shown years, those within the limit. */
export const inWindow = (window: HistoryWindow) => (year: string) => window.years.includes(year);

export interface KindCoverage {
  readonly key: string;
  readonly label: string;
  /** Years read, as FY labels. */
  readonly present: readonly string[];
  /** Years asked of the seller, as FY labels. */
  readonly missing: readonly string[];
  /**
   * "FY2007–FY2026 (20 years)", "FY2025–FY2026 (2 of 2 years since the business started)",
   * "FY2022–FY2026 (5 years; earlier years not provided)", or "… (2 of 5 years): ask the seller for …".
   */
  readonly summary: string;
  /** The ask of the seller's words, when years are missing. */
  readonly ask: string | null;
  /** Years missing, as plain years. */
  readonly missingYears: readonly string[];
}

/**
 * One kind of history's coverage: the years it should hold run from its earliest year read (or the first expected
 * year, if earlier) to the latest; years before the history start are never asked for. A missing year before the
 * first one read, with no history start set, is asked "…or tell us the business started later".
 */
export function kindCoverage(key: string, label: string, what: string, window: HistoryWindow, presentYears: readonly string[]): KindCoverage {
  const latest = Number(window.latest);
  const present = [...new Set(presentYears.filter(inWindow(window)))].sort();
  const expectedFirst = Number(window.expected[0] ?? latest);
  const first = Math.min(Number(present[0] ?? expectedFirst), expectedFirst);
  const span = Number.isFinite(latest) ? range(first, latest).filter((year) => window.start === null || Number(year) >= window.start) : [];
  const missing = span.filter((year) => !present.includes(year));
  const leading = present.length === 0 || missing.some((year) => year < (present[0] ?? ''));
  const later = window.start === null && leading ? ', or tell us the business started later' : '';
  const ask = missing.length ? `Ask the seller for ${yearRanges(missing)} ${what}${later}.` : null;
  let summary: string;
  if (present.length === 0) summary = span.length ? `No ${label.toLowerCase()} imported yet: ask the seller for ${yearRanges(missing)} ${what}${later}` : `No ${label.toLowerCase()} imported yet`;
  else if (missing.length) summary = `${yearRanges(present)} (${present.length} of ${present.length + missing.length} years): ask the seller for ${yearRanges(missing)} ${what}${later}`;
  else if (window.start !== null && Number(present[0]) === window.start) summary = `${yearRanges(present)} (${present.length} of ${present.length} years since the business started)`;
  else if (present.length > RECENT_YEARS) summary = `${yearRanges(present)} (${present.length} years)`;
  else summary = `${yearRanges(present)} (${present.length} years; earlier years not provided)`;
  return { key, label, present: present.map(fiscal), missing: missing.map(fiscal), summary, ask, missingYears: missing };
}

// ---- Long-run figures over the full history ----

/** One figure by year: the value, and the rows it rests on. */
export interface YearValue {
  readonly year: string;
  readonly value: string | null;
  readonly evidenceIds: readonly string[];
}

type Decimal = InstanceType<typeof D>;
const known = (years: readonly YearValue[]) => years.filter((year): year is YearValue & { value: string } => year.value !== null).sort((a, b) => a.year.localeCompare(b.year));
const rows = (years: readonly YearValue[]) => years.reduce((count, year) => count + year.evidenceIds.length, 0);

/** Compound annual growth from `first` to `last`; null when either is not positive or they are the same year. */
export function compoundGrowth(first: YearValue | undefined, last: YearValue | undefined): string | null {
  if (!first?.value || !last?.value) return null;
  const periods = Number(last.year) - Number(first.year);
  const from = new D(first.value);
  const to = new D(last.value);
  if (periods <= 0 || !from.gt(0) || !to.gt(0)) return null;
  return to.div(from).pow(new D(1).div(periods)).minus(1).toFixed(4);
}

export interface WorstYear {
  /** The year of the fall, the year before it and the peak it fell from. */
  readonly year: string;
  readonly from: string;
  readonly peakYear: string;
  /** MONEY/COUNT: the fall as a share of the year before (0.1234); RATIO: the fall in points (0.0500). */
  readonly fall: string;
  /** The first later year back at the prior peak or above, or null when not yet recovered. */
  readonly recoveredYear: string | null;
  readonly yearsToRecover: number | null;
  readonly evidenceIds: readonly string[];
}

/**
 * The largest year-on-year fall across the history (consecutive years only) and the years to recover to the peak
 * before it: the first later year at or above the highest value up to the year before the fall.
 */
export function worstYear(series: readonly YearValue[], unit: PackMetric['unit']): WorstYear | null {
  const years = known(series);
  let worst: { index: number; fall: Decimal } | null = null;
  for (let index = 1; index < years.length; index += 1) {
    const before = years[index - 1] as YearValue & { value: string };
    const year = years[index] as YearValue & { value: string };
    if (Number(year.year) !== Number(before.year) + 1) continue;
    const from = new D(before.value);
    const drop = from.minus(year.value);
    if (!drop.gt(0)) continue;
    const fall = unit === 'RATIO' ? drop : from.gt(0) ? drop.div(from) : null;
    if (fall && (!worst || fall.gt(worst.fall))) worst = { index, fall };
  }
  if (!worst) return null;
  const prior = years.slice(0, worst.index);
  const peak = prior.reduce((best, year) => (new D(year.value).gt(best.value) ? year : best));
  const after = years.slice(worst.index + 1);
  const recovered = after.find((year) => new D(year.value).gte(peak.value)) ?? null;
  const fallYear = years[worst.index] as YearValue;
  return {
    year: fallYear.year,
    from: (years[worst.index - 1] as YearValue).year,
    peakYear: peak.year,
    fall: worst.fall.toFixed(4),
    recoveredYear: recovered?.year ?? null,
    yearsToRecover: recovered ? Number(recovered.year) - Number(fallYear.year) : null,
    evidenceIds: [...new Set([...peak.evidenceIds, ...fallYear.evidenceIds, ...(recovered?.evidenceIds ?? [])])],
  };
}

/** The mean of the values read; null when none is. */
export function averageOf(series: readonly YearValue[]): string | null {
  const years = known(series);
  return years.length ? years.reduce((total, year) => total.plus(year.value), new D(0)).div(years.length).toFixed(4) : null;
}

export interface LongRunSeries {
  /** Metric key stem, e.g. "revenue", "noi", "occupancy". */
  readonly key: string;
  /** e.g. "Revenue", "Net operating income", "Occupancy (average)". */
  readonly label: string;
  readonly unit: PackMetric['unit'];
  readonly years: readonly YearValue[];
  /** Long-run growth (MONEY), the worst year, a through-cycle average (RATIO), or several. */
  readonly figures: readonly ('GROWTH' | 'WORST' | 'AVERAGE')[];
}

const shown = (unit: PackMetric['unit'], value: string) => (unit === 'RATIO' ? percent(new D(value)) : grouped(new D(value)));

/**
 * The long-run figures (T-185): 10-year and full-history compound growth, the worst year and its recovery, and
 * through-cycle averages beside the last five years', each with its coverage. The five-year figures stay as built.
 */
export function longRunMetrics(series: readonly LongRunSeries[], window: HistoryWindow): PackMetric[] {
  return series.flatMap((entry): PackMetric[] => {
    const years = known(entry.years).filter((year) => window.years.includes(year.year));
    const coverage = years.length ? kindCoverage(entry.key, entry.label, '', window, years.map((year) => year.year)).summary.replace(/:.*$/, '') : 'No years read';
    const first = years[0];
    const last = years.at(-1);
    const out: PackMetric[] = [];
    if (entry.figures.includes('GROWTH')) {
      const tenFirst = last ? years.find((year) => Number(year.year) === Number(last.year) - (LONG_RUN_YEARS - 1)) : undefined;
      const ten = compoundGrowth(tenFirst, last);
      out.push({
        key: `${entry.key}_cagr_10y`,
        label: `${entry.label} growth, 10-year compound annual`,
        unit: 'RATIO',
        formula: tenFirst && last ? `(${fiscal(last.year)} ÷ ${fiscal(tenFirst.year)}) ^ (1 ÷ ${LONG_RUN_YEARS - 1}) − 1: the ten fiscal years ${fiscal(tenFirst.year)}–${fiscal(last.year)}` : `Compound annual growth across the last ${LONG_RUN_YEARS} fiscal years`,
        sourceCount: tenFirst && last ? tenFirst.evidenceIds.length + last.evidenceIds.length : 0,
        coverage,
        ...(ten !== null ? { value: ten } : { value: null, unavailableReason: tenFirst ? 'Not computed: the first or last year is not positive.' : `Needs ${LONG_RUN_YEARS} years or more; ${years.length} read.` }),
      });
      const full = compoundGrowth(first, last);
      out.push({
        key: `${entry.key}_cagr_full`,
        label: `${entry.label} growth, full-history compound annual`,
        unit: 'RATIO',
        formula: first && last && first !== last ? `(${fiscal(last.year)} ÷ ${fiscal(first.year)}) ^ (1 ÷ ${Number(last.year) - Number(first.year)}) − 1: every year read` : 'Compound annual growth from the first year read to the last',
        sourceCount: (first?.evidenceIds.length ?? 0) + (last && last !== first ? last.evidenceIds.length : 0),
        coverage,
        ...(full !== null ? { value: full } : { value: null, unavailableReason: years.length < 2 ? `Needs two years or more; ${years.length} read.` : 'Not computed: the first or last year is not positive.' }),
      });
    }
    if (entry.figures.includes('WORST')) {
      const worst = worstYear(years, entry.unit);
      const fallText = (fall: string) => (entry.unit === 'RATIO' ? `${new D(fall).times(100).toFixed(1)} points` : percent(new D(fall)));
      out.push({
        key: `${entry.key}_worst_year`,
        label: `${entry.label}, worst year`,
        unit: 'RATIO',
        formula: worst
          ? `The largest fall year on year: ${fiscal(worst.from)} → ${fiscal(worst.year)}, down ${fallText(worst.fall)} (${shown(entry.unit, years.find((year) => year.year === worst.from)?.value ?? '0')} to ${shown(entry.unit, years.find((year) => year.year === worst.year)?.value ?? '0')})`
          : `The largest fall year on year (${entry.unit === 'RATIO' ? 'in points' : 'as a share of the year before'})`,
        sourceCount: worst ? worst.evidenceIds.length : rows(years),
        coverage,
        ...(worst
          ? {
              value: worst.fall,
              evidenceIds: worst.evidenceIds.slice(0, MAX_CITED),
              recovery: { fallYear: fiscal(worst.year), peakYear: fiscal(worst.peakYear), recoveredYear: worst.recoveredYear ? fiscal(worst.recoveredYear) : null, years: worst.yearsToRecover },
              note: worst.recoveredYear
                ? `Recovered to the ${fiscal(worst.peakYear)} peak in ${fiscal(worst.recoveredYear)} (${worst.yearsToRecover} year${worst.yearsToRecover === 1 ? '' : 's'})`
                : `Not yet recovered to the ${fiscal(worst.peakYear)} peak`,
            }
          : { value: null, unavailableReason: years.length < 2 ? `Needs two years or more; ${years.length} read.` : 'No year fell against the year before.' }),
      });
    }
    if (entry.figures.includes('AVERAGE')) {
      const full = averageOf(years);
      const recentYears = years.filter((year) => window.recent.includes(year.year));
      const recent = averageOf(recentYears);
      out.push({
        key: `${entry.key}_average_full`,
        label: `${entry.label}, through-cycle average`,
        unit: 'RATIO',
        formula: first && last ? `The mean of each year's figure, ${yearRanges(years.map((year) => year.year))}` : 'The mean of each year\'s figure across the full history',
        sourceCount: rows(years),
        coverage,
        ...(full !== null ? { value: full, ...(recent !== null ? { note: `Last five years: ${percent(new D(recent))}` } : {}) } : { value: null, unavailableReason: 'No years read.' }),
      });
      out.push({
        key: `${entry.key}_average_recent`,
        label: `${entry.label}, last five years' average`,
        unit: 'RATIO',
        formula: recentYears.length ? `The mean of each year's figure, ${yearRanges(recentYears.map((year) => year.year))}` : 'The mean of each year\'s figure across the last five years',
        sourceCount: rows(recentYears),
        coverage: recentYears.length ? `${yearRanges(recentYears.map((year) => year.year))} (${recentYears.length} of ${RECENT_YEARS} years)` : 'No years read',
        ...(recent !== null ? { value: recent } : { value: null, unavailableReason: 'No years read.' }),
      });
    }
    return out;
  });
}

// ---- "The recent run is better than the long run" ----

/**
 * When the last five years' average of a ratio (three at least) sits RECENT_RUN_POINTS or more above the full
 * history's average, over RECENT_RUN_MIN_YEARS years or more: the reviewer asks whether the price assumes the peak
 * will last. Returns the draft, or null. The key names the years read, so a re-run adds nothing.
 */
export function recentRunCheck(key: string, label: string, series: readonly YearValue[], domain: PackRuleProposal['domain']): PackRuleProposal | null {
  const years = known(series);
  const latest = years.at(-1);
  if (!latest || years.length < RECENT_RUN_MIN_YEARS) return null;
  const recent = years.filter((year) => Number(year.year) > Number(latest.year) - RECENT_RUN_WINDOW);
  if (recent.length < RECENT_RUN_MIN_RECENT) return null;
  const full = new D(averageOf(years) as string);
  const last = new D(averageOf(recent) as string);
  const gap = last.minus(full);
  if (gap.lt(RECENT_RUN_POINTS)) return null;
  const span = `${fiscal(years[0]?.year ?? '')}–${fiscal(latest.year)}`;
  const recentSpan = yearRanges(recent.map((year) => year.year));
  return {
    key: `${key}:${years[0]?.year}-${latest.year}`,
    domain,
    title: `The recent run is better than the long run: ${label}, ${recentSpan} against ${span}`,
    description:
      `${label} averaged ${percent(last)} across ${recentSpan}, against ${percent(full)} across the full history (${span}, ${years.length} years): ` +
      `${gap.times(100).toFixed(1)} points above the long-run average; the check drafts at ${new D(RECENT_RUN_POINTS).times(100).toFixed(1)} points. ` +
      `By year: ${years.map((year) => `${fiscal(year.year)} ${percent(new D(year.value))}`).join(', ')}. ` +
      'Ask whether the price assumes the recent run will last; a scenario at the through-cycle average shows what it is worth if it does not.',
    severity: gap.gte(new D(RECENT_RUN_POINTS).times(2)) ? 'HIGH' : 'MEDIUM',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    evidenceIds: [...new Set([...recent.flatMap((year) => year.evidenceIds.slice(0, 5)), ...years.flatMap((year) => year.evidenceIds.slice(0, 2))])].slice(0, MAX_CITED),
  };
}
