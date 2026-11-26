import { D, parseDecimal } from '../../metrics/decimal';
import { pnlForPeriod, pnlPeriods } from '../../pnl/pnl';
import { pnlLinesFromRecords } from '../../pnl/trend';
import { monthsTo } from '../fintech/payments';
import { refPattern } from '../healthcare/practice';
import { PNL_LINE } from '../pnl-trend';
import { collapse, sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The professional services practice model (T-167, ADR 0055), deterministic and decimal-only: fees,
 * realization and collection recomputed from the time-and-billing export and reconciled to the P&L by
 * year; fees by client, by fee-earner and by relationship partner; the recurring and project split;
 * utilization from the timesheets; WIP and debtor ageing from the reports, by year; the concentration
 * ceilings a deck states; and the non-compete and non-solicitation cover the documents show for each
 * revenue-carrying partner. Fee-earners appear only by pseudonymous reference. Every figure names the rows
 * or the sentence it rests on. Changing a rule is a new SERVICES_PRACTICE_VERSION, never a silent edit.
 */
export const SERVICES_PRACTICE_VERSION = 'services-practice-1';
export const BILLING_MONTH = 'services.billing_month';
export const AGEING_BAND = 'services.ageing_band';
export const TIMESHEET_MONTH = 'services.timesheet_month';

export const SERVICES_CONVENTIONS = [
  'Realization is fees billed ÷ the standard value of the time worked (hours at the firm’s standard rates); collection is cash collected ÷ fees billed.',
  'Utilization is billable ÷ available hours from the timesheets summary.',
  'Fees by client, by fee-earner and by relationship partner are the billed amounts over the trailing twelve months; a partner’s book is the fees of the clients whose relationship they hold.',
  'Retainers and managed services are recurring; fixed-scope projects and time and materials are project revenue.',
  'A year is read only when all twelve of its months are in the export, never scaled up.',
  'An ageing report’s balances over 90 days are its 91–180 and over-180 bands; each year is read from its latest report.',
  'Covenant cover is read only from documents whose heading names restrictive covenants, non-competes or non-solicitations; a sentence naming the person with no covenant is shown as stated.',
] as const;

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const zero = () => new D(0);
const cap = (text: string) => (text.length > 400 ? text.slice(0, 400) : text);
const RECURRING = new Set(['retainer', 'managed_service']);

export interface BillingRow {
  readonly id: string;
  readonly month: string;
  readonly client: string;
  /** retainer, managed_service, project or time_and_materials, lower-cased as imported. */
  readonly engagement: string;
  readonly feeEarner: string;
  readonly grade: string;
  /** The relationship partner's reference; empty when the export does not say. */
  readonly partner: string;
  readonly hoursWorked: Decimal;
  readonly hoursBilled: Decimal | null;
  readonly standard: Decimal;
  readonly billed: Decimal;
  readonly collected: Decimal | null;
}

/** The time-and-billing export's rows, by month then client; a row without a month, standard value or fees is skipped. */
export function billingRows(evidence: readonly PackRuleEvidence[]): BillingRow[] {
  return evidence
    .filter((row) => row.evidenceType === BILLING_MONTH)
    .flatMap((row) => {
      const month = (row.canonical['month'] ?? '').trim();
      const standard = dec(row.canonical['standard_value']);
      const billed = dec(row.canonical['billed']);
      if (!MONTH.test(month) || !standard || !billed) return [];
      return [
        {
          id: row.id,
          month,
          client: (row.canonical['client'] ?? '').trim(),
          engagement: (row.canonical['engagement'] ?? '').trim().toLowerCase(),
          feeEarner: (row.canonical['fee_earner'] ?? '').trim(),
          grade: (row.canonical['grade'] ?? '').trim(),
          partner: (row.canonical['relationship_partner'] ?? '').trim(),
          hoursWorked: dec(row.canonical['hours_worked']) ?? zero(),
          hoursBilled: dec(row.canonical['hours_billed']),
          standard,
          billed,
          collected: dec(row.canonical['collected']),
        },
      ];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.client.localeCompare(b.client) || a.feeEarner.localeCompare(b.feeEarner) || a.id.localeCompare(b.id));
}

export const isRecurring = (row: BillingRow) => RECURRING.has(row.engagement);

export interface BillingTotals {
  readonly rows: readonly BillingRow[];
  readonly hoursWorked: Decimal;
  readonly hoursBilled: Decimal;
  readonly standard: Decimal;
  readonly billed: Decimal;
  readonly collected: Decimal;
  /** Billed ÷ standard value. */
  readonly realization: Decimal | null;
  /** Collected ÷ billed, when every row carries a collected amount. */
  readonly collection: Decimal | null;
}

export function billingTotals(rows: readonly BillingRow[]): BillingTotals {
  const sum = (pick: (row: BillingRow) => Decimal) => rows.reduce((total, row) => total.plus(pick(row)), zero());
  const standard = sum((row) => row.standard);
  const billed = sum((row) => row.billed);
  const collected = sum((row) => row.collected ?? zero());
  const allCollected = rows.length > 0 && rows.every((row) => row.collected !== null);
  return {
    rows,
    hoursWorked: sum((row) => row.hoursWorked),
    hoursBilled: sum((row) => row.hoursBilled ?? zero()),
    standard,
    billed,
    collected,
    realization: standard.gt(0) ? billed.div(standard) : null,
    collection: allCollected && billed.gt(0) ? collected.div(billed) : null,
  };
}

export interface BillingWindow extends BillingTotals {
  readonly from: string;
  readonly to: string;
  /** Months of the window with no row in the export. */
  readonly missing: readonly string[];
}

export function billingWindow(rows: readonly BillingRow[], end: string, keep: (row: BillingRow) => boolean = () => true, length = 12): BillingWindow {
  const months = monthsTo(end, length);
  const inside = rows.filter((row) => months.includes(row.month) && keep(row));
  return { ...billingTotals(inside), from: months[0] ?? end, to: end, missing: months.filter((month) => !inside.some((row) => row.month === month)) };
}

export interface FeeShare {
  readonly key: string;
  readonly billed: Decimal;
  /** Of all fees billed in the window. */
  readonly share: Decimal | null;
  readonly rows: readonly BillingRow[];
}

/** Fees billed over a window grouped by `pick`, largest first; rows whose key is empty are left out. */
export function feeShares(window: BillingWindow, pick: (row: BillingRow) => string): FeeShare[] {
  const keys = [...new Set(window.rows.map(pick))].filter(Boolean);
  return keys
    .map((key) => {
      const rows = window.rows.filter((row) => pick(row) === key);
      const billed = rows.reduce((total, row) => total.plus(row.billed), zero());
      return { key, billed, share: window.billed.gt(0) ? billed.div(window.billed) : null, rows };
    })
    .sort((a, b) => b.billed.comparedTo(a.billed) || a.key.localeCompare(b.key));
}

export interface PracticeModel {
  readonly latestMonth: string | null;
  readonly trailing: BillingWindow | null;
  readonly clients: readonly FeeShare[];
  readonly feeEarners: readonly FeeShare[];
  /** Books by relationship partner; by fee-earner when the export names no relationship partner. */
  readonly partners: readonly FeeShare[];
  readonly partnerBasis: 'RELATIONSHIP_PARTNER' | 'FEE_EARNER';
  readonly recurring: Decimal;
  /** Recurring fees ÷ all fees, trailing. */
  readonly recurringShare: Decimal | null;
  readonly byEngagement: readonly FeeShare[];
}

export function practiceModel(rows: readonly BillingRow[]): PracticeModel {
  const latestMonth = rows.map((row) => row.month).sort().at(-1) ?? null;
  if (!latestMonth) return { latestMonth: null, trailing: null, clients: [], feeEarners: [], partners: [], partnerBasis: 'RELATIONSHIP_PARTNER', recurring: zero(), recurringShare: null, byEngagement: [] };
  const trailing = billingWindow(rows, latestMonth);
  const named = trailing.rows.some((row) => row.partner);
  const recurring = trailing.rows.filter(isRecurring).reduce((total, row) => total.plus(row.billed), zero());
  return {
    latestMonth,
    trailing,
    clients: feeShares(trailing, (row) => row.client),
    feeEarners: feeShares(trailing, (row) => row.feeEarner),
    partners: feeShares(trailing, (row) => (named ? row.partner : row.feeEarner)),
    partnerBasis: named ? 'RELATIONSHIP_PARTNER' : 'FEE_EARNER',
    recurring,
    recurringShare: trailing.billed.gt(0) ? recurring.div(trailing.billed) : null,
    byEngagement: feeShares(trailing, (row) => row.engagement),
  };
}

// ------------------------------------------------------------------ by calendar year

export interface BillingYear extends BillingTotals {
  readonly year: string;
}

/** Calendar years with all twelve months in the export, oldest first. */
export function billingYears(rows: readonly BillingRow[]): BillingYear[] {
  const years = [...new Set(rows.map((row) => row.month.slice(0, 4)))].sort();
  return years.flatMap((year) => {
    const window = billingWindow(rows, `${year}-12`);
    return window.missing.length ? [] : [{ ...billingTotals(window.rows), year }];
  });
}

/** The export's fees for each calendar year it covers in full, against the P&L's revenue lines. */
export function feeReconciliation(evidence: readonly PackRuleEvidence[]) {
  const years = billingYears(billingRows(evidence));
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  return years.flatMap((year) => {
    const read = pnlForPeriod(periods, year.year);
    if (!read) return [];
    const lines = read.sources.filter((row) => row.kind === 'REVENUE');
    if (lines.length === 0) return [];
    const pnl = lines.reduce((total, row) => total.plus(row.amount), zero());
    const difference = pnl.minus(year.billed);
    return [{ year: year.year, exports: year.billed, pnl, difference, relative: year.billed.gt(0) ? difference.div(year.billed) : null, accounts: [...new Set(lines.map((row) => row.account))], rows: year.rows, pnlIds: lines.map((row) => row.evidenceId) }];
  });
}

// ------------------------------------------------------------------ utilization

export interface ServicesUtilization {
  readonly from: string;
  readonly to: string;
  readonly months: number;
  readonly available: Decimal;
  readonly billable: Decimal;
  readonly rate: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** Billable ÷ available hours over the timesheets summary's last twelve months. */
export function servicesUtilization(evidence: readonly PackRuleEvidence[]): ServicesUtilization | null {
  const rows = evidence.filter((row) => row.evidenceType === TIMESHEET_MONTH && MONTH.test((row.canonical['month'] ?? '').trim()));
  const months = [...new Set(rows.map((row) => (row.canonical['month'] ?? '').trim()))].sort().slice(-12);
  if (months.length === 0) return null;
  const inside = rows.filter((row) => months.includes((row.canonical['month'] ?? '').trim()));
  const available = inside.reduce((total, row) => total.plus(dec(row.canonical['available_hours']) ?? zero()), zero());
  const billable = inside.reduce((total, row) => total.plus(dec(row.canonical['billable_hours']) ?? zero()), zero());
  return { from: months[0] ?? '', to: months.at(-1) ?? '', months: months.length, available, billable, rate: available.gt(0) ? billable.div(available) : null, rows: inside };
}

// ------------------------------------------------------------------ WIP and debtor ageing

export const OVER_90_BANDS = ['91-180', '181+'] as const;

export interface AgeingReport {
  readonly asOf: string;
  readonly ledger: string;
  readonly bands: readonly { band: string; amount: Decimal }[];
  readonly total: Decimal;
  readonly over90: Decimal;
  /** Over 90 days ÷ total. */
  readonly over90Share: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** Every ageing report, by ledger then report date; a row without a date, ledger, band or amount is skipped. */
export function ageingReports(evidence: readonly PackRuleEvidence[]): AgeingReport[] {
  const rows = evidence.filter((row) => row.evidenceType === AGEING_BAND && ISO_DATE.test((row.canonical['as_of'] ?? '').trim()) && (row.canonical['ledger'] ?? '').trim() && (row.canonical['band'] ?? '').trim() && dec(row.canonical['amount']));
  const keys = [...new Set(rows.map((row) => `${(row.canonical['ledger'] ?? '').trim().toLowerCase()}|${(row.canonical['as_of'] ?? '').trim()}`))].sort();
  return keys.map((key) => {
    const [ledger = '', asOf = ''] = key.split('|');
    const inside = rows.filter((row) => (row.canonical['ledger'] ?? '').trim().toLowerCase() === ledger && (row.canonical['as_of'] ?? '').trim() === asOf);
    const bands = inside.map((row) => ({ band: (row.canonical['band'] ?? '').trim(), amount: dec(row.canonical['amount']) ?? zero() }));
    const total = bands.reduce((sum, band) => sum.plus(band.amount), zero());
    const over90 = bands.filter((band) => (OVER_90_BANDS as readonly string[]).includes(band.band)).reduce((sum, band) => sum.plus(band.amount), zero());
    return { asOf, ledger, bands, total, over90, over90Share: total.gt(0) ? over90.div(total) : null, rows: inside };
  });
}

export interface AgeingYear extends AgeingReport {
  readonly year: string;
}

/** Each ledger's latest report in each calendar year, oldest first. */
export function ageingByYear(reports: readonly AgeingReport[]): Readonly<Record<string, readonly AgeingYear[]>> {
  const out: Record<string, AgeingYear[]> = {};
  for (const ledger of [...new Set(reports.map((report) => report.ledger))].sort()) {
    const mine = reports.filter((report) => report.ledger === ledger);
    const years = [...new Set(mine.map((report) => report.asOf.slice(0, 4)))].sort();
    out[ledger] = years.map((year) => {
      const latest = mine.filter((report) => report.asOf.startsWith(year)).sort((a, b) => a.asOf.localeCompare(b.asOf)).at(-1) as AgeingReport;
      return { ...latest, year };
    });
  }
  return out;
}

// ------------------------------------------------------------------ what the documents state

export type CeilingKey = 'CLIENT_CEILING' | 'PARTNER_CEILING';
export interface CeilingClaim {
  readonly key: CeilingKey;
  readonly label: string;
  /** The stated ceiling, as a fraction. */
  readonly ceiling: Decimal;
  readonly quote: PackRuleQuote;
}

const CEILING_LABELS: Readonly<Record<CeilingKey, string>> = { CLIENT_CEILING: 'Client concentration ceiling', PARTNER_CEILING: 'Partner concentration ceiling' };
const PERCENT = /\b([0-9]{1,2}(?:\.[0-9]+)?)\s?%/;
const ABOVE = /\b(?:exceeds?|more than|over|above|greater than)\b/i;
const CLIENT = /\bclients?\b/i;
const PARTNER = /\b(?:partners?|fee-?earners?|rainmakers?)\b/i;

/** The concentration ceilings a deck states ("no client exceeds 15% of fees"), first of each. */
export function ceilingClaims(pages: readonly PackRulePage[]): CeilingClaim[] {
  const found = new Map<CeilingKey, CeilingClaim>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const percent = PERCENT.exec(sentence);
      const value = percent ? dec(percent[1]) : null;
      if (!percent || !value || !ABOVE.test(sentence) || !/\bfees?\b|\brevenue\b|\bincome\b/i.test(sentence)) continue;
      const key: CeilingKey | null = PARTNER.test(sentence) ? 'PARTNER_CEILING' : CLIENT.test(sentence) ? 'CLIENT_CEILING' : null;
      if (!key || found.has(key)) continue;
      found.set(key, { key, label: CEILING_LABELS[key], ceiling: value.div(100), quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) } });
    }
  }
  return [...found.values()];
}

