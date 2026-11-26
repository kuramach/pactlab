import { D, parseDecimal } from '../../metrics/decimal';
import { pnlForPeriod, pnlPeriods } from '../../pnl/pnl';
import { pnlLinesFromRecords, type KeyExpense, type TrendYear } from '../../pnl/trend';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { moneyIn } from '../common';
import { dateIn, lastDayOfMonth, monthsTo } from '../fintech/payments';
import { verifiedExpiry } from '../healthcare/practice';
import { PNL_LINE, trendOf } from '../pnl-trend';
import { collapse, sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The hospitals operations model (T-162, ADR 0053), deterministic and decimal-only. It reads what only
 * hospitals carry: the filed cost report (occupancy, payer shares of inpatient days, total costs) set
 * against the deck and the P&L; the payer agreements (rate basis, the end of the term, the renewal or
 * renegotiation window) for the payers in the payer-mix export; the medical-staff register at hospital
 * scale (licences and clinical privileges, by department); capital spend as a share of revenue across
 * the imported P&L years, with the property condition assessment beside it; and the quality rating the
 * deck claims against the reporting documents supplied. Every figure names the rows or the sentence it
 * rests on. Documents, dates and arithmetic only: it never predicts a survey or judges care quality.
 * Changing a rule is a new HOSPITALS_OPERATIONS_VERSION, never a silent edit.
 */
export const HOSPITALS_OPERATIONS_VERSION = 'hospitals-operations-1';
export const CENSUS_MONTH = 'hospitals.census_month';
export const PAYER_MONTH = 'hospitals.payer_month';
export const MEDICAL_STAFF = 'hospitals.medical_staff';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const dateOf = (row: PackRuleEvidence, field: string) => ISO_DATE.exec(text(row, field))?.[1] ?? null;
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const addMonths = (date: string, months: number) => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
};

/** The analysis date: the last day of the latest month in the census or payer-mix exports. */
export function hospitalsAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = evidence
    .filter((row) => row.evidenceType === CENSUS_MONTH || row.evidenceType === PAYER_MONTH)
    .map((row) => text(row, 'month'))
    .filter((month) => MONTH.test(month))
    .sort()
    .at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

/** Documents grouped by id, pages in order; the heading is the first sentence of the first page. */
function documents(pages: readonly PackRulePage[]): { documentId: string; pages: PackRulePage[]; heading: PackRuleQuote | null }[] {
  const byId = new Map<string, PackRulePage[]>();
  for (const page of pages) byId.set(page.documentId, [...(byId.get(page.documentId) ?? []), page]);
  return [...byId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([documentId, list]) => {
      const ordered = [...list].sort((a, b) => a.pageNumber - b.pageNumber);
      const first = ordered[0];
      const sentence = first ? sentences(first.text)[0] : undefined;
      return { documentId, pages: ordered, heading: first && sentence ? quoteOf(first, sentence) : null };
    });
}
const allSentences = (list: readonly PackRulePage[]) => list.flatMap((page) => sentences(page.text).map((sentence) => ({ page, sentence })));
const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*%/;
const percentIn = (sentence: string) => {
  const match = PERCENT.exec(sentence);
  return match ? dec(match[1]) : null;
};

// ------------------------------------------------------------------ census and payer mix

export interface CensusWindow {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly admissions: Decimal;
  readonly patientDays: Decimal;
  /** Patient days ÷ the days in the window's months. */
  readonly averageDailyCensus: Decimal | null;
  /** Patient days ÷ admissions. */
  readonly averageLengthOfStay: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** Admissions and patient days over the twelve months to the latest census month. */
export function censusWindow(evidence: readonly PackRuleEvidence[]): CensusWindow | null {
  const rows = evidence.filter((row) => row.evidenceType === CENSUS_MONTH && MONTH.test(text(row, 'month')));
  const latest = rows.map((row) => text(row, 'month')).sort().at(-1);
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes(text(row, 'month')));
  const present = new Set(inside.map((row) => text(row, 'month')));
  const admissions = sum(inside, (row) => dec(row.canonical['admissions']) ?? new D(0));
  const patientDays = sum(inside, (row) => dec(row.canonical['patient_days']) ?? new D(0));
  const days = months.filter((month) => present.has(month)).reduce((total, month) => total + daysInMonth(month), 0);
  return {
    from: months[0] ?? latest,
    to: latest,
    missing: months.filter((month) => !present.has(month)),
    admissions,
    patientDays,
    averageDailyCensus: days > 0 ? patientDays.div(days) : null,
    averageLengthOfStay: ratio(patientDays, admissions),
    rows: inside,
  };
}

