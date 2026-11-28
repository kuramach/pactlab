import { D, parseDecimal } from '../../metrics/decimal';
import type { TrendYear } from '../../pnl/trend';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { documentExpiry, lastDayOfMonth } from '../fintech/payments';
import { credentialRows, payerContracts, ROSTER, verifiedExpiry, type CredentialRow, type PayerContract } from '../healthcare/practice';
import { recentTrendOf } from '../pnl-trend';
import { collapse, sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';
import type { KeyExpense } from '../../pnl/trend';

/**
 * The hospitals operations model (T-162, ADR 0067), deterministic and decimal-only: what a hospital's own
 * evidence says, read beside the deck and the financial statements. The filed cost reports' statistics
 * (beds, bed days, patient days by programme, total costs), the payer contract register against the
 * expected closing, the medical-staff register (licences and privileges, by department), capital
 * expenditure against the P&L's revenue, and quality ratings as the reporting documents state them. Every
 * figure names the rows or the sentence it rests on. Documents, dates and arithmetic only: never a view on
 * the quality of care or the outcome of a survey. Changing a rule is a new HOSPITALS_OPERATIONS_VERSION.
 */
export const HOSPITALS_OPERATIONS_VERSION = 'hospitals-operations-2';
export const HOSPITAL_CENSUS = 'hospitals.census_month';
export const HOSPITAL_PAYER = 'hospitals.payer_month';
export const COST_REPORT = 'hospitals.cost_report_year';
export const HOSPITAL_CAPEX = 'hospitals.capex_year';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
const nameKey = (name: string) => name.toLowerCase().replace(/\(synthetic\)/g, '').replace(/\s+/g, ' ').trim();

/** The analysis date: the last day of the latest month in the census or payer-mix exports. */
export function hospitalsAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = evidence
    .filter((row) => row.evidenceType === HOSPITAL_CENSUS || row.evidenceType === HOSPITAL_PAYER)
    .map((row) => text(row, 'month'))
    .filter((month) => MONTH.test(month))
    .sort()
    .at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

// ------------------------------------------------------------------ documents by kind

function byDocument(pages: readonly PackRulePage[]): PackRulePage[][] {
  const grouped = new Map<string, PackRulePage[]>();
  for (const page of pages) grouped.set(page.documentId, [...(grouped.get(page.documentId) ?? []), page]);
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, own]) => [...own].sort((a, b) => a.pageNumber - b.pageNumber));
}
const headingOf = (own: readonly PackRulePage[]) => sentences(own[0]?.text ?? '')[0] ?? '';

/** Documents that reproduce imported extracts, and the filed reports themselves, are never read as claims. */
const EXTRACTS_HEADING = /\bextracts?\b/i;
const COST_REPORT_HEADING = /\bcost report\b/i;
const QUALITY_REPORT_HEADING = /\b(?:quality (?:report|reporting|ratings?)|care compare|star ratings? report|safety grade report|hospital compare)\b/i;
const CONDITION_HEADING = /\b(?:property|facility|facilities|building|plant) condition\b|\bcondition (?:assessment|survey|report)\b/i;

/** The deck, memorandum and other narrative documents: what the seller claims. */
export function claimPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => {
      const heading = headingOf(own);
      return !EXTRACTS_HEADING.test(heading) && !COST_REPORT_HEADING.test(heading) && !QUALITY_REPORT_HEADING.test(heading) && !CONDITION_HEADING.test(heading);
    })
    .flat();
}

/** The quality reporting documents supplied (a Care Compare extract, a star-rating report, a safety-grade report). */
export function qualityReportPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => QUALITY_REPORT_HEADING.test(headingOf(own)) && !EXTRACTS_HEADING.test(headingOf(own)))
    .flat();
}

/** Property or facility condition assessments: evidence of the plant's state. */
export function conditionPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => CONDITION_HEADING.test(headingOf(own)))
    .flat();
}

// ------------------------------------------------------------------ the filed cost reports

