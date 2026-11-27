import type { FindingDomain, ValuationDirection } from '../findings/types';
import type { CompanyType } from '../pacts/types';

/**
 * Deal Criticals (T-179, ADR 0060): the buyer organization's own red-line parameters, written once as
 * policy and rated on every pact of the type as Good, Even, Bad or No evidence, with the evidence shown.
 * This file is the registry: the metric vocabulary a critical may target, the comparators, the ratings
 * and the valuation direction each rating proposes. A critical only evaluates once a person has
 * confirmed its structured form; the confirmed structure is the only thing the engine runs.
 */

export const CRITICAL_COMPARATORS = ['AT_LEAST', 'AT_MOST'] as const;
export type CriticalComparator = (typeof CRITICAL_COMPARATORS)[number];
export const CRITICAL_COMPARATOR_LABELS = { AT_LEAST: 'at least', AT_MOST: 'at most' } as const satisfies Record<CriticalComparator, string>;
export const CRITICAL_COMPARATOR_SYMBOLS = { AT_LEAST: '≥', AT_MOST: '≤' } as const satisfies Record<CriticalComparator, string>;

/** Good, Even, Bad, and a distinct fourth state: the pact does not hold what the critical needs. */
export const CRITICAL_RATINGS = ['GOOD', 'EVEN', 'BAD', 'NO_EVIDENCE'] as const;
export type CriticalRating = (typeof CRITICAL_RATINGS)[number];
export const CRITICAL_RATING_LABELS = { GOOD: 'Good', EVEN: 'Even', BAD: 'Bad', NO_EVIDENCE: 'No evidence' } as const satisfies Record<CriticalRating, string>;

/** Org standards are the firm's policy; pact criticals belong to one deal (pact-only, or an override of a standard). */
export const CRITICAL_SCOPES = ['ORG', 'PACT'] as const;
export type CriticalScope = (typeof CRITICAL_SCOPES)[number];

/**
 * A version's state. PROPOSED is inert (words, or an AI proposal, not yet confirmed by a person);
 * CONFIRMED evaluates; DISABLED is an override that switches an org standard off for one pact;
 * RETIRED is a critical taken out of the library or the pact.
 */
export const CRITICAL_STATES = ['PROPOSED', 'CONFIRMED', 'DISABLED', 'RETIRED'] as const;
export type CriticalState = (typeof CRITICAL_STATES)[number];

/** Who wrote the structured form of a version: the AI's proposal from the words, or a person. */
export const CRITICAL_STRUCTURE_SOURCES = ['AI', 'PERSON'] as const;
export type CriticalStructureSource = (typeof CRITICAL_STRUCTURE_SOURCES)[number];

export const CRITICAL_UNITS = ['RATIO', 'MULTIPLE', 'YEARS'] as const;
export type CriticalUnit = (typeof CRITICAL_UNITS)[number];

/** How the platform looks for a metric: recomputed from imports, or read from cited document text. */
export type CriticalMetricSource =
  /** A figure from the pack's metric calculator; with a lookback, its year-by-year history. */
  | { readonly kind: 'PACK_METRIC'; readonly metricKey: string }
  /** Net operating income (latest year) ÷ the asking price, both recorded on the pact. */
  | { readonly kind: 'CAP_RATE' }
  /** Read from document text by AI with an exact page quote, verified on the page. */
  | { readonly kind: 'DOCUMENT'; readonly terms: readonly string[] };

export interface CriticalMetricDefinition {
  readonly label: string;
  readonly unit: CriticalUnit;
  /** The company types whose evidence carries the metric. */
  readonly companyTypes: readonly CompanyType[] | 'ALL';
  readonly source: CriticalMetricSource;
  /** Whether a lookback ("in each of the last 3 years") can apply: only year-by-year figures. */
  readonly lookback: boolean;
  /** What document would settle a critical with no evidence: named in the panel and the document request. */
  readonly settles: string;
  /** The intake category the request asks for (an import target or a document category). */
  readonly requests: string;
  readonly findingDomain: FindingDomain;
}