export interface PayerShare {
  readonly payer: string;
  readonly netRevenue: Decimal;
  readonly share: Decimal | null;
  /** A payer the hospital contracts with: not a government programme, self-pay or charity care. */
  readonly contracted: boolean;
  readonly rows: readonly PackRuleEvidence[];
}

const NOT_CONTRACTED = /\b(?:government|medicare|medicaid|programme|program|self[- ]pay|uninsured|charity|other)\b/i;
export const isContractedPayer = (payer: string) => !NOT_CONTRACTED.test(payer);

/** Net revenue by payer over the twelve months to the latest payer-mix month, largest first. */
export function payerWindow(evidence: readonly PackRuleEvidence[]): { from: string; to: string; missing: string[]; netRevenue: Decimal; payers: PayerShare[] } | null {
  const rows = evidence.filter((row) => row.evidenceType === PAYER_MONTH && MONTH.test(text(row, 'month')) && text(row, 'payer'));
  const latest = rows.map((row) => text(row, 'month')).sort().at(-1);
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes(text(row, 'month'))).sort((a, b) => text(a, 'month').localeCompare(text(b, 'month')) || a.id.localeCompare(b.id));
  const present = new Set(inside.map((row) => text(row, 'month')));
  const netRevenue = sum(inside, (row) => dec(row.canonical['net_revenue']) ?? new D(0));
  const payers = [...new Set(inside.map((row) => text(row, 'payer')))]
    .map((payer): PayerShare => {
      const mine = inside.filter((row) => text(row, 'payer') === payer);
      const net = sum(mine, (row) => dec(row.canonical['net_revenue']) ?? new D(0));
      return { payer, netRevenue: net, share: ratio(net, netRevenue), contracted: isContractedPayer(payer), rows: mine };
    })
    .sort((a, b) => b.netRevenue.comparedTo(a.netRevenue) || a.payer.localeCompare(b.payer));
  return { from: months[0] ?? latest, to: latest, missing: months.filter((month) => !present.has(month)), netRevenue, payers };
}

// ------------------------------------------------------------------ the cost report

export type CostReportFigureKey = 'OCCUPANCY' | 'MEDICARE_SHARE' | 'MEDICAID_SHARE' | 'COMMERCIAL_SHARE' | 'TOTAL_COSTS';
export const COST_REPORT_FIGURE_LABELS: Readonly<Record<CostReportFigureKey, string>> = {
  OCCUPANCY: 'Occupancy of licensed beds',
  MEDICARE_SHARE: 'Medicare share of inpatient days',
  MEDICAID_SHARE: 'Medicaid share of inpatient days',
  COMMERCIAL_SHARE: 'Commercial share of inpatient days',
  TOTAL_COSTS: 'Total operating costs',
};
/** Percentage figures and the words a sentence uses for each; total costs are read as an amount. */
const SHARE_WORDS: readonly [Exclude<CostReportFigureKey, 'TOTAL_COSTS'>, RegExp][] = [
  ['OCCUPANCY', /\boccupancy\b/i],
  ['MEDICARE_SHARE', /\bmedicare\b/i],
  ['MEDICAID_SHARE', /\bmedicaid\b/i],
  ['COMMERCIAL_SHARE', /\bcommercial\b/i],
];
const SHARE_CONTEXT = /\bshare\b|\b(?:inpatient|patient) days\b|\baccounts? for\b|\bof days\b/i;
const TOTAL_COSTS = /\btotal (?:operating )?(?:costs?|expenses)\b/i;
const COST_REPORT_HEADING = /\bcost report\b/i;