export interface CostReportYear {
  readonly id: string;
  readonly year: string;
  readonly beds: Decimal | null;
  readonly bedDaysAvailable: Decimal;
  readonly patientDays: Decimal;
  readonly medicareDays: Decimal | null;
  readonly medicaidDays: Decimal | null;
  readonly totalCosts: Decimal | null;
  readonly netPatientRevenue: Decimal | null;
  /** Patient days ÷ bed days available. */
  readonly occupancy: Decimal | null;
  readonly medicareShare: Decimal | null;
  readonly medicaidShare: Decimal | null;
  /** Total costs ÷ patient days. */
  readonly costPerPatientDay: Decimal | null;
}

/** The cost reports' statistics, one per fiscal year, oldest first. */
export function costReportYears(evidence: readonly PackRuleEvidence[]): CostReportYear[] {
  return evidence
    .filter((row) => row.evidenceType === COST_REPORT && YEAR.test(text(row, 'fiscal_year')))
    .flatMap((row): CostReportYear[] => {
      const bedDaysAvailable = dec(row.canonical['bed_days_available']);
      const patientDays = dec(row.canonical['patient_days']);
      if (!bedDaysAvailable || !patientDays) return [];
      const medicareDays = dec(row.canonical['medicare_days']);
      const medicaidDays = dec(row.canonical['medicaid_days']);
      const totalCosts = dec(row.canonical['total_costs']);
      return [
        {
          id: row.id,
          year: text(row, 'fiscal_year'),
          beds: dec(row.canonical['beds']),
          bedDaysAvailable,
          patientDays,
          medicareDays,
          medicaidDays,
          totalCosts,
          netPatientRevenue: dec(row.canonical['net_patient_revenue']),
          occupancy: ratio(patientDays, bedDaysAvailable),
          medicareShare: medicareDays ? ratio(medicareDays, patientDays) : null,
          medicaidShare: medicaidDays ? ratio(medicaidDays, patientDays) : null,
          costPerPatientDay: totalCosts ? ratio(totalCosts, patientDays) : null,
        },
      ];
    })
    .sort((a, b) => a.year.localeCompare(b.year) || a.id.localeCompare(b.id))
    .filter((row, index, all) => all.findIndex((other) => other.year === row.year) === index);
}

