import { D, parseDecimal } from '../../metrics/decimal';
import { pnlPeriods } from '../../pnl/pnl';
import { fiscalYears, pnlLinesFromRecords, type KeyExpense } from '../../pnl/trend';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { documentExpiry, lastDayOfMonth } from '../fintech/payments';
import { amountAfter } from '../hospitals/operations';
import { PNL_LINE } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The hotels performance model (T-166, ADR 0068), deterministic and decimal-only: what a hotel's own evidence
 * says, read beside the deck. The trailing twelve months of the operating history (occupancy, ADR, RevPAR) and
 * the STR benchmark (the RevPAR index against the comp set) against the claims; the franchise and management
 * agreements' term against the expected closing; the brand's PIP items against the owner's capex budget; and
 * brand fees against rooms revenue across the imported P&L years. Every figure names the rows or the sentence it
 * rests on. Documents, dates and arithmetic only: never a view on the flag's worth or the market. Changing a rule
 * is a new HOTELS_PERFORMANCE_VERSION.
 */
export const HOTELS_PERFORMANCE_VERSION = 'hotels-performance-1';
export const HOTEL_OPERATING = 'hotels.operating_month';
export const HOTEL_BENCHMARK = 'hotels.benchmark_month';
export const HOTEL_AGREEMENT = 'hotels.agreement';
export const HOTEL_PIP_ITEM = 'hotels.pip_item';
export const HOTEL_CAPEX_BUDGET = 'hotels.capex_budget_line';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });

const monthsOf = (evidence: readonly PackRuleEvidence[], type: string) =>
  evidence.filter((row) => row.evidenceType === type && MONTH.test(text(row, 'month'))).sort((a, b) => text(a, 'month').localeCompare(text(b, 'month')) || a.id.localeCompare(b.id));

/** The twelve months to `end`, oldest first. */
function twelveTo(end: string): string[] {
  const [year = 0, month = 1] = end.split('-').map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 12 + index, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** The analysis date: the last day of the latest month in the operating history or the STR benchmark. */
export function hotelsAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = [...monthsOf(evidence, HOTEL_OPERATING), ...monthsOf(evidence, HOTEL_BENCHMARK)].map((row) => text(row, 'month')).sort().at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

// ------------------------------------------------------------------ documents by kind

function byDocument(pages: readonly PackRulePage[]): PackRulePage[][] {
  const grouped = new Map<string, PackRulePage[]>();
  for (const page of pages) grouped.set(page.documentId, [...(grouped.get(page.documentId) ?? []), page]);
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, own]) => [...own].sort((a, b) => a.pageNumber - b.pageNumber));
}
const headingOf = (own: readonly PackRulePage[]) => sentences(own[0]?.text ?? '')[0] ?? '';

const EXTRACTS_HEADING = /\bextracts?\b/i;
const STR_HEADING = /\bSTR\b|\bbenchmark report\b|\bcompetitive set report\b/;
const FRANCHISE_HEADING = /\bfranchise agreement\b|\blicen[cs]e agreement\b/i;
const MANAGEMENT_HEADING = /\bmanagement agreement\b|\bmanagement contract\b|\boperating agreement\b/i;
const PIP_HEADING = /\bproperty improvement plan\b|\bPIP\b/;

/** The deck, memorandum and other narrative documents: what the seller claims. Agreements and reports are never read as claims. */
export function hotelClaimPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => {
      const heading = headingOf(own);
      return ![EXTRACTS_HEADING, STR_HEADING, FRANCHISE_HEADING, MANAGEMENT_HEADING, PIP_HEADING].some((pattern) => pattern.test(heading));
    })
    .flat();
}

/** Every page of the documents whose heading names them as the franchise agreement. */
export function franchisePages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => FRANCHISE_HEADING.test(headingOf(own)))
    .flat();
}

/** Every page of the documents whose heading names them as the management (operator) agreement. */
export function managementPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => MANAGEMENT_HEADING.test(headingOf(own)) && !FRANCHISE_HEADING.test(headingOf(own)))
    .flat();
}

// ------------------------------------------------------------------ the trailing twelve months