export interface CostReportFigure {
  readonly key: CostReportFigureKey;
  /** A percentage as written (61.4 for 61.4%), or an amount. */
  readonly value: Decimal;
  readonly currency: string | null;
  readonly quote: PackRuleQuote;
}

export interface CostReportReading {
  readonly documentId: string;
  readonly heading: PackRuleQuote;
  readonly fiscalYear: string | null;
  readonly beds: { readonly value: Decimal; readonly quote: PackRuleQuote } | null;
  readonly patientDays: { readonly value: Decimal; readonly quote: PackRuleQuote } | null;
  readonly figures: readonly CostReportFigure[];
}

const FISCAL_YEAR = /\b(?:fiscal year|financial year|FY|year ended[^.]*?)\s*(20\d{2})\b/i;

/** The percentage a sentence states for one figure, if it is that figure's sentence. */
function shareFigure(sentence: string): { key: Exclude<CostReportFigureKey, 'TOTAL_COSTS'>; value: Decimal } | null {
  const value = percentIn(sentence);
  if (!value) return null;
  for (const [key, words] of SHARE_WORDS) {
    if (!words.test(sentence)) continue;
    if (key !== 'OCCUPANCY' && !SHARE_CONTEXT.test(sentence)) continue;
    return { key, value };
  }
  return null;
}

/** Each filed cost report in the documents (a document headed "… cost report …"), read sentence by sentence. */
export function costReports(pages: readonly PackRulePage[]): CostReportReading[] {
  return documents(pages).flatMap((document): CostReportReading[] => {
    if (!document.heading || !COST_REPORT_HEADING.test(document.heading.quote)) return [];
    const figures: CostReportFigure[] = [];
    let beds: CostReportReading['beds'] = null;
    let patientDays: CostReportReading['patientDays'] = null;
    let fiscalYear: string | null = FISCAL_YEAR.exec(document.heading.quote)?.[1] ?? null;
    for (const { page, sentence } of allSentences(document.pages)) {
      fiscalYear ??= FISCAL_YEAR.exec(sentence)?.[1] ?? null;
      const share = shareFigure(sentence);
      if (share && !figures.some((figure) => figure.key === share.key)) figures.push({ ...share, currency: null, quote: quoteOf(page, sentence) });
      const total = TOTAL_COSTS.exec(sentence);
      const amount = total ? moneyIn(sentence.slice(total.index)) : null;
      if (amount && !figures.some((figure) => figure.key === 'TOTAL_COSTS')) figures.push({ key: 'TOTAL_COSTS', value: amount.amount, currency: amount.currency, quote: quoteOf(page, sentence) });
      const bedCount = /\b(?:licensed|staffed|available) beds\b\D{0,12}([\d,]{2,7})\b/i.exec(sentence) ?? /\b([\d,]{2,7})\s+(?:licensed|staffed)\s+beds\b/i.exec(sentence);
      if (!beds && bedCount && !PERCENT.test(sentence)) {
        const value = dec(bedCount[1]);
        if (value?.gt(0)) beds = { value, quote: quoteOf(page, sentence) };
      }
      const days = /\b(?:inpatient|patient) days\b\D{0,12}([\d,]{3,9})\b/i.exec(sentence);
      if (!patientDays && days && !PERCENT.test(sentence) && !/\bshare\b/i.test(sentence)) {
        const value = dec(days[1]);
        if (value?.gt(0)) patientDays = { value, quote: quoteOf(page, sentence) };
      }
    }
    return [{ documentId: document.documentId, heading: document.heading, fiscalYear, beds, patientDays, figures }];
  });
}

export interface DeckFigure {
  readonly key: Exclude<CostReportFigureKey, 'TOTAL_COSTS'>;
  readonly value: Decimal;
  /** The fiscal year the sentence names, if any. */
  readonly year: string | null;
  readonly quote: PackRuleQuote;
}

/**
 * The figures the deck and other seller documents state that a cost report also states: occupancy and the
 * payer shares of inpatient days, the first sentence for each, outside the cost reports, the property
 * condition assessments and the quality reporting.
 */