export type CostReportClaimKey = 'OCCUPANCY' | 'MEDICARE_SHARE' | 'MEDICAID_SHARE';
export interface CostReportClaim {
  readonly key: CostReportClaimKey;
  readonly label: string;
  /** As a fraction. */
  readonly value: Decimal;
  /** The fiscal year the sentence names; null → the latest cost report. */
  readonly year: string | null;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<CostReportClaimKey, string>> = { OCCUPANCY: 'Occupancy', MEDICARE_SHARE: 'Medicare share of patient days', MEDICAID_SHARE: 'Medicaid share of patient days' };
/** "average occupancy of 82%", "occupancy was 82%" — never across a colon (a KPI table line). */
const OCCUPANCY = /\boccupancy\b[^:%]*?\b(?:of|was|at|averaged|is|reached)\s+([0-9]+(?:\.[0-9]+)?)\s?%/i;
const SHARE_OF_DAYS = (programme: string) => new RegExp(`\\b${programme}\\b[^:%]*?\\b([0-9]+(?:\\.[0-9]+)?)\\s?%\\s+of\\s+(?:inpatient\\s+|patient\\s+)?(?:patient\\s+)?days\\b`, 'i');
const FISCAL_YEAR = /\b(?:FY\s?|fiscal (?:year\s)?)(20\d{2})\b/i;

/** The occupancy and payer-mix claims the narrative documents state, first of each. */
export function costReportClaims(pages: readonly PackRulePage[]): CostReportClaim[] {
  const found = new Map<CostReportClaimKey, CostReportClaim>();
  const patterns: readonly [CostReportClaimKey, RegExp][] = [['OCCUPANCY', OCCUPANCY], ['MEDICARE_SHARE', SHARE_OF_DAYS('medicare')], ['MEDICAID_SHARE', SHARE_OF_DAYS('medicaid')]];
  for (const page of claimPages(pages)) {
    for (const sentence of sentences(page.text)) {
      for (const [key, pattern] of patterns) {
        if (found.has(key)) continue;
        const value = dec(pattern.exec(sentence)?.[1]);
        if (!value) continue;
        found.set(key, { key, label: CLAIM_LABELS[key], value: value.div(100), year: FISCAL_YEAR.exec(sentence)?.[1] ?? null, quote: quoteOf(page, sentence) });
      }
    }
  }
  return (['OCCUPANCY', 'MEDICARE_SHARE', 'MEDICAID_SHARE'] as const).flatMap((key) => {
    const claim = found.get(key);
    return claim ? [claim] : [];
  });
}

/** Points (as a fraction) within which a claim is verified, and beyond which it is contradicted. */
export const COST_REPORT_TOLERANCE = { verified: '0.01', contradicted: '0.03' } as const;

export interface CostReportClaimCheck {
  readonly claim: CostReportClaim;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'WITHIN_TOLERANCE';
  readonly report: CostReportYear | null;
  readonly measured: Decimal | null;
}

/** Each claim against the cost report of the year it names (else the latest). */
export function checkCostReportClaims(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): CostReportClaimCheck[] {
  const reports = costReportYears(evidence);
  return costReportClaims(pages).map((claim): CostReportClaimCheck => {
    const report = claim.year ? (reports.find((entry) => entry.year === claim.year) ?? null) : (reports.at(-1) ?? null);
    const measured = !report ? null : claim.key === 'OCCUPANCY' ? report.occupancy : claim.key === 'MEDICARE_SHARE' ? report.medicareShare : report.medicaidShare;
    if (!report || !measured) return { claim, status: 'UNVERIFIED', report, measured: null };
    const gap = claim.value.minus(measured).abs();
    const status = gap.lte(COST_REPORT_TOLERANCE.verified) ? 'VERIFIED' : gap.gt(COST_REPORT_TOLERANCE.contradicted) ? 'CONTRADICTED' : 'WITHIN_TOLERANCE';
    return { claim, status, report, measured };
  });
}

/** A cost report's total costs more than this share away from the P&L's costs for the year is a finding. */
export const COST_RECONCILIATION_TOLERANCE = '0.02';

export interface CostReconciliation {
  readonly report: CostReportYear;
  readonly year: TrendYear;
  /** Cost of revenue + operating expenses, from the imported P&L. */
  readonly pnlCosts: Decimal;
  readonly gap: Decimal;
  readonly share: Decimal | null;
}

/** Each fiscal year both the cost reports and the imported P&L hold: total costs side by side. */
export function costReconciliations(evidence: readonly PackRuleEvidence[]): CostReconciliation[] {
  const trend = recentTrendOf(evidence, []);
  return costReportYears(evidence).flatMap((report): CostReconciliation[] => {
    const year = trend.years.find((entry) => entry.year === report.year);
    if (!year || !report.totalCosts) return [];
    const pnlCosts = new D(year.costOfRevenue).plus(year.operatingExpenses);
    const gap = report.totalCosts.minus(pnlCosts);
    return [{ report, year, pnlCosts, gap, share: ratio(gap.abs(), pnlCosts) }];
  });
}

// ------------------------------------------------------------------ payers and their contracts

export interface PayerWindow {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly total: Decimal;
  /** Largest first. */
  readonly payers: readonly { readonly payer: string; readonly netRevenue: Decimal; readonly share: Decimal | null; readonly rows: readonly PackRuleEvidence[] }[];
}

/** Net revenue by payer over the twelve months to the latest month in the payer-mix export. */
export function payerWindow(evidence: readonly PackRuleEvidence[]): PayerWindow | null {
  const rows = evidence.filter((row) => row.evidenceType === HOSPITAL_PAYER && MONTH.test(text(row, 'month')));
  const latest = rows.map((row) => text(row, 'month')).sort().at(-1);
  if (!latest) return null;
  const [year = 0, month = 1] = latest.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 12 + index, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const inWindow = rows.filter((row) => months.includes(text(row, 'month')));
  const present = new Set(inWindow.map((row) => text(row, 'month')));
  const total = sum(inWindow, (row) => dec(row.canonical['net_revenue']) ?? new D(0));
  const names = [...new Set(inWindow.map((row) => text(row, 'payer')))].filter(Boolean);
  const payers = names
    .map((payer) => {
      const own = inWindow.filter((row) => text(row, 'payer') === payer);
      const netRevenue = sum(own, (row) => dec(row.canonical['net_revenue']) ?? new D(0));
      return { payer, netRevenue, share: ratio(netRevenue, total), rows: own };
    })
    .sort((a, b) => b.netRevenue.comparedTo(a.netRevenue) || a.payer.localeCompare(b.payer));
  return { from: months[0] ?? latest, to: latest, missing: months.filter((entry) => !present.has(entry)), total, payers };
}

/** A payer with this share of trailing net revenue or more is material. */
export const MATERIAL_PAYER_SHARE = '0.1';
/** A material contract ending within this many months after the closing (or before it), without automatic renewal, is a finding. */
export const CONTRACT_WINDOW_MONTHS = 12;
const SELF_PAY = /\bself[- ]?pay\b|\buninsured\b/i;

export type HospitalContractState = 'ENDS_BEFORE_CLOSING' | 'ENDS_IN_WINDOW' | 'RENEWS' | 'ENDS_LATER' | 'NO_END' | 'MISSING';
export interface HospitalContractStatus {
  readonly payer: string;
  readonly netRevenue: Decimal;
  readonly share: Decimal | null;
  readonly rank: number;
  readonly rows: readonly PackRuleEvidence[];
  readonly contract: PayerContract | null;
  readonly endsOn: string | null;
  readonly endBasis: 'DOCUMENT' | 'REGISTER' | null;
  readonly endQuote: PackRuleQuote | null;
  /** Whole months from the closing to the end; negative when it ends before. */
  readonly monthsAfter: number | null;
  readonly state: HospitalContractState;
}

export interface ContractRegister {
  readonly from: { readonly date: string; readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; readonly quote: PackRuleQuote | null } | null;
  readonly window: PayerWindow | null;
  /** Material payers (self-pay aside), largest first. */
  readonly payers: readonly HospitalContractStatus[];
}

/** Every material payer in the payer mix against the contract register, measured from the expected closing. */
export function contractRegister(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): ContractRegister {
  const window = payerWindow(evidence);
  const closing = expectedClosing(claimPages(pages));
  const asOf = hospitalsAnalysisDate(evidence);
  const from = closing ? { date: closing.date, basis: 'EXPECTED_CLOSING' as const, quote: closing.quote } : asOf ? { date: asOf, basis: 'ANALYSIS_DATE' as const, quote: null } : null;
  const contracts = payerContracts(evidence);
  const payers = (window?.payers ?? [])
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
    .filter((entry) => !SELF_PAY.test(entry.payer) && (entry.share?.gte(MATERIAL_PAYER_SHARE) ?? false))
    .map((entry): HospitalContractStatus => {
      const contract =
        contracts.filter((candidate) => nameKey(candidate.payer) === nameKey(entry.payer)).sort((a, b) => (b.expiresOn ?? '9999-12-31').localeCompare(a.expiresOn ?? '9999-12-31'))[0] ?? null;
      const stated = contract ? documentExpiry(pages, contract.contractId) : null;
      const endsOn = stated?.date ?? contract?.expiresOn ?? null;
      const monthsAfter = endsOn && from ? (endsOn < from.date ? -1 : wholeMonths(from.date, endsOn)) : null;
      const state: HospitalContractState = !contract
        ? 'MISSING'
        : contract.autoRenews
          ? 'RENEWS'
          : !endsOn
            ? 'NO_END'
            : from && endsOn < from.date
              ? 'ENDS_BEFORE_CLOSING'
              : (monthsAfter ?? CONTRACT_WINDOW_MONTHS) < CONTRACT_WINDOW_MONTHS
                ? 'ENDS_IN_WINDOW'
                : 'ENDS_LATER';
      return { ...entry, contract, endsOn, endBasis: stated ? 'DOCUMENT' : endsOn ? 'REGISTER' : null, endQuote: stated?.quote ?? null, monthsAfter, state };
    });
  return { from, window, payers };
}

// ------------------------------------------------------------------ the medical staff

const LAPSED_STATUS = /^(?:expired|lapsed|suspended|revoked|inactive)$/;
const PRIVILEGES = /privilege/;
/** Days within which a credential expiring after the analysis date is a near expiry. */
export const STAFF_NEAR_EXPIRY_DAYS = 90;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface StaffCredential {
  readonly row: CredentialRow;
  readonly isPrivilege: boolean;
  readonly department: string;
  readonly expiresOn: string | null;
  readonly basis: 'DOCUMENT' | 'REGISTER' | null;
  readonly quote: PackRuleQuote | null;
  readonly state: 'LAPSED' | 'NEAR_EXPIRY' | 'CURRENT' | 'NO_EXPIRY';
}

/** The register at the analysis date, each row's department from the register or, without it, the roster's specialty. */
export function staffCredentials(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[], asOf: string | null): StaffCredential[] {
  const specialty = new Map(evidence.filter((row) => row.evidenceType === ROSTER).map((row) => [text(row, 'provider_ref'), text(row, 'specialty')]));
  return credentialRows(evidence).map((row): StaffCredential => {
    const stated = verifiedExpiry(pages, row.providerRef, row.kind);
    const expiresOn = stated?.date ?? row.expiresOn;
    const state =
      LAPSED_STATUS.test(row.status) || (expiresOn && asOf && expiresOn < asOf)
        ? 'LAPSED'
        : !expiresOn
          ? 'NO_EXPIRY'
          : asOf && daysBetween(asOf, expiresOn) <= STAFF_NEAR_EXPIRY_DAYS
            ? 'NEAR_EXPIRY'
            : 'CURRENT';
    return {
      row,
      isPrivilege: PRIVILEGES.test(row.kind),
      department: row.department || specialty.get(row.providerRef) || '',
      expiresOn,
      basis: stated ? 'DOCUMENT' : expiresOn ? 'REGISTER' : null,
      quote: stated?.quote ?? null,
      state,
    };
  });
}

export interface PrivilegeCluster {
  readonly department: string;
  readonly date: string;
  readonly state: 'LAPSED' | 'NEAR_EXPIRY';
  readonly members: readonly StaffCredential[];
  /** Physicians holding privileges in the department. */
  readonly departmentSize: number;
}

/** Physicians sharing one privilege date in a department: at least this many… */
export const PRIVILEGE_CLUSTER_MIN = 2;
/** …and at least this share of the department's privileged physicians. */
export const PRIVILEGE_CLUSTER_SHARE = '0.5';

/** Departments whose physicians' privileges lapse together: one date, lapsed or near, for a cluster of the department. */
export function privilegeClusters(staff: readonly StaffCredential[]): PrivilegeCluster[] {
  const privileges = staff.filter((entry) => entry.isPrivilege && entry.department);
  const departments = [...new Set(privileges.map((entry) => entry.department))].sort();
  return departments.flatMap((department) => {
    const own = privileges.filter((entry) => entry.department === department);
    const size = new Set(own.map((entry) => entry.row.providerRef)).size;
    const dates = [...new Set(own.filter((entry) => entry.expiresOn && (entry.state === 'LAPSED' || entry.state === 'NEAR_EXPIRY')).map((entry) => entry.expiresOn as string))].sort();
    return dates.flatMap((date): PrivilegeCluster[] => {
      const members = own.filter((entry) => entry.expiresOn === date && (entry.state === 'LAPSED' || entry.state === 'NEAR_EXPIRY'));
      const physicians = new Set(members.map((entry) => entry.row.providerRef)).size;
      if (physicians < PRIVILEGE_CLUSTER_MIN || new D(physicians).div(size).lt(PRIVILEGE_CLUSTER_SHARE)) return [];
      return [{ department, date, state: members.some((entry) => entry.state === 'LAPSED') ? 'LAPSED' : 'NEAR_EXPIRY', members, departmentSize: size }];
    });
  });
}

/** Rostered physicians with no current licence, or no privileges, on the register. */
export function rosterGaps(evidence: readonly PackRuleEvidence[], staff: readonly StaffCredential[]): { providerRef: string; missing: 'LICENCE' | 'PRIVILEGES'; row: PackRuleEvidence }[] {
  return evidence
    .filter((row) => row.evidenceType === ROSTER && text(row, 'provider_ref'))
    .sort((a, b) => text(a, 'provider_ref').localeCompare(text(b, 'provider_ref')))
    .flatMap((row) => {
      const ref = text(row, 'provider_ref');
      const own = staff.filter((entry) => entry.row.providerRef === ref);
      const gaps: { providerRef: string; missing: 'LICENCE' | 'PRIVILEGES'; row: PackRuleEvidence }[] = [];
      if (!own.some((entry) => /licen[cs]e/.test(entry.row.kind))) gaps.push({ providerRef: ref, missing: 'LICENCE', row });
      if (!own.some((entry) => entry.isPrivilege)) gaps.push({ providerRef: ref, missing: 'PRIVILEGES', row });
      return gaps;
    });
}

// ------------------------------------------------------------------ the plant

/** A hospital's key expenses for the multi-year P&L trend: staff, supplies, purchased services and the plant's upkeep. */
export const HOSPITALS_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'staff', label: 'Salaries, wages and benefits', pattern: /\b(?:salar(?:y|ies)|wages|benefits|staff costs?)\b/i },
  { key: 'supplies', label: 'Medical supplies and drugs', pattern: /\bsuppl(?:y|ies)\b|\bdrugs?\b|\bpharmac\w*/i },
  { key: 'purchased', label: 'Purchased services', pattern: /\bpurchased services\b|\bcontract(?:ed)? (?:labou?r|services)\b/i },
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\brepairs?\b|\bmaintenance\b/i },
];

