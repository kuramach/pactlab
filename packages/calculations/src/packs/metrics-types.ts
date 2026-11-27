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
  readonly history?: readonly { readonly period: string; readonly value: string | null }[];
  /** How much of the expected history the figure rests on, e.g. "FY2022–FY2026 (5 of 5 years)" (T-183). */
  readonly coverage?: string;
  /** Show the history as a strip under the figure on Home (T-184); multifamily names its strips on the screen. */
  readonly historyStrip?: boolean;
}

/**
 * The years side by side (T-183, ADR 0057): the expected fiscal years, a row per figure, how much of each kind
 * of history is imported, and what to ask the seller for. Generic, so every pack's history reads the same way.
 */
export interface PackHistory {
  readonly version: string;
  /** Fiscal years every pack expects (5). */
  readonly expectedYears: number;
  /** Year labels, oldest first, e.g. FY2022. */
  readonly years: readonly string[];
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
  /** Five years side by side, when the pack reads history (T-183). */
  readonly history?: PackHistory;
}

export interface PackMetricsInput {
  readonly currency: string;
  readonly evidence: readonly PackRuleEvidence[];
}