export function deckFigures(pages: readonly PackRulePage[]): DeckFigure[] {
  const out: DeckFigure[] = [];
  for (const document of documents(pages)) {
    const heading = document.heading?.quote ?? '';
    if (COST_REPORT_HEADING.test(heading) || CONDITION_HEADING.test(heading) || QUALITY_HEADING.test(heading)) continue;
    for (const { page, sentence } of allSentences(document.pages)) {
      const share = shareFigure(sentence);
      if (!share || out.some((figure) => figure.key === share.key)) continue;
      out.push({ ...share, year: /\b(20\d{2})\b/.exec(sentence)?.[1] ?? null, quote: quoteOf(page, sentence) });
    }
  }
  return out;
}

/** Points within which a deck figure agrees with the cost report, and beyond which it is contradicted. */
export const COST_REPORT_CLAIM_TOLERANCE = { verified: '1', contradicted: '3' } as const;
/** The cost report's total costs and the P&L's for the same year differing by more than this share is a finding. */
export const COST_REPORT_PNL_TOLERANCE = '0.02';

export interface CostReportReconciliation {
  readonly report: CostReportReading;
  readonly fiscalYear: string;
  readonly costReportCosts: Decimal;
  /** Cost of revenue plus operating expenses, from the imported P&L for the same fiscal year. */
  readonly pnlCosts: Decimal;
  readonly difference: Decimal;
  readonly share: Decimal;
  readonly agrees: boolean;
  readonly evidenceIds: readonly string[];
}

/** Each cost report's total costs against the imported P&L for its fiscal year (null when either is missing). */
export function costReportReconciliations(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): CostReportReconciliation[] {
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  return costReports(pages).flatMap((report) => {
    const total = report.figures.find((figure) => figure.key === 'TOTAL_COSTS');
    if (!total || !report.fiscalYear) return [];
    const year = pnlForPeriod(periods, report.fiscalYear);
    if (!year) return [];
    const pnlCosts = new D(year.costOfRevenue).plus(year.operatingExpenses);
    const difference = pnlCosts.minus(total.value);
    const share = total.value.gt(0) ? difference.abs().div(total.value) : new D(0);
    const ids = year.sources.filter((row) => row.kind === 'COGS' || row.kind === 'OPEX').map((row) => row.evidenceId);
    return [{ report, fiscalYear: report.fiscalYear, costReportCosts: total.value, pnlCosts, difference, share, agrees: share.lte(COST_REPORT_PNL_TOLERANCE), evidenceIds: ids }];
  });
}

/** Census-derived occupancy for the cost report's fiscal year, when the census covers all twelve of its months and the report states its beds. */
export function censusOccupancy(evidence: readonly PackRuleEvidence[], report: CostReportReading): Decimal | null {
  if (!report.fiscalYear || !report.beds) return null;
  const months = Array.from({ length: 12 }, (_, index) => `${report.fiscalYear}-${String(index + 1).padStart(2, '0')}`);
  const rows = evidence.filter((row) => row.evidenceType === CENSUS_MONTH && months.includes(text(row, 'month')));
  if (new Set(rows.map((row) => text(row, 'month'))).size < 12) return null;
  const days = months.reduce((total, month) => total + daysInMonth(month), 0);
  return sum(rows, (row) => dec(row.canonical['patient_days']) ?? new D(0)).div(report.beds.value.times(days)).times(100);
}

// ------------------------------------------------------------------ payer agreements

export interface PayerAgreement {
  readonly documentId: string;
  readonly payer: string;
  readonly heading: PackRuleQuote;
  readonly rateBasis: PackRuleQuote | null;
  readonly expiresOn: string | null;
  readonly expiry: PackRuleQuote | null;
  readonly renegotiation: PackRuleQuote | null;
  readonly autoRenews: boolean;
}