export interface CapexYear {
  readonly year: string;
  readonly capex: Decimal;
  readonly revenue: Decimal;
  /** Capex ÷ the P&L's revenue for the year. */
  readonly ratio: Decimal | null;
  readonly capexIds: readonly string[];
  readonly revenueIds: readonly string[];
}

/** Capital expenditure by fiscal year over the imported P&L's revenue, for the years both hold. */
export function hospitalCapexYears(evidence: readonly PackRuleEvidence[]): CapexYear[] {
  const spend = new Map<string, { amount: Decimal; ids: string[] }>();
  for (const row of evidence) {
    const year = text(row, 'fiscal_year');
    const amount = dec(row.canonical['amount']);
    if (row.evidenceType !== HOSPITAL_CAPEX || !YEAR.test(year) || !amount) continue;
    const entry = spend.get(year) ?? { amount: new D(0), ids: [] };
    entry.amount = entry.amount.plus(amount);
    entry.ids.push(row.id);
    spend.set(year, entry);
  }
  return recentTrendOf(evidence, HOSPITALS_KEY_EXPENSES).years.flatMap((year): CapexYear[] => {
    const entry = spend.get(year.year);
    if (!entry) return [];
    const revenue = new D(year.revenue);
    return [{ year: year.year, capex: entry.amount, revenue, ratio: ratio(entry.amount, revenue), capexIds: entry.ids, revenueIds: year.evidenceIds }];
  });
}