export interface PerformanceWindow {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly roomsAvailable: Decimal;
  readonly roomsSold: Decimal;
  readonly roomRevenue: Decimal;
  /** Rooms sold ÷ rooms available. */
  readonly occupancy: Decimal | null;
  /** Room revenue ÷ rooms sold. */
  readonly adr: Decimal | null;
  /** Room revenue ÷ rooms available. */
  readonly revpar: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** The operating history over the twelve months to its latest month. */
export function operatingWindow(evidence: readonly PackRuleEvidence[]): PerformanceWindow | null {
  const rows = monthsOf(evidence, HOTEL_OPERATING);
  const latest = rows.at(-1);
  if (!latest) return null;
  const months = twelveTo(text(latest, 'month'));
  const inside = rows.filter((row) => months.includes(text(row, 'month'))).filter((row, index, all) => all.findIndex((other) => text(other, 'month') === text(row, 'month')) === index);
  const roomsAvailable = sum(inside, (row) => dec(row.canonical['rooms_available']) ?? new D(0));
  const roomsSold = sum(inside, (row) => dec(row.canonical['rooms_sold']) ?? new D(0));
  const roomRevenue = sum(inside, (row) => dec(row.canonical['room_revenue']) ?? new D(0));
  return {
    from: months[0] ?? '',
    to: months.at(-1) ?? '',
    missing: months.filter((month) => !inside.some((row) => text(row, 'month') === month)),
    roomsAvailable,
    roomsSold,
    roomRevenue,
    occupancy: ratio(roomsSold, roomsAvailable),
    adr: ratio(roomRevenue, roomsSold),
    revpar: ratio(roomRevenue, roomsAvailable),
    rows: inside,
  };
}

export interface IndexWindow {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly revpar: Decimal;
  readonly compSetRevpar: Decimal;
  /** Σ the hotel's RevPAR ÷ Σ the comp set's × 100, over the twelve months (100 = fair share). */
  readonly index: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** The STR benchmark's RevPAR index over the twelve months to its latest month. */
export function revparIndexWindow(evidence: readonly PackRuleEvidence[]): IndexWindow | null {
  const rows = monthsOf(evidence, HOTEL_BENCHMARK);
  const latest = rows.at(-1);
  if (!latest) return null;
  const months = twelveTo(text(latest, 'month'));
  const inside = rows.filter((row) => months.includes(text(row, 'month'))).filter((row, index, all) => all.findIndex((other) => text(other, 'month') === text(row, 'month')) === index);
  const revpar = sum(inside, (row) => dec(row.canonical['revpar']) ?? new D(0));
  const compSetRevpar = sum(inside, (row) => dec(row.canonical['comp_set_revpar']) ?? new D(0));
  const index = ratio(revpar, compSetRevpar);
  return { from: months[0] ?? '', to: months.at(-1) ?? '', missing: months.filter((month) => !inside.some((row) => text(row, 'month') === month)), revpar, compSetRevpar, index: index ? index.times(100) : null, rows: inside };
}

/** The weakest month's room revenue as a share of the strongest's, over the trailing twelve months (monthly seasonality). */
export function seasonality(evidence: readonly PackRuleEvidence[]): { trough: PackRuleEvidence; peak: PackRuleEvidence; share: Decimal } | null {
  const window = operatingWindow(evidence);
  if (!window || window.missing.length) return null;
  const revenue = (row: PackRuleEvidence) => dec(row.canonical['room_revenue']) ?? new D(0);
  const ranked = [...window.rows].sort((a, b) => revenue(b).comparedTo(revenue(a)) || text(a, 'month').localeCompare(text(b, 'month')));
  const peak = ranked[0];
  const trough = ranked.at(-1);
  if (!peak || !trough) return null;
  const share = ratio(revenue(trough), revenue(peak));
  return share ? { trough, peak, share } : null;
}

// ------------------------------------------------------------------ the deck's performance claims

export type PerformanceClaimKey = 'OCCUPANCY' | 'ADR' | 'REVPAR' | 'REVPAR_INDEX';
export interface PerformanceClaim {
  readonly key: PerformanceClaimKey;
  readonly label: string;
  /** Occupancy as a fraction; ADR and RevPAR in the stated currency; the index as a number (100 = fair share). */
  readonly value: Decimal;
  readonly currency: string | null;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<PerformanceClaimKey, string>> = { OCCUPANCY: 'Occupancy', ADR: 'Average daily rate', REVPAR: 'RevPAR', REVPAR_INDEX: 'RevPAR index' };
/** "a RevPAR index of 112", "RGI of 112" — never across a colon (a KPI table line). */
const INDEX = /\b(?:RevPAR index|RevPAR penetration|RGI|revenue generation index)\b[^:%]*?\b(?:of|was|at|is|reached)\s+([0-9]+(?:\.[0-9]+)?)\b(?!\s?%)/i;
const OCCUPANCY = /\boccupancy\b[^:%]*?\b(?:of|was|at|averaged|is|reached)\s+([0-9]+(?:\.[0-9]+)?)\s?%/i;
const ADR = /\b(?:ADR|average daily rate)\b[^:]*?\b(?:of|was|at|is|averaged|reached)\s+([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)/;
const REVPAR = /\bRevPAR\b(?!\s+(?:index|penetration))[^:]*?\b(?:of|was|at|is|reached)\s+([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)/;

/** The performance claims the narrative documents state, first of each. */
export function performanceClaims(pages: readonly PackRulePage[]): PerformanceClaim[] {
  const found = new Map<PerformanceClaimKey, PerformanceClaim>();
  for (const page of hotelClaimPages(pages)) {
    for (const sentence of sentences(page.text)) {
      if (!found.has('REVPAR_INDEX')) {
        const value = dec(INDEX.exec(sentence)?.[1]);
        if (value) found.set('REVPAR_INDEX', { key: 'REVPAR_INDEX', label: CLAIM_LABELS.REVPAR_INDEX, value, currency: null, quote: quoteOf(page, sentence) });
      }
      if (!found.has('OCCUPANCY')) {
        const value = dec(OCCUPANCY.exec(sentence)?.[1]);
        if (value) found.set('OCCUPANCY', { key: 'OCCUPANCY', label: CLAIM_LABELS.OCCUPANCY, value: value.div(100), currency: null, quote: quoteOf(page, sentence) });
      }
      for (const [key, pattern] of [['ADR', ADR], ['REVPAR', REVPAR]] as const) {
        if (found.has(key)) continue;
        const match = pattern.exec(sentence);
        const value = dec(match?.[2]);
        if (match && value) found.set(key, { key, label: CLAIM_LABELS[key], value, currency: match[1] ?? null, quote: quoteOf(page, sentence) });
      }
    }
  }
  return (['REVPAR_INDEX', 'OCCUPANCY', 'ADR', 'REVPAR'] as const).flatMap((key) => {
    const claim = found.get(key);
    return claim ? [claim] : [];
  });
}

/**
 * Within which a claim is verified, and beyond which it is contradicted: occupancy and the index in points
 * (a fraction of 1, and index points), ADR and RevPAR as a share of the measured figure.
 */
export const PERFORMANCE_TOLERANCE = {
  OCCUPANCY: { verified: '0.01', contradicted: '0.03' },
  REVPAR_INDEX: { verified: '1', contradicted: '3' },
  ADR: { verified: '0.01', contradicted: '0.03' },
  REVPAR: { verified: '0.01', contradicted: '0.03' },
} as const;

export interface PerformanceClaimCheck {
  readonly claim: PerformanceClaim;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'WITHIN_TOLERANCE';
  readonly measured: Decimal | null;
  /** Why it could not be measured, for an UNVERIFIED claim. */
  readonly reason: string | null;
  readonly source: 'OPERATING_HISTORY' | 'STR_BENCHMARK';
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly rows: readonly PackRuleEvidence[];
}

/** Each claim against the trailing twelve months: the operating history for occupancy, ADR and RevPAR; the STR benchmark for the index. */
export function checkPerformanceClaims(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[], currency: string | null = null): PerformanceClaimCheck[] {
  const operating = operatingWindow(evidence);
  const benchmark = revparIndexWindow(evidence);
  return performanceClaims(pages).map((claim): PerformanceClaimCheck => {
    const fromStr = claim.key === 'REVPAR_INDEX';
    const window = fromStr ? benchmark : operating;
    const source = fromStr ? 'STR_BENCHMARK' : 'OPERATING_HISTORY';
    const base = { claim, source, window: window ? { from: window.from, to: window.to } : null, rows: window?.rows ?? [] } as const;
    if (!window || window.missing.length) return { ...base, status: 'UNVERIFIED', measured: null, reason: fromStr ? 'No twelve complete months of STR benchmark are imported.' : 'No twelve complete months of operating history are imported.' };
    if (claim.currency && currency && claim.currency !== currency) return { ...base, status: 'UNVERIFIED', measured: null, reason: `The claim is in ${claim.currency}; the exports are in ${currency}. Nothing is converted.` };
    const measured = fromStr ? (window as IndexWindow).index : claim.key === 'OCCUPANCY' ? (window as PerformanceWindow).occupancy : claim.key === 'ADR' ? (window as PerformanceWindow).adr : (window as PerformanceWindow).revpar;
    if (!measured) return { ...base, status: 'UNVERIFIED', measured: null, reason: 'The exports hold no rooms or revenue to measure it.' };
    const tolerance = PERFORMANCE_TOLERANCE[claim.key];
    const gap = claim.key === 'ADR' || claim.key === 'REVPAR' ? claim.value.minus(measured).abs().div(measured) : claim.value.minus(measured).abs();
    const status = gap.lte(tolerance.verified) ? 'VERIFIED' : gap.gt(tolerance.contradicted) ? 'CONTRADICTED' : 'WITHIN_TOLERANCE';
    return { ...base, status, measured, reason: null };
  });
}

// ------------------------------------------------------------------ the franchise and management agreements

export interface HotelAgreement {
  readonly id: string;
  readonly agreementId: string;
  readonly kind: 'FRANCHISE' | 'MANAGEMENT' | 'OTHER';
  readonly counterparty: string;
  readonly effectiveOn: string | null;
  readonly expiresOn: string | null;
  readonly feeRate: Decimal | null;
  readonly otherFeeRate: Decimal | null;
  readonly terminationFee: Decimal | null;
}

export function hotelAgreements(evidence: readonly PackRuleEvidence[]): HotelAgreement[] {
  return evidence
    .filter((row) => row.evidenceType === HOTEL_AGREEMENT && text(row, 'agreement_id'))
    .map((row): HotelAgreement => {
      const kind = text(row, 'kind').toLowerCase();
      const date = (field: string) => (ISO_DATE.test(text(row, field)) ? text(row, field) : null);
      return {
        id: row.id,
        agreementId: text(row, 'agreement_id'),
        kind: /franchise|licen[cs]e|brand/.test(kind) ? 'FRANCHISE' : /management|operat/.test(kind) ? 'MANAGEMENT' : 'OTHER',
        counterparty: text(row, 'counterparty'),
        effectiveOn: date('effective_on'),
        expiresOn: date('expires_on'),
        feeRate: dec(row.canonical['fee_rate']),
        otherFeeRate: dec(row.canonical['other_fee_rate']),
        terminationFee: dec(row.canonical['termination_fee']),
      };
    })
    .sort((a, b) => a.agreementId.localeCompare(b.agreementId));
}

/** The date the remaining term is measured from: the expected closing a narrative document states, else the analysis date. */
export function measuredFrom(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { date: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; quote: PackRuleQuote | null } | null {
  const closing = expectedClosing(hotelClaimPages(pages));
  if (closing) return { date: closing.date, basis: 'EXPECTED_CLOSING', quote: closing.quote };
  const asOf = hotelsAnalysisDate(evidence);
  return asOf ? { date: asOf, basis: 'ANALYSIS_DATE', quote: null } : null;
}

/** A franchise with less than this many months of term left after the closing is a finding: re-licensing lands inside the hold. */
export const FRANCHISE_MIN_TERM_MONTHS = 60;

const PENALTY = /\b(?:liquidated damages|termination fee|termination payment|early termination)\b/i;
const TERMINATE = /\bterminat\w*\b/i;

export interface AgreementTerm {
  readonly agreement: HotelAgreement;
  readonly endsOn: string | null;
  readonly endBasis: 'DOCUMENT' | 'REGISTER' | null;
  readonly endQuote: PackRuleQuote | null;
  /** Whole months from the closing (or analysis date) to the end; negative when it ends before. */
  readonly monthsAfter: number | null;
  /** The early-termination penalty: a document sentence's amount governs, else the register's. */
  readonly penalty: { readonly amount: Decimal; readonly currency: string | null; readonly basis: 'DOCUMENT' | 'REGISTER'; readonly quote: PackRuleQuote | null } | null;
  /** The agreement's own sentences on termination (first two), quoted. */
  readonly terminationQuotes: readonly PackRuleQuote[];
}

/** Each agreement's term, its governing end date and its early-termination penalty, measured from `from`. */
export function agreementTerms(agreements: readonly HotelAgreement[], pages: readonly PackRulePage[], from: string | null): AgreementTerm[] {
  return agreements.map((agreement): AgreementTerm => {
    const own = agreement.kind === 'FRANCHISE' ? franchisePages(pages) : agreement.kind === 'MANAGEMENT' ? managementPages(pages) : [];
    const stated = documentExpiry(pages, agreement.agreementId);
    const endsOn = stated?.date ?? agreement.expiresOn;
    const monthsAfter = endsOn && from ? (endsOn < from ? -wholeMonths(endsOn, from) : wholeMonths(from, endsOn)) : null;
    let penalty: AgreementTerm['penalty'] = null;
    const terminationQuotes: PackRuleQuote[] = [];
    for (const page of own) {
      for (const sentence of sentences(page.text)) {
        if (!penalty && PENALTY.test(sentence)) {
          const amount = amountAfter(sentence, PENALTY);
          if (amount) penalty = { amount: amount.amount, currency: amount.currency, basis: 'DOCUMENT', quote: quoteOf(page, sentence) };
        }
        if (terminationQuotes.length < 2 && TERMINATE.test(sentence) && !(penalty?.quote?.quote === cap(sentence))) terminationQuotes.push(quoteOf(page, sentence));
      }
    }
    if (!penalty && agreement.terminationFee) penalty = { amount: agreement.terminationFee, currency: null, basis: 'REGISTER', quote: null };
    return { agreement, endsOn, endBasis: stated ? 'DOCUMENT' : endsOn ? 'REGISTER' : null, endQuote: stated?.quote ?? null, monthsAfter, penalty, terminationQuotes };
  });
}

const SURVIVES = /\bsurviv\w*\b|\bbinding (?:on|upon) (?:any |a |the )?(?:purchaser|buyer|successor|transferee)\b|\brun(?:s)? with the (?:hotel|property|land)\b/i;
const SALE = /\b(?:sale|sold|transfer\w*|purchaser|buyer|successor|transferee|change of ownership)\b/i;

/** Sentences in the management agreement that bind a buyer: rights or terms that survive a sale of the hotel. */
export function survivingTerms(pages: readonly PackRulePage[]): PackRuleQuote[] {
  return managementPages(pages).flatMap((page) =>
    sentences(page.text)
      .filter((sentence) => SURVIVES.test(sentence) && SALE.test(sentence))
      .map((sentence) => quoteOf(page, sentence)),
  );
}

// ------------------------------------------------------------------ the brand's PIP against the capex budget

export interface PipItem {
  readonly id: string;
  readonly itemId: string;
  readonly area: string;
  readonly description: string;
  readonly cost: Decimal;
  readonly dueOn: string;
  /** Σ the budget lines naming the item. */
  readonly budgeted: Decimal;
  readonly budgetIds: readonly string[];
  /** cost − budgeted, never below zero. */
  readonly unbudgeted: Decimal;
}

/** The PIP items, each with the budget lines that fund it, oldest due first. */
export function pipItems(evidence: readonly PackRuleEvidence[]): PipItem[] {
  const budget = evidence.filter((row) => row.evidenceType === HOTEL_CAPEX_BUDGET && text(row, 'pip_ref'));
  return evidence
    .filter((row) => row.evidenceType === HOTEL_PIP_ITEM && text(row, 'item_id') && ISO_DATE.test(text(row, 'due_on')))
    .flatMap((row): PipItem[] => {
      const cost = dec(row.canonical['estimated_cost']);
      if (!cost) return [];
      const itemId = text(row, 'item_id');
      const funding = budget.filter((line) => text(line, 'pip_ref').toLowerCase() === itemId.toLowerCase());
      const budgeted = sum(funding, (line) => dec(line.canonical['amount']) ?? new D(0));
      const gap = cost.minus(budgeted);
      return [{ id: row.id, itemId, area: text(row, 'area'), description: text(row, 'description'), cost, dueOn: text(row, 'due_on'), budgeted, budgetIds: funding.map((line) => line.id), unbudgeted: gap.gt(0) ? gap : new D(0) }];
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.itemId.localeCompare(b.itemId));
}

/** A PIP item due within this many months of the closing (or before it) with budget short of its cost is a finding. */
export const PIP_NEAR_TERM_MONTHS = 12;

/** The items due on or before `from` + PIP_NEAR_TERM_MONTHS that the budget does not fully fund. */
export function nearTermUnbudgeted(items: readonly PipItem[], from: string): PipItem[] {
  const by = addMonths(from, PIP_NEAR_TERM_MONTHS);
  return items.filter((item) => item.dueOn <= by && item.unbudgeted.gt(0));
}

function addMonths(iso: string, months: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** The first PIP total a document states (the franchise agreement's estimate, or the PIP's own total). */
export function statedPipTotal(pages: readonly PackRulePage[]): { amount: Decimal; currency: string; quote: PackRuleQuote } | null {
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      if (!/\b(?:property improvement plan|PIP)\b/.test(sentence) || !/\b(?:estimate|total)\b/i.test(sentence)) continue;
      const amount = amountAfter(sentence, /\b(?:estimate|total)\b/i);
      if (amount) return { ...amount, quote: quoteOf(page, sentence) };
    }
  }
  return null;
}

// ------------------------------------------------------------------ brand fees against rooms revenue, by year

/** A hotel's key expenses for the multi-year P&L trend: rooms labour, F&B costs, utilities and the plant's upkeep. Brand fees have their own check. */
export const HOTELS_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'rooms', label: 'Rooms department costs', pattern: /\brooms? (?:department|labou?r|expenses?|costs?)\b|\bcost of rooms\b/i },
  { key: 'fb', label: 'Food and beverage costs', pattern: /\bcost of food\b|\bfood and beverage (?:costs?|expenses?)\b|\bF&B (?:costs?|expenses?)\b/i },
  { key: 'utilities', label: 'Utilities and energy', pattern: /\butilit(?:y|ies)\b|\benergy\b/i },
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\brepairs?\b|\bmaintenance\b/i },
];

const BRAND_FEES = /\b(?:franchise|royalt(?:y|ies)|brand|loyalty programme|loyalty program|reservation(?:s)? (?:fees?|system)|marketing (?:fund|fees?|assessment))\b/i;
const ROOMS_REVENUE = /\brooms? revenue\b/i;

export interface BrandFeeYear {
  readonly year: string;
  readonly roomsRevenue: Decimal;
  readonly brandFees: Decimal;
  /** Brand fees ÷ rooms revenue. */
  readonly ratio: Decimal | null;
  readonly roomsIds: readonly string[];
  readonly feeIds: readonly string[];
}

/** Brand (franchise, royalty, marketing and reservation) fees against rooms revenue, every imported P&L year, the latest five. */
export function brandFeeYears(evidence: readonly PackRuleEvidence[]): BrandFeeYear[] {
  const { years } = fiscalYears(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))));
  return years
    .flatMap((year): BrandFeeYear[] => {
      const rooms = year.sources.filter((row) => row.kind === 'REVENUE' && ROOMS_REVENUE.test(row.account));
      const fees = year.sources.filter((row) => row.kind !== 'REVENUE' && row.kind !== 'OTHER_INCOME' && BRAND_FEES.test(row.account));
      if (rooms.length === 0) return [];
      const roomsRevenue = sum(rooms, (row) => new D(row.amount).abs());
      const brandFees = sum(fees, (row) => new D(row.amount).abs());
      return [{ year: year.period, roomsRevenue, brandFees, ratio: ratio(brandFees, roomsRevenue), roomsIds: rooms.map((row) => row.evidenceId), feeIds: fees.map((row) => row.evidenceId) }];
    })
    .slice(-5);
}

/** Brand fees ÷ rooms revenue rising every year and ending at this many times its first year or more is a finding. */
export const BRAND_FEE_OUTPACING_FACTOR = '1.15';
export const BRAND_FEE_MIN_YEARS = 3;

/** True when brand fees grow faster than rooms revenue every year, by BRAND_FEE_OUTPACING_FACTOR or more first to last. */
export function brandFeesOutpacing(years: readonly BrandFeeYear[]): boolean {
  if (years.length < BRAND_FEE_MIN_YEARS || years.some((year) => !year.ratio || year.brandFees.isZero())) return false;
  const consecutive = years.every((year, index) => index === 0 || Number(year.year) === Number(years[index - 1]?.year) + 1);
  const series = years.map((year) => year.ratio as Decimal);
  const first = series[0] as Decimal;
  return consecutive && series.every((value, index) => index === 0 || value.gt(series[index - 1] as Decimal)) && (series.at(-1) as Decimal).gte(first.times(BRAND_FEE_OUTPACING_FACTOR));
}