const AGREEMENT_HEADING = /\b(?:agreement|contract)\b/i;
const EXPIRY_SENTENCE = /\b(?:term|agreement|contract)\b[^.]*?\b(ends|expires|terminates|runs (?:to|until|through))\b/i;
const RATE_SENTENCE = /\b(?:reimburs\w*|paid (?:at|on)|pays?|per diem|DRGs?|case rates?|fee schedule|percent(?:age)? of (?:Medicare|billed charges|charges)|rates? (?:are|is|for))\b/i;
const RENEGOTIATION = /\b(?:renegotiat\w*|non-renewal|renew\w*|rate review|notice of termination|evergreen)\b/i;
const AUTO_RENEWS = /\b(?:renews? automatically|automatic(?:ally)? renew\w*|evergreen)\b/i;
const NEGATED = /\b(?:no|not|none|without|nor)\b/i;
const bare = (payer: string) => payer.replace(/\s*\(synthetic\)\s*$/i, '').trim();

/**
 * The payer agreements in the documents for the payers the payer-mix export names: a document headed
 * "… agreement …" whose first page names the payer. Read sentence by sentence: the rate basis, when the
 * term ends, and the renewal or renegotiation window. The first agreement found for a payer is read.
 */
export function payerAgreements(pages: readonly PackRulePage[], payers: readonly string[]): PayerAgreement[] {
  const out: PayerAgreement[] = [];
  for (const document of documents(pages)) {
    const heading = document.heading;
    if (!heading || !AGREEMENT_HEADING.test(heading.quote)) continue;
    const firstPage = collapse(document.pages[0]?.text ?? '').toLowerCase();
    const payer = payers.find((name) => bare(name) && firstPage.includes(bare(name).toLowerCase()));
    if (!payer || out.some((agreement) => agreement.payer === payer)) continue;
    let expiresOn: string | null = null;
    let expiry: PackRuleQuote | null = null;
    let rateBasis: PackRuleQuote | null = null;
    let renegotiation: PackRuleQuote | null = null;
    for (const { page, sentence } of allSentences(document.pages)) {
      const ends = EXPIRY_SENTENCE.exec(sentence);
      const date = ends ? dateIn(sentence.slice(ends.index + ends[0].length - (ends[1]?.length ?? 0))) : null;
      if (!expiry && date) {
        expiresOn = date;
        expiry = quoteOf(page, sentence);
        continue;
      }
      if (!rateBasis && RATE_SENTENCE.test(sentence) && sentence !== heading.quote) rateBasis = quoteOf(page, sentence);
      else if (!renegotiation && RENEGOTIATION.test(sentence) && sentence !== heading.quote) renegotiation = quoteOf(page, sentence);
    }
    const autoRenews = renegotiation !== null && AUTO_RENEWS.test(renegotiation.quote) && !NEGATED.test(renegotiation.quote);
    out.push({ documentId: document.documentId, payer, heading, rateBasis, expiresOn, expiry, renegotiation, autoRenews });
  }
  return out;
}

/** A contracted payer at or above this share of trailing net revenue is material. */
export const MATERIAL_PAYER_SHARE = '0.05';
/** An agreement ending within this many months of closing is a finding. */
export const CONTRACT_WINDOW_MONTHS = 12;
export type HospitalPayerContractState = 'EXPIRED_AT_CLOSE' | 'EXPIRES_WITHIN_YEAR' | 'RENEWS' | 'CURRENT' | 'NO_EXPIRY' | 'NO_AGREEMENT' | 'NOT_CONTRACTED';

export interface HospitalPayerContractStatus {
  readonly payer: PayerShare;
  readonly material: boolean;
  readonly largestContracted: boolean;
  readonly agreement: PayerAgreement | null;
  readonly monthsAfterClose: number | null;
  readonly state: HospitalPayerContractState;
}

export interface MeasuredFrom {
  readonly date: string;
  readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE';
  readonly quote: PackRuleQuote | null;
}

/** The date contract windows are measured from: a document's stated closing date, else the analysis date. */
export function measuredFrom(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): MeasuredFrom | null {
  const closing = expectedClosing(pages);
  if (closing) return { date: closing.date, basis: 'EXPECTED_CLOSING', quote: closing.quote };
  const asOf = hospitalsAnalysisDate(evidence);
  return asOf ? { date: asOf, basis: 'ANALYSIS_DATE', quote: null } : null;
}