/** Capex ÷ revenue falling every year and ending at or below this share of its first year is a declining trend. */
export const CAPEX_DECLINE_FACTOR = '0.75';
export const CAPEX_TREND_MIN_YEARS = 3;

/** True when the ratio falls every year and ends at CAPEX_DECLINE_FACTOR × its first year or lower. */
export function capexFalling(years: readonly CapexYear[]): boolean {
  if (years.length < CAPEX_TREND_MIN_YEARS || years.some((year) => !year.ratio)) return false;
  const series = years.map((year) => year.ratio as Decimal);
  const first = series[0] as Decimal;
  return series.every((value, index) => index === 0 || value.lt(series[index - 1] as Decimal)) && (series.at(-1) as Decimal).lte(first.times(CAPEX_DECLINE_FACTOR));
}

const MODERN_PLANT =
  /\b(?:modern|modernised|modernized|state[- ]of[- ]the[- ]art|newly (?:built|renovated|refurbished)|recently (?:renovated|refurbished|modernised|modernized|upgraded)|well[- ]invested|up[- ]to[- ]date)\b[^.]*\b(?:plant|facilit\w*|campus|buildings?|hospital|infrastructure|estate)\b/i;
const CONDITION_WORDS = /\b(?:deferred|backlog|end of (?:its |their )?(?:useful|service) li(?:fe|ves)|past (?:its|their) useful li(?:fe|ves)|due for replacement|beyond (?:its|their) design li(?:fe|ves))\b/i;

