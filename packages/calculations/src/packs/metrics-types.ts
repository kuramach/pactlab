import type { PackRuleEvidence } from './rule-types';

/**
 * What every non-SaaS pack calculator returns (T-059): a list of figures, each
 * with its formula and how many source records it rests on. Values are
 * decimal strings; money is in the report's currency (the deal's base
 * currency). The SaaS engine keeps its own richer report.
 */
export interface PackMetric {
  readonly key: string;
  readonly label: string;
  readonly unit: 'MONEY' | 'RATIO' | 'COUNT';
  /** Null when the inputs needed are missing; `unavailableReason` says which. */
  readonly value: string | null;
  readonly formula: string;
  readonly sourceCount: number;
  readonly unavailableReason?: string;
  /**
   * The imports that would fill it in (import target ids), so a missing figure can be asked of the seller
   * (Kumar, 2026-11-25: "if some data is needed, u need to ask the seller"). Absent when nothing is missing.
   */
  readonly needs?: readonly string[];
  /** Where the figure's inputs come from when a pack has more than one source for it, e.g. "Rent roll", "RentCast" (T-158). */
  readonly source?: string;
  /** Evidence the figure cites beyond its rows, e.g. the market estimates it uses (T-158); each opens on its citation view. */
  readonly evidenceIds?: readonly string[];
  /** The figure year by year (T-183), oldest first, for the History strip; a year not imported is null. */
  readonly history?: readonly { readonly period: string; readonly value: string | null; readonly evidenceIds?: readonly string[] }[];
  /** How much of the expected history the figure rests on, e.g. "FY2022–FY2026 (5 of 5 years)" (T-183). */
  readonly coverage?: string;
  /** Show the history as a strip under the figure on Home (T-184); multifamily names its strips on the screen. */
  readonly historyStrip?: boolean;
  /** A line beside the figure, e.g. "Recovered to the FY2008 peak in FY2012 (3 years)" (T-185). */
  readonly note?: string;
  /** A worst-year figure's recovery (T-185): the peak it fell from and the year it was regained, null when not yet. */
  readonly recovery?: { readonly fallYear: string; readonly peakYear: string; readonly recoveredYear: string | null; readonly years: number | null };
}

/**
 * The years side by side (T-183, ADR 0057): the expected fiscal years, a row per figure, how much of each kind
 * of history is imported, and what to ask the seller for. Generic, so every pack's history reads the same way.
 */
export interface PackHistory {
  readonly version: string;
  /** Fiscal years every pack expects at least (5); fewer when the business started later (T-185). */
  readonly expectedYears: number;
  /** Every year read, oldest first, e.g. FY2007 … FY2026: up to 30 (T-185). */
  readonly years: readonly string[];
  /** The history start applied: the year the business started, or null when none is set (T-185). */
  readonly historyStartYear?: number | null;
  /** The latest five years, the period the trend rules and five-year figures read (T-185). */
  readonly recentYears?: readonly string[];
  /** Figures over the full history (T-185): long-run growth, the worst year and its recovery, through-cycle averages. */
  readonly longRun?: readonly PackMetric[];
  readonly rows: readonly { readonly key: string; readonly label: string; readonly unit: 'MONEY' | 'RATIO' | 'COUNT'; readonly values: readonly (string | null)[] }[];
  readonly coverage: readonly { readonly key: string; readonly label: string; readonly present: readonly string[]; readonly missing: readonly string[]; readonly summary: string }[];
  /** An ask of the seller per kind of history with missing years: the imports it needs and the request's words. */
  readonly asks: readonly { readonly needs: readonly string[]; readonly note: string }[];
  readonly conventions: readonly string[];
}

export interface PackMetricsReport {
  readonly calculator: string;
  readonly version: string;
  readonly currency: string;
  readonly metrics: readonly PackMetric[];
  /** Every year read side by side, when the pack reads history (T-183, T-185). */
  readonly history?: PackHistory;
}

export interface PackMetricsInput {
  readonly currency: string;
  readonly evidence: readonly PackRuleEvidence[];
  /** The pact's history start (T-185): never ask for years before it. */
  readonly historyStartYear?: number | null;
}
