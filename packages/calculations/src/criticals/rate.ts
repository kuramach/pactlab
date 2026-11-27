import type { CriticalComparator, CriticalRating } from '@pactlab/domain';
import { D, parseDecimal } from '../metrics/decimal';

/** The rating engine's version, stamped on every evaluation (T-179, ADR 0060). */
export const CRITICALS_ENGINE_VERSION = 'criticals-1';

export interface RatedThreshold {
  readonly comparator: CriticalComparator;
  readonly threshold: string;
  readonly lookbackYears: number | null;
  readonly evenBand: string | null;
}

/** One figure the rating rests on: recomputed from imports, or read from a cited page. */
export interface CriticalFigure {
  /** "FY2026", or null for a figure with no period. */
  readonly period: string | null;
  /** Null for a required year the pact does not hold. */
  readonly value: string | null;
  readonly source: 'CALCULATED' | 'DOCUMENT';
}

export type FigureOutcome = 'MET' | 'BORDERLINE' | 'MISSED' | 'MISSING';

export interface CriticalRatingResult {
  readonly rating: CriticalRating;
  readonly figures: readonly (CriticalFigure & { readonly outcome: FigureOutcome })[];
  readonly rationale: string;
  readonly engineVersion: string;
}

/** How a figure stands against the threshold: met, missed within the Even band, missed beyond it. */
export function figureOutcome(value: string, threshold: RatedThreshold): Exclude<FigureOutcome, 'MISSING'> {
  const figure = parseDecimal(value);
  const line = parseDecimal(threshold.threshold);
  if (!figure || !line) throw new Error('Critical figures and thresholds are plain decimals');
  const met = threshold.comparator === 'AT_LEAST' ? figure.gte(line) : figure.lte(line);
  if (met) return 'MET';
  const band = parseDecimal(threshold.evenBand) ?? new D(0);
  return figure.minus(line).abs().lte(band) ? 'BORDERLINE' : 'MISSED';
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Rate a confirmed critical on its figures, deterministically:
 * - Good: the threshold is met on the evidence (every required year, for a lookback).
 * - Even: a miss inside the Even band; a lookback met on only the years the pact holds (2 of the last 3);
 *   or sources that disagree.
 * - Bad: the threshold is missed on the evidence (any required year missed beyond the Even band).
 * - No evidence: nothing to rate. Never folded into Even.
 * For a lookback, pass the required years oldest first (a year not imported has a null value).
 */
export function rateCritical(threshold: RatedThreshold, figures: readonly CriticalFigure[]): CriticalRatingResult {
  const rated = figures.map((figure) => ({ ...figure, outcome: figure.value === null ? ('MISSING' as const) : figureOutcome(figure.value, threshold) }));
  const present = rated.filter((figure) => figure.outcome !== 'MISSING');
  const result = (rating: CriticalRating, rationale: string): CriticalRatingResult => ({ rating, figures: rated, rationale, engineVersion: CRITICALS_ENGINE_VERSION });
  if (present.length === 0) return result('NO_EVIDENCE', 'The pact holds none of the figures this critical needs.');
  const missed = present.filter((figure) => figure.outcome === 'MISSED');
  const borderline = present.filter((figure) => figure.outcome === 'BORDERLINE');
  const met = present.filter((figure) => figure.outcome === 'MET');
  const when = (list: readonly CriticalFigure[]) => list.map((figure) => figure.period ?? (figure.source === 'DOCUMENT' ? 'the cited document' : 'the recomputed figure')).join(', ');

  if (threshold.lookbackYears !== null) {
    const required = threshold.lookbackYears;
    const absent = rated.length - present.length;
    if (missed.length > 0) return result('BAD', `Missed in ${when(missed)}${borderline.length ? `; borderline in ${when(borderline)}` : ''}; met in ${plural(met.length, 'year')} of the last ${required}.`);
    if (borderline.length > 0) return result('EVEN', `Inside the Even band in ${when(borderline)}; met in ${plural(met.length, 'year')} of the last ${required}.`);
    if (absent > 0) return result('EVEN', `Met in ${plural(met.length, 'year')} of the last ${required}; ${plural(absent, 'year')} not in the pact (${when(rated.filter((figure) => figure.outcome === 'MISSING'))}).`);
    return result('GOOD', `Met in each of the last ${required} years.`);
  }

  // A single figure, possibly from more than one source: sources that disagree are mixed (Even).
  const outcomes = new Set(present.map((figure) => figure.outcome));
  if (outcomes.size > 1) return result('EVEN', `The evidence is mixed across sources: met by ${when(met) || 'none'}, missed by ${when([...missed, ...borderline]) || 'none'}.`);
  if (missed.length > 0) return result('BAD', 'Missed on the evidence.');
  if (borderline.length > 0) return result('EVEN', 'Missed, but inside the Even band.');
  return result('GOOD', 'Met on the evidence.');
}

/** Cap rate: net operating income ÷ price, to four places; null when either is missing or the price is not positive. */
export function capRate(noi: string | null, price: string | null): string | null {
  const income = parseDecimal(noi);
  const paid = parseDecimal(price);
  if (!income || !paid || paid.lte(0)) return null;
  return income.dividedBy(paid).toDecimalPlaces(4, D.ROUND_HALF_EVEN).toFixed(4);
}