/** The first sentence in a narrative document that claims a modern, well-invested plant. */
export function modernPlantClaim(pages: readonly PackRulePage[]): PackRuleQuote | null {
  for (const page of claimPages(pages)) {
    const sentence = sentences(page.text).find((candidate) => MODERN_PLANT.test(candidate));
    if (sentence) return quoteOf(page, sentence);
  }
  return null;
}

/** What a property or facility condition assessment says about deferred work, with any amount it states. */
export function conditionFindings(pages: readonly PackRulePage[]): PackRuleQuote[] {
  return conditionPages(pages).flatMap((page) =>
    sentences(page.text)
      .filter((sentence) => CONDITION_WORDS.test(sentence))
      .map((sentence) => quoteOf(page, sentence)),
  );
}

// ------------------------------------------------------------------ published quality ratings

export type QualityMeasure = 'STAR_RATING' | 'SAFETY_GRADE';
const MEASURE_LABELS: Readonly<Record<QualityMeasure, string>> = { STAR_RATING: 'Overall star rating', SAFETY_GRADE: 'Hospital safety grade' };
const STAR_SENTENCE = /\bstar rating\b|\b[1-5][- ]star\b/i;
const STAR_VALUE = /\b([1-5])(?:[- ]star|\s+stars?|\s+out of (?:5|five))\b/i;
const GRADE_SENTENCE = /\bsafety grade\b/i;
const GRADE_VALUE = /\bsafety grade\b[^.]*?\b(?:of|is|was|at)\s+(?:an\s+)?["“']?([A-F])(?![A-Za-z])/i;

export interface QualityStatement {
  readonly measure: QualityMeasure;
  readonly label: string;
  readonly value: string;
  readonly quote: PackRuleQuote;
}

function qualityStatements(pages: readonly PackRulePage[]): QualityStatement[] {
  const found = new Map<QualityMeasure, QualityStatement>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const star = !found.has('STAR_RATING') && STAR_SENTENCE.test(sentence) ? STAR_VALUE.exec(sentence)?.[1] : undefined;
      if (star) found.set('STAR_RATING', { measure: 'STAR_RATING', label: MEASURE_LABELS.STAR_RATING, value: star, quote: quoteOf(page, sentence) });
      const grade = !found.has('SAFETY_GRADE') && GRADE_SENTENCE.test(sentence) ? GRADE_VALUE.exec(sentence)?.[1] : undefined;
      if (grade) found.set('SAFETY_GRADE', { measure: 'SAFETY_GRADE', label: MEASURE_LABELS.SAFETY_GRADE, value: grade.toUpperCase(), quote: quoteOf(page, sentence) });
    }
  }
  return (['STAR_RATING', 'SAFETY_GRADE'] as const).flatMap((measure) => {
    const statement = found.get(measure);
    return statement ? [statement] : [];
  });
}