const PROPERTY: readonly CompanyType[] = ['MULTIFAMILY', 'MULTIFAMILY_SYNDICATION', 'COMMERCIAL_PROPERTY', 'HOTELS'];
const MULTIFAMILY: readonly CompanyType[] = ['MULTIFAMILY', 'MULTIFAMILY_SYNDICATION'];

/**
 * The metric vocabulary, by the packs that can evidence each metric. A critical can only target a
 * metric listed here, so the platform always knows where to look. Adding a metric without a row fails
 * the build (`satisfies` below).
 */
export const CRITICAL_METRIC_IDS = ['CAP_RATE', 'OCCUPANCY', 'OCCUPANCY_LOW', 'NOI_GROWTH', 'RENT_GROWTH', 'EXPENSE_RATIO', 'DSCR', 'ANCHOR_LEASE_YEARS', 'NET_REVENUE_RETENTION'] as const;
export type CriticalMetricId = (typeof CRITICAL_METRIC_IDS)[number];

export const CRITICAL_METRICS = {
  CAP_RATE: {
    label: 'Cap rate',
    unit: 'RATIO',
    companyTypes: PROPERTY,
    source: { kind: 'CAP_RATE' },
    lookback: false,
    settles: 'The operating statements (P&L by year, or the T-12) and a recorded asking price',
    requests: 'FINANCIAL_PNL',
    findingDomain: 'FINANCIAL',
  },
  OCCUPANCY: {
    label: 'Occupancy (average for the year)',
    unit: 'RATIO',
    companyTypes: MULTIFAMILY,
    source: { kind: 'PACK_METRIC', metricKey: 'occupancy_average' },
    lookback: true,
    settles: 'The occupancy and rent history by month or year (or rent-roll snapshots)',
    requests: 'MULTIFAMILY_OCCUPANCY',
    findingDomain: 'FINANCIAL',
  },
  OCCUPANCY_LOW: {
    label: 'Occupancy (low point of the year)',
    unit: 'RATIO',
    companyTypes: MULTIFAMILY,
    source: { kind: 'PACK_METRIC', metricKey: 'occupancy_low' },
    lookback: true,
    settles: 'The occupancy and rent history by month',
    requests: 'MULTIFAMILY_OCCUPANCY',
    findingDomain: 'FINANCIAL',
  },
  NOI_GROWTH: {
    label: 'NOI growth, compound annual',
    unit: 'RATIO',
    companyTypes: MULTIFAMILY,
    source: { kind: 'PACK_METRIC', metricKey: 'noi_cagr' },
    lookback: false,
    settles: 'At least two years of operating statements (P&L by year)',
    requests: 'FINANCIAL_PNL',
    findingDomain: 'FINANCIAL',
  },
  RENT_GROWTH: {
    label: 'Average rent growth per year',
    unit: 'RATIO',
    companyTypes: MULTIFAMILY,
    source: { kind: 'PACK_METRIC', metricKey: 'rent_growth' },
    lookback: false,
    settles: 'At least two years of occupancy and rent history with average rents',
    requests: 'MULTIFAMILY_OCCUPANCY',
    findingDomain: 'FINANCIAL',
  },
  EXPENSE_RATIO: {
    label: 'Expense ratio',
    unit: 'RATIO',
    companyTypes: MULTIFAMILY,
    source: { kind: 'PACK_METRIC', metricKey: 'expense_ratio' },
    lookback: true,
    settles: 'The operating statements (P&L by year)',
    requests: 'FINANCIAL_PNL',
    findingDomain: 'FINANCIAL',
  },
  DSCR: {
    label: 'Debt service coverage ratio',
    unit: 'MULTIPLE',
    companyTypes: 'ALL',
    source: { kind: 'DOCUMENT', terms: ['debt service coverage', 'dscr'] },
    lookback: false,
    settles: 'The loan agreement or lender term sheet stating the debt service coverage ratio',
    requests: 'LOAN_AGREEMENT',
    findingDomain: 'FINANCIAL',
  },
  ANCHOR_LEASE_YEARS: {
    label: 'Anchor-tenant lease, years remaining',
    unit: 'YEARS',
    companyTypes: PROPERTY,
    source: { kind: 'DOCUMENT', terms: ['anchor', 'lease', 'term', 'remaining', 'expires'] },
    lookback: false,
    settles: 'The anchor tenant’s lease (or its abstract) stating when the term ends',
    requests: 'LEASE',
    findingDomain: 'LEGAL',
  },
  NET_REVENUE_RETENTION: {
    label: 'Net revenue retention',
    unit: 'RATIO',
    companyTypes: ['SOFTWARE_SAAS'],
    source: { kind: 'DOCUMENT', terms: ['net revenue retention', 'net dollar retention', 'nrr', 'ndr'] },
    lookback: false,
    settles: 'A retention schedule or management KPI pack stating net revenue retention',
    requests: 'OTHER',
    findingDomain: 'FINANCIAL',
  },
} as const satisfies Record<CriticalMetricId, CriticalMetricDefinition>;