/** Every payer in the payer-mix window, with its agreement and when the term ends relative to closing. */
export function hospitalPayerContracts(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { from: MeasuredFrom | null; payers: HospitalPayerContractStatus[] } {
  const window = payerWindow(evidence);
  const from = measuredFrom(evidence, pages);
  if (!window) return { from, payers: [] };
  const agreements = payerAgreements(pages, window.payers.filter((payer) => payer.contracted).map((payer) => payer.payer));
  const largest = window.payers.find((payer) => payer.contracted);
  return {
    from,
    payers: window.payers.map((payer): HospitalPayerContractStatus => {
      const agreement = agreements.find((entry) => entry.payer === payer.payer) ?? null;
      const material = payer.contracted && (payer.share?.gte(MATERIAL_PAYER_SHARE) ?? false);
      const monthsAfterClose = agreement?.expiresOn && from ? wholeMonths(from.date, agreement.expiresOn) : null;
      const state: HospitalPayerContractState = !payer.contracted
        ? 'NOT_CONTRACTED'
        : !agreement
          ? 'NO_AGREEMENT'
          : !agreement.expiresOn || !from
            ? 'NO_EXPIRY'
            : agreement.expiresOn <= from.date
              ? 'EXPIRED_AT_CLOSE'
              : agreement.autoRenews
                ? 'RENEWS'
                : agreement.expiresOn < addMonths(from.date, CONTRACT_WINDOW_MONTHS)
                  ? 'EXPIRES_WITHIN_YEAR'
                  : 'CURRENT';
      return { payer, material, largestContracted: payer === largest, agreement, monthsAfterClose, state };
    }),
  };
}

// ------------------------------------------------------------------ the medical staff

export interface StaffRow {
  readonly id: string;
  readonly staffRef: string;
  readonly department: string;
  readonly role: string;
  readonly licenceStatus: string;
  readonly licenceExpiresOn: string | null;
  readonly privilegeStatus: string;
  readonly privilegesExpireOn: string | null;
}

export function medicalStaff(evidence: readonly PackRuleEvidence[]): StaffRow[] {
  return evidence
    .filter((row) => row.evidenceType === MEDICAL_STAFF)
    .map((row) => ({
      id: row.id,
      staffRef: text(row, 'staff_ref'),
      department: text(row, 'department'),
      role: text(row, 'role'),
      licenceStatus: text(row, 'licence_status').toLowerCase(),
      licenceExpiresOn: dateOf(row, 'licence_expires_on'),
      privilegeStatus: text(row, 'privilege_status').toLowerCase(),
      privilegesExpireOn: dateOf(row, 'privileges_expire_on'),
    }))
    .filter((row) => row.staffRef && row.department)
    .sort((a, b) => a.department.localeCompare(b.department) || a.staffRef.localeCompare(b.staffRef));
}

/** At least this many staff of one department sharing a privilege date is a department lapsing together. */
export const DEPARTMENT_CLUSTER_SIZE = 3;
/** Days within which privileges falling due together are a closing deliverable. */
export const PRIVILEGES_DUE_DAYS = 90;
const NOT_HOLDING = /\b(?:lapsed|expired|suspended|relinquished|revoked)\b/i;

export interface StaffStatus {
  readonly row: StaffRow;
  /** The licence expiry: a verification document's date governs over the register. */
  readonly licenceExpiresOn: string | null;
  readonly licenceVerified: PackRuleQuote | null;
  readonly licenceExpired: boolean;
  readonly privilegesLapsed: boolean;
}

/** Each member of the medical staff at the analysis date. */
export function staffStatuses(rows: readonly StaffRow[], pages: readonly PackRulePage[], asOf: string | null): StaffStatus[] {
  return rows.map((row) => {
    const verified = verifiedExpiry(pages, row.staffRef, 'state_licence');
    const licenceExpiresOn = verified?.date ?? row.licenceExpiresOn;
    const licenceExpired = (asOf !== null && licenceExpiresOn !== null && licenceExpiresOn < asOf) || /\b(?:expired|revoked|suspended)\b/.test(row.licenceStatus);
    const privilegesLapsed = row.privilegeStatus !== 'reappointed' && ((asOf !== null && row.privilegesExpireOn !== null && row.privilegesExpireOn < asOf) || NOT_HOLDING.test(row.privilegeStatus));
    return { row, licenceExpiresOn, licenceVerified: verified?.quote ?? null, licenceExpired, privilegesLapsed };
  });
}

export interface DepartmentCluster {
  readonly department: string;
  readonly date: string;
  readonly state: 'LAPSED' | 'DUE';
  readonly staff: readonly StaffRow[];
  /** All of the department's staff in the register. */
  readonly departmentSize: number;
}

/** Departments whose privileges lapse together: three or more of their staff on one date, lapsed or due within 90 days. */
export function departmentClusters(rows: readonly StaffRow[], asOf: string | null): DepartmentCluster[] {
  if (!asOf) return [];
  const due = addDays(asOf, PRIVILEGES_DUE_DAYS);
  const out: DepartmentCluster[] = [];
  for (const department of [...new Set(rows.map((row) => row.department))].sort()) {
    const mine = rows.filter((row) => row.department === department);
    for (const date of [...new Set(mine.flatMap((row) => (row.privilegesExpireOn ? [row.privilegesExpireOn] : [])))].sort()) {
      const staff = mine.filter((row) => row.privilegesExpireOn === date && row.privilegeStatus !== 'reappointed');
      if (staff.length < DEPARTMENT_CLUSTER_SIZE) continue;
      const state = date < asOf ? 'LAPSED' : date <= due ? 'DUE' : null;
      if (state) out.push({ department, date, state, staff, departmentSize: mine.length });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the plant and capex trend

/** A hospital's key expenses for the multi-year P&L trend; capital spend is the one the plant check reads. */
export const HOSPITALS_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'labour', label: 'Salaries, wages and benefits', pattern: /\b(?:salar(?:y|ies)|wages)\b/i },
  { key: 'contract_labour', label: 'Contract labour', pattern: /\b(?:contract (?:labou?r|staff)|agency (?:staff|nurs\w*))\b/i },
  { key: 'supplies', label: 'Medical supplies and drugs', pattern: /\b(?:suppl(?:y|ies)|drugs|pharmac\w*)\b/i },
  { key: 'capital', label: 'Capital spend on plant and equipment', pattern: /\b(?:capital[- ]related|capital (?:spend|expenditure)|capex)\b/i },
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\b(?:repairs?|maintenance)\b/i },
];

export interface CapexYear {
  readonly year: string;
  readonly amount: Decimal;
  readonly revenue: Decimal;
  readonly ratio: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/** Capital spend as a share of revenue in every fiscal year the imported P&L covers in full. */
export function capexYears(evidence: readonly PackRuleEvidence[]): { years: CapexYear[]; trend: readonly TrendYear[] } {
  const trend = trendOf(evidence, HOSPITALS_KEY_EXPENSES);
  const years = trend.years.flatMap((year): CapexYear[] => {
    const capital = year.ratios.find((entry) => entry.key === 'capital');
    if (!capital || capital.evidenceIds.length === 0) return [];
    return [{ year: year.year, amount: new D(capital.amount), revenue: new D(year.revenue), ratio: capital.ratio === null ? null : new D(capital.ratio), evidenceIds: capital.evidenceIds }];
  });
  return { years, trend: trend.years };
}

/** Capital spend that ends at or below this share of its first year's ratio, falling every year, is a finding. */
export const CAPEX_FALL_FACTOR = '0.75';

const MODERN_PLANT = /\b(?:modern|new|newly built|state-of-the-art|fully (?:renovated|refurbished|modernised|modernized)|recently (?:renovated|refurbished|modernised|modernized))\b[^.]*\b(?:plant|facilit(?:y|ies)|campus|building|hospital|infrastructure)\b/i;
const CONDITION_HEADING = /\b(?:property|facility|building|plant) condition\b|\bcondition assessment\b/i;
const CONDITION_STATEMENT = /\bdeferred maintenance\b|\bpast (?:its|their) (?:expected )?(?:service|useful|design) life\b|\bend of (?:its|their) (?:service|useful|design) life\b|\b(?:replacement|renewal) (?:is|are) (?:due|overdue|required)\b|\bin (?:poor|fair) condition\b/i;

/** The first sentence outside the condition assessments and cost reports that calls the plant modern or renovated. */
export function modernPlantClaim(pages: readonly PackRulePage[]): PackRuleQuote | null {
  for (const document of documents(pages)) {
    const heading = document.heading?.quote ?? '';
    if (CONDITION_HEADING.test(heading) || COST_REPORT_HEADING.test(heading)) continue;
    const found = allSentences(document.pages).find(({ sentence }) => MODERN_PLANT.test(sentence) && !NEGATED.test(sentence));
    if (found) return quoteOf(found.page, found.sentence);
  }
  return null;
}

export interface ConditionAssessment {
  readonly documentId: string;
  readonly heading: PackRuleQuote;
  readonly statements: readonly PackRuleQuote[];
  /** The deferred maintenance a sentence states as an amount, if any. */
  readonly deferredMaintenance: { readonly amount: Decimal; readonly currency: string; readonly quote: PackRuleQuote } | null;
}

/** Each property condition assessment in the documents, with its condition statements. */
export function conditionAssessments(pages: readonly PackRulePage[]): ConditionAssessment[] {
  return documents(pages).flatMap((document): ConditionAssessment[] => {
    if (!document.heading || !CONDITION_HEADING.test(document.heading.quote)) return [];
    const statements = allSentences(document.pages)
      .filter(({ sentence }) => CONDITION_STATEMENT.test(sentence))
      .map(({ page, sentence }) => quoteOf(page, sentence));
    const deferred = statements.find((quote) => /deferred maintenance/i.test(quote.quote) && moneyIn(quote.quote));
    const amount = deferred ? moneyIn(deferred.quote) : null;
    return [{ documentId: document.documentId, heading: document.heading, statements, deferredMaintenance: deferred && amount ? { ...amount, quote: deferred } : null }];
  });
}

// ------------------------------------------------------------------ quality reporting

const QUALITY_HEADING = /\bquality report(?:ing)?\b|\bstar rating\b|\bhospital compare\b|\bcare compare\b|\bquality ratings?\b/i;
const STAR_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const STARS = /\b(one|two|three|four|five|[1-5])[- ]stars?\b|\bstar rating\b\D{0,20}([1-5])\b/i;
const starsIn = (sentence: string): number | null => {
  const match = STARS.exec(sentence);
  const word = (match?.[1] ?? match?.[2] ?? '').toLowerCase();
  return word ? (STAR_WORDS[word] ?? Number(word)) : null;
};

export interface QualityReport {
  readonly documentId: string;
  readonly heading: PackRuleQuote;
  readonly stars: { readonly value: number; readonly quote: PackRuleQuote } | null;
}

/** Each quality-reporting document supplied (headed "… quality report …" or "… star rating …"), with the overall rating it states. */
export function qualityReports(pages: readonly PackRulePage[]): QualityReport[] {
  return documents(pages).flatMap((document): QualityReport[] => {
    if (!document.heading || !QUALITY_HEADING.test(document.heading.quote)) return [];
    const found = allSentences(document.pages).find(({ sentence }) => starsIn(sentence) !== null && /\boverall\b|\bstar rating\b/i.test(sentence));
    const value = found ? starsIn(found.sentence) : null;
    return [{ documentId: document.documentId, heading: document.heading, stars: found && value ? { value, quote: quoteOf(found.page, found.sentence) } : null }];
  });
}

export interface QualityClaim {
  readonly stars: number;
  readonly quote: PackRuleQuote;
}

/** The star ratings the deck and other seller documents claim, outside the quality-reporting documents. */
export function qualityClaims(pages: readonly PackRulePage[]): QualityClaim[] {
  const out: QualityClaim[] = [];
  for (const document of documents(pages)) {
    if (QUALITY_HEADING.test(document.heading?.quote ?? '')) continue;
    for (const { page, sentence } of allSentences(document.pages)) {
      const stars = starsIn(sentence);
      if (stars !== null && /\brat(?:ed|ing|ings)\b/i.test(sentence) && !out.some((claim) => claim.quote.quote === sentence)) out.push({ stars, quote: quoteOf(page, sentence) });
    }
  }
  return out;
}