export interface QualityClaimCheck {
  readonly claim: QualityStatement;
  /** What the reporting documents state for the same measure, if any supplied one. */
  readonly reported: QualityStatement | null;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
}

/**
 * The quality ratings the deck claims against the reporting documents supplied: the same measure, the same
 * value. A rating no reporting document states is UNVERIFIED. Pactlab compares what the documents say; it
 * never assesses the quality of care.
 */
export function checkQualityClaims(pages: readonly PackRulePage[]): QualityClaimCheck[] {
  const reported = qualityStatements(qualityReportPages(pages));
  return qualityStatements(claimPages(pages)).map((claim) => {
    const match = reported.find((entry) => entry.measure === claim.measure) ?? null;
    return { claim, reported: match, status: !match ? 'UNVERIFIED' : match.value === claim.value ? 'VERIFIED' : 'CONTRADICTED' };
  });
}

/** A money amount after a word in a sentence ("a deferred maintenance backlog of USD 6,400,000"). */
export function amountAfter(sentence: string, word: RegExp): { currency: string; amount: Decimal } | null {
  const at = sentence.search(word);
  if (at < 0) return null;
  const rest = collapse(sentence.slice(at));
  const match = /\b([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)\b/.exec(rest);
  const amount = match ? dec(match[2]) : null;
  return match && amount ? { currency: match[1] ?? '', amount } : null;
}