/** A covenant document, recognised by its heading. */
const COVENANT_HEADING = /\b(?:restrictive covenants?|covenant register|non-?compet\w*|non-?solicit\w*)\b/i;
const COVENANT = /\bnon-?(?:compet|solicit)\w*/i;
const NEGATED = /\b(?:no|not|none|without|never)\b/i;

export type CoverageState = 'COVERED' | 'STATED_NONE' | 'NOT_IN_EVIDENCE';
export interface CovenantCoverage {
  readonly ref: string;
  readonly state: CoverageState;
  readonly quote: PackRuleQuote | null;
}

/** Documents whose first sentence names restrictive covenants, non-competes or non-solicitations. */
export function covenantPages(pages: readonly PackRulePage[]): PackRulePage[] {
  const firstPage = new Map<string, number>();
  for (const page of pages) firstPage.set(page.documentId, Math.min(firstPage.get(page.documentId) ?? page.pageNumber, page.pageNumber));
  const headed = new Set(pages.filter((page) => firstPage.get(page.documentId) === page.pageNumber && COVENANT_HEADING.test(sentences(page.text)[0] ?? '')).map((page) => page.documentId));
  return pages.filter((page) => headed.has(page.documentId));
}

/**
 * What the covenant documents say about one person: a sentence naming their reference with a non-compete
 * or non-solicitation is cover; one that says they have none is stated as none; silence is not in the
 * evidence. A sentence of cover wins over one of none.
 */
export function coverageFor(pages: readonly PackRulePage[], ref: string): CovenantCoverage {
  const pattern = refPattern(ref);
  let none: PackRuleQuote | null = null;
  for (const page of covenantPages(pages)) {
    if (!pattern.test(collapse(page.text))) continue;
    for (const sentence of sentences(page.text)) {
      if (!pattern.test(sentence) || !COVENANT.test(sentence)) continue;
      const quote = { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) };
      if (NEGATED.test(sentence)) none ??= quote;
      else return { ref, state: 'COVERED', quote };
    }
  }
  return none ? { ref, state: 'STATED_NONE', quote: none } : { ref, state: 'NOT_IN_EVIDENCE', quote: null };
}

/** A partner whose book carries at least this share of trailing fees is revenue-carrying (a rainmaker). */
export const RAINMAKER_SHARE = '0.1';