export function isCriticalMetric(value: string): value is CriticalMetricId {
  return (CRITICAL_METRIC_IDS as readonly string[]).includes(value);
}

/** Whether a metric is evidenced by a company type; `null` (all types) admits only metrics every pack can evidence. */
export function metricAppliesTo(metric: CriticalMetricId, companyType: CompanyType | null): boolean {
  const types: readonly CompanyType[] | 'ALL' = CRITICAL_METRICS[metric].companyTypes;
  if (types === 'ALL') return true;
  return companyType !== null && types.includes(companyType);
}

/** The metrics a critical scoped to this company type (or all types) may target. */
export function criticalMetricsFor(companyType: CompanyType | null): CriticalMetricId[] {
  return CRITICAL_METRIC_IDS.filter((metric) => metricAppliesTo(metric, companyType));
}

/** The structured form: the only thing the engine runs. Thresholds and bands are decimal strings in the metric's unit (6% → "0.06"). */
export interface CriticalStructure {
  readonly metric: CriticalMetricId;
  readonly comparator: CriticalComparator;
  readonly threshold: string;
  /** Years the threshold must hold in each of; null for a single figure. */
  readonly lookbackYears: number | null;
  /** How close a miss counts as borderline (Even), in the metric's unit; null for none. */
  readonly evenBand: string | null;
}

export const CRITICAL_MAX_LOOKBACK_YEARS = 5;
/** Bounded lists: the library and each pact hold at most this many live criticals. */
export const CRITICAL_LIBRARY_LIMIT = 100;
export const CRITICAL_PACT_LIMIT = 50;

/** Why a structure cannot be confirmed, or null when it can. */
export function structureProblem(structure: CriticalStructure, companyType: CompanyType | null): string | null {
  const metric = CRITICAL_METRICS[structure.metric];
  if (!metricAppliesTo(structure.metric, companyType)) return `${metric.label} is not a metric this company type can evidence`;
  if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(structure.threshold)) return 'The threshold must be a plain decimal';
  if (structure.evenBand !== null && !/^\d{1,12}(\.\d{1,6})?$/.test(structure.evenBand)) return 'The Even band must be a plain, non-negative decimal';
  if (structure.lookbackYears !== null) {
    if (!metric.lookback) return `${metric.label} is a single figure; it has no year-by-year lookback`;
    if (!Number.isInteger(structure.lookbackYears) || structure.lookbackYears < 1 || structure.lookbackYears > CRITICAL_MAX_LOOKBACK_YEARS) return `The lookback is 1 to ${CRITICAL_MAX_LOOKBACK_YEARS} years`;
  }
  return null;
}

/** "Cap rate ≥ 6.00%", "Occupancy ≥ 90.00% in each of the last 3 years (Even within 2.00 points)". */
export function describeStructure(structure: CriticalStructure): string {
  const metric = CRITICAL_METRICS[structure.metric];
  const figure = (value: string) => formatCriticalValue(value, metric.unit);
  const band = structure.evenBand !== null && structure.evenBand !== '0' ? ` (Even within ${formatCriticalBand(structure.evenBand, metric.unit)})` : '';
  const lookback = structure.lookbackYears !== null ? ` in each of the last ${structure.lookbackYears} year${structure.lookbackYears === 1 ? '' : 's'}` : '';
  return `${metric.label} ${CRITICAL_COMPARATOR_SYMBOLS[structure.comparator]} ${figure(structure.threshold)}${lookback}${band}`;
}

/** Shift the decimal point of a plain decimal string by `places` (positive = ×10^places), without floats. */
function shift(value: string, places: number): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const digits = whole + fraction;
  const point = whole.length + places;
  const placed = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [int = '0', frac = ''] = placed.split('.');
  const trimmedInt = int.replace(/^0+(?=\d)/, '');
  const trimmedFrac = frac.replace(/0+$/, '');
  const out = trimmedFrac ? `${trimmedInt}.${trimmedFrac}` : trimmedInt;
  return negative && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Fix a plain decimal string to two places, rounding half up on the third (display only). */
function twoPlaces(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole + (fraction + '000').slice(0, 2)) + (Number((fraction + '000')[2]) >= 5 ? 1n : 0n);
  const text = cents.toString().padStart(3, '0');
  const out = `${text.slice(0, -2)}.${text.slice(-2)}`;
  return negative && cents !== 0n ? `-${out}` : out;
}

export function formatCriticalValue(value: string, unit: CriticalUnit): string {
  if (unit === 'RATIO') return `${twoPlaces(shift(value, 2))}%`;
  if (unit === 'MULTIPLE') return `${twoPlaces(value)}x`;
  return `${twoPlaces(value)} years`;
}

export function formatCriticalBand(value: string, unit: CriticalUnit): string {
  if (unit === 'RATIO') return `${twoPlaces(shift(value, 2))} points`;
  return formatCriticalValue(value, unit);
}

/** A ratio typed in percent ("6", "5.5") as the stored fraction ("0.06", "0.055"). */
export function percentToRatio(percent: string): string {
  return shift(percent, -2);
}

// --- How a rating reaches valuation ----------------------------------------------------------

/** The evidence type a critical's finding cites; its rules below are the VALUATION_DIRECTION_MAP shape. */
export const CRITICAL_EVIDENCE_TYPE = 'criticals.evaluation';

export interface CriticalDirectionRule {
  readonly signal: CriticalRating;
  readonly defaultDirection: ValuationDirection;
  readonly channel: 'PRICED_TERM' | 'ASSUMPTION' | 'CONFIRMATION' | 'INFORMATIONAL';
  /** Whether the rating raises a finding at all; Even and No evidence stay informational, with their rationale. */
  readonly raisesFinding: boolean;
  readonly rationale: string;
}

/**
 * The only way a critical reaches the bridge: a Bad rating raises a −1 finding a person reviews and
 * prices like any drag; a Good rating is +1 confirmed value in the buyer-confidential ledger, never a
 * price increase. Even and No evidence are 0 and raise nothing.
 */
export const CRITICAL_DIRECTION_MAP = {
  BAD: { signal: 'BAD', defaultDirection: -1, channel: 'ASSUMPTION', raisesFinding: true, rationale: 'The pact misses a red line the organization set; the reviewer prices it or makes it a term.' },
  GOOD: { signal: 'GOOD', defaultDirection: 1, channel: 'CONFIRMATION', raisesFinding: true, rationale: 'The pact clears a red line the organization set. Value confirmed, never price paid.' },
  EVEN: { signal: 'EVEN', defaultDirection: 0, channel: 'INFORMATIONAL', raisesFinding: false, rationale: 'Borderline, partly evidenced or mixed across sources: shown with its rationale, no finding.' },
  NO_EVIDENCE: { signal: 'NO_EVIDENCE', defaultDirection: 0, channel: 'INFORMATIONAL', raisesFinding: false, rationale: 'The pact does not hold what the critical needs; the panel names the document that would settle it.' },
} as const satisfies Record<CriticalRating, CriticalDirectionRule>;

export function criticalDirectionFor(rating: CriticalRating): CriticalDirectionRule {
  return CRITICAL_DIRECTION_MAP[rating];
}
