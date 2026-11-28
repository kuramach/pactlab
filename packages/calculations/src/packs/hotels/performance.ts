import { D, parseDecimal } from '../../metrics/decimal';
import { pnlPeriods } from '../../pnl/pnl';
import { fiscalYears, pnlLinesFromRecords, type KeyExpense } from '../../pnl/trend';
import { wholeMonths } from '../clinics/practice';
import { moneyIn } from '../common';
import { BUILDING_ELEMENTS, CAPEX_BUDGET_SHARE, capexSchedule, type CapexItem } from '../commercial-property/leases';
import { dateIn, lastDayOfMonth } from '../fintech/payments';
import { holdWindow, type HoldWindow } from '../pharma/pipeline';
import { PNL_LINE } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The hotels performance model (T-166, ADR 0069), deterministic and decimal-only: what a hotel's flag and its
 * comp-set performance rest on. The franchise agreement's term, termination rights and fees against the hold;
 * the brand's property improvement plan, item by item, against the seller's capex schedule; the deck's RevPAR,
 * ADR, occupancy and comp-set index claims against the STR benchmark and the operating history; the management
 * agreement's term, fees and what binds a purchaser; and the franchise and brand fees against rooms revenue
 * across the imported P&L years. Every figure names the rows or the sentence it rests on. Documents, dates and
 * arithmetic only: it never opines on the flag's worth. Changing a rule is a new HOTELS_PERFORMANCE_VERSION.
 */
export const HOTELS_PERFORMANCE_VERSION = 'hotels-performance-1';
export const HOTEL_OPERATING = 'hotels.operating_month';
export const HOTEL_BENCHMARK = 'hotels.benchmark_month';

type Decimal = InstanceType<typeof D>;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });

// ------------------------------------------------------------------ the exports

/** Rows of a hotelMonths export, one per month (the first of a duplicated month), oldest first. */
export function hotelMonths(evidence: readonly PackRuleEvidence[], type: string): PackRuleEvidence[] {
  return evidence
    .filter((row) => row.evidenceType === type && MONTH.test(text(row, 'month')))
    .sort((a, b) => text(a, 'month').localeCompare(text(b, 'month')) || a.id.localeCompare(b.id))
    .filter((row, index, all) => all.findIndex((other) => text(other, 'month') === text(row, 'month')) === index);
}

/** The latest twelve months of a hotelMonths export, when all twelve consecutive months are there. */
export function hotelTrailingYear(rows: readonly PackRuleEvidence[]): PackRuleEvidence[] | null {
  const last = rows.slice(-12);
  if (last.length < 12) return null;
  const first = text(last[0] as PackRuleEvidence, 'month');
  const end = text(last.at(-1) as PackRuleEvidence, 'month');
  return wholeMonths(`${first}-01`, `${end}-01`) === 11 ? last : null;
}

export interface HotelOperatingYear {
  /** e.g. "October 2025 to September 2026". */
  readonly from: string;
  readonly to: string;
  readonly roomsAvailable: Decimal;
  readonly roomsSold: Decimal;
  readonly roomRevenue: Decimal;
  readonly grossOperatingRevenue: Decimal;
  readonly grossOperatingProfit: Decimal | null;
  readonly occupancy: Decimal | null;
  readonly adr: Decimal | null;
  readonly revpar: Decimal | null;
  readonly gopMargin: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/** The hotel's own trailing twelve months from the operating history (the property-management system). */
export function operatingYear(evidence: readonly PackRuleEvidence[]): HotelOperatingYear | null {
  const year = hotelTrailingYear(hotelMonths(evidence, HOTEL_OPERATING));
  if (!year) return null;
  const field = (name: string) => sum(year, (row) => dec(row.canonical[name]) ?? new D(0));
  const roomsAvailable = field('rooms_available');
  const roomsSold = field('rooms_sold');
  const roomRevenue = field('room_revenue');
  const grossOperatingRevenue = roomRevenue.plus(field('fb_revenue'));
  const gop = year.every((row) => dec(row.canonical['gross_operating_profit']) !== null) ? field('gross_operating_profit') : null;
  return {
    from: text(year[0] as PackRuleEvidence, 'month'),
    to: text(year.at(-1) as PackRuleEvidence, 'month'),
    roomsAvailable,
    roomsSold,
    roomRevenue,
    grossOperatingRevenue,
    grossOperatingProfit: gop,
    occupancy: ratio(roomsSold, roomsAvailable),
    adr: ratio(roomRevenue, roomsSold),
    revpar: ratio(roomRevenue, roomsAvailable),
    gopMargin: gop ? ratio(gop, grossOperatingRevenue) : null,
    evidenceIds: year.map((row) => row.id),
  };
}

export interface BenchmarkYear {
  readonly from: string;
  readonly to: string;
  /** Σ the hotel's RevPAR ÷ Σ the competitive set's, × 100 (the RevPAR index, or RGI). */
  readonly revparIndex: Decimal | null;
  /** Σ the hotel's occupancy ÷ Σ the competitive set's, × 100 (MPI), when every month carries the comp set's occupancy. */
  readonly occupancyIndex: Decimal | null;
  /** Σ the hotel's ADR ÷ Σ the competitive set's, × 100 (ARI), when every month carries the comp set's ADR. */
  readonly adrIndex: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/** The trailing twelve months of the STR benchmark against the competitive set. */
export function benchmarkYear(evidence: readonly PackRuleEvidence[]): BenchmarkYear | null {
  const year = hotelTrailingYear(hotelMonths(evidence, HOTEL_BENCHMARK));
  if (!year) return null;
  const index = (own: string, comp: string) => {
    if (!year.every((row) => dec(row.canonical[comp])?.gt(0))) return null;
    const value = ratio(sum(year, (row) => dec(row.canonical[own]) ?? new D(0)), sum(year, (row) => dec(row.canonical[comp]) ?? new D(0)));
    return value ? value.times(100) : null;
  };
  return {
    from: text(year[0] as PackRuleEvidence, 'month'),
    to: text(year.at(-1) as PackRuleEvidence, 'month'),
    revparIndex: index('revpar', 'comp_set_revpar'),
    occupancyIndex: index('occupancy', 'comp_set_occupancy'),
    adrIndex: index('adr', 'comp_set_adr'),
    evidenceIds: year.map((row) => row.id),
  };
}

/** The analysis date: the last day of the latest month in the operating history or the STR benchmark. */
export function hotelsAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = [...hotelMonths(evidence, HOTEL_OPERATING), ...hotelMonths(evidence, HOTEL_BENCHMARK)].map((row) => text(row, 'month')).sort().at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

/** The hold after closing: the expected closing a document states (else the analysis date), for the hold a document states (else five years). */
export const hotelsHoldWindow = (evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): HoldWindow | null => holdWindow(evidence, pages);

// ------------------------------------------------------------------ documents by kind

function byDocument(pages: readonly PackRulePage[]): PackRulePage[][] {
  const grouped = new Map<string, PackRulePage[]>();
  for (const page of pages) grouped.set(page.documentId, [...(grouped.get(page.documentId) ?? []), page]);
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, own]) => [...own].sort((a, b) => a.pageNumber - b.pageNumber));
}
const headingOf = (own: readonly PackRulePage[]) => sentences(own[0]?.text ?? '')[0] ?? '';
const all = (own: readonly PackRulePage[]) => own.flatMap((page) => sentences(page.text).map((sentence) => ({ page, sentence })));

const EXTRACTS_HEADING = /\bextracts?\b/i;
const FRANCHISE_HEADING = /\b(?:franchise|licen[cs]e|brand) agreement\b/i;
const PIP_HEADING = /\bproperty improvement plan\b/i;
const MANAGEMENT_HEADING = /\b(?:hotel )?management (?:agreement|contract)\b|\boperator agreement\b/i;
const STR_HEADING = /\bSTR\b|\bbenchmark(?:ing)? report\b|\bperformance report\b/;

const kind = (heading: string) =>
  EXTRACTS_HEADING.test(heading) ? 'EXTRACTS' : PIP_HEADING.test(heading) ? 'PIP' : FRANCHISE_HEADING.test(heading) ? 'FRANCHISE' : MANAGEMENT_HEADING.test(heading) ? 'MANAGEMENT' : STR_HEADING.test(heading) ? 'STR' : 'NARRATIVE';

/** The deck, memorandum and other narrative documents: what the seller claims. Agreements, the PIP, STR reports and the extracts never are. */
export function hotelClaimPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => kind(headingOf(own)) === 'NARRATIVE')
    .flat();
}

const TERM_FROM = /\bterm runs from\b/i;
const TERM_END = /\b(?:term|agreement) (?:ends|expires|terminates) on\b|\bexpires on\b/i;
const MAY_TERMINATE = /\bmay terminate\b/i;
const PENALTY = /\bliquidated damages\b|\btermination (?:fee|payment|penalty)\b/i;
const FEE_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'Royalty fee', pattern: /\broyalty (?:fee )?(?:of|equal to|is)\s+([0-9]+(?:\.[0-9]+)?)\s?%/i },
  { label: 'Marketing or brand fund fee', pattern: /\b(?:marketing|brand fund|program(?:me)?) (?:fee|contribution)\b[^%]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i },
  { label: 'Reservation fee', pattern: /\breservation (?:fee|system fee)\b[^%]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i },
  { label: 'Loyalty programme fee', pattern: /\bloyalty (?:programme |program )?(?:fee|assessment|contribution)\b[^%]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i },
];

export interface HotelStatedFee {
  readonly label: string;
  /** A fraction of the base the sentence names (usually gross rooms revenue). */
  readonly rate: Decimal;
  readonly quote: PackRuleQuote;
}

export interface HotelTerm {
  readonly start: string | null;
  readonly end: string | null;
  readonly quote: PackRuleQuote | null;
}

function hotelTermOf(entries: readonly { page: PackRulePage; sentence: string }[]): HotelTerm {
  const from = entries.find((entry) => TERM_FROM.test(entry.sentence));
  if (from) {
    const after = from.sentence.slice(from.sentence.search(TERM_FROM));
    const toAt = after.search(/\b(?:to|until|through)\b/i);
    return { start: dateIn(after), end: toAt >= 0 ? dateIn(after.slice(toAt)) : null, quote: quoteOf(from.page, from.sentence) };
  }
  const ends = entries.find((entry) => TERM_END.test(entry.sentence));
  return ends ? { start: null, end: dateIn(ends.sentence.slice(ends.sentence.search(TERM_END))), quote: quoteOf(ends.page, ends.sentence) } : { start: null, end: null, quote: null };
}

export interface FranchiseReading {
  readonly documentId: string;
  readonly heading: PackRuleQuote;
  readonly term: HotelTerm;
  /** Rights to terminate the agreement, as the sentences state them (termination windows). */
  readonly terminationRights: readonly PackRuleQuote[];
  /** The liquidated damages or termination payment, as stated. */
  readonly penalty: { readonly quote: PackRuleQuote; readonly amount: { readonly currency: string; readonly amount: Decimal } | null } | null;
  readonly fees: readonly HotelStatedFee[];
}

/** The first franchise, licence or brand agreement on file, read sentence by sentence. */
export function franchiseReading(pages: readonly PackRulePage[]): FranchiseReading | null {
  const own = byDocument(pages).find((document) => kind(headingOf(document)) === 'FRANCHISE');
  const first = own?.[0];
  if (!own || !first) return null;
  const entries = all(own);
  const penalty = entries.find((entry) => PENALTY.test(entry.sentence)) ?? null;
  return {
    documentId: first.documentId,
    heading: quoteOf(first, headingOf(own)),
    term: hotelTermOf(entries),
    terminationRights: entries.filter((entry) => MAY_TERMINATE.test(entry.sentence)).slice(0, 4).map((entry) => quoteOf(entry.page, entry.sentence)),
    penalty: penalty ? { quote: quoteOf(penalty.page, penalty.sentence), amount: moneyIn(penalty.sentence) } : null,
    fees: FEE_PATTERNS.flatMap(({ label, pattern }) => {
      const hit = entries.find((entry) => pattern.test(entry.sentence));
      const rate = hit ? dec(pattern.exec(hit.sentence)?.[1]) : null;
      return hit && rate ? [{ label, rate: rate.div(100), quote: quoteOf(hit.page, hit.sentence) }] : [];
    }),
  };
}

export interface FranchiseTermCheck {
  readonly reading: FranchiseReading;
  readonly hold: HoldWindow;
  /** 0 = before the closing; 1..n = the hold year the term ends in; n + 1 = after the hold. */
  readonly holdYear: number;
  /** Whole months from the hold's start (the closing) to the term's end; null when it ends before. */
  readonly monthsAfterClosing: number | null;
}

/** The franchise term's end measured against the hold window; null without a franchise agreement that states its end. */
export function franchiseTermCheck(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): FranchiseTermCheck | null {
  const reading = franchiseReading(pages);
  const hold = hotelsHoldWindow(evidence, pages);
  const end = reading?.term.end;
  if (!reading || !hold || !end) return null;
  if (end < hold.from) return { reading, hold, holdYear: 0, monthsAfterClosing: null };
  // A term ending on an anniversary of the closing ends in the year that anniversary closes (31 December 2029 is
  // year 3 of a hold from 31 December 2026); a day past it is the next year.
  const months = wholeMonths(hold.from, end);
  const started = months + (end > hotelAddMonths(hold.from, months) ? 1 : 0);
  const holdYear = Math.min(hold.years + 1, Math.max(1, Math.ceil(started / 12)));
  return { reading, hold, holdYear, monthsAfterClosing: months };
}

/** `date` plus whole months, clamped to the month's last day. */
export function hotelAddMonths(date: string, months: number): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // A month-end date stays a month end (30 June + 6 months is 31 December).
  const day = d === new Date(Date.UTC(y, m, 0)).getUTCDate() ? last : Math.min(d, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ the property improvement plan

/** Hotel elements a PIP item or a capex line names, before the building elements commercial property reads. */
export const HOTEL_ELEMENTS: readonly { readonly key: string; readonly label: string; readonly pattern: RegExp }[] = [
  { key: 'bathrooms', label: 'Guest bathrooms', pattern: /\bbath(?:room)?s?\b|\bshowers?\b/i },
  { key: 'guestrooms', label: 'Guest rooms', pattern: /\bguest ?rooms?\b|\bsoft goods\b|\bcase goods\b|\bbedding\b/i },
  { key: 'public_areas', label: 'Lobby and public areas', pattern: /\blobby\b|\bpublic areas?\b|\bcorridors?\b|\bmeeting rooms?\b/i },
  { key: 'restaurant', label: 'Restaurant and bar', pattern: /\brestaurant\b|\bbar\b|\bfood and beverage\b/i },
  { key: 'fitness', label: 'Fitness centre', pattern: /\bfitness\b|\bgym\b/i },
  { key: 'pool', label: 'Pool', pattern: /\bpool\b/i },
  { key: 'signage', label: 'Brand signage', pattern: /\bsignage\b|\bsigns?\b/i },
  ...BUILDING_ELEMENTS,
];
const elementOf = (words: string) => HOTEL_ELEMENTS.find((element) => element.pattern.test(words)) ?? null;

const PIP_ITEM = /^(?:PIP )?item\s+(\d+)\s*[:.-]\s*(.+?)(?:,\s*|\s+)(?:to be completed|must be completed|due|completed)\b/i;
const DUE = /\b(?:completed|due) (?:by|on)\b/i;
const ESTIMATE = /\bestimated (?:at|cost)\b|\bat an estimated cost of\b|\bat a cost of\b/i;

export interface PipItem {
  readonly number: string;
  readonly description: string;
  readonly element: { readonly key: string; readonly label: string } | null;
  readonly due: string;
  readonly currency: string;
  readonly amount: Decimal;
  readonly quote: PackRuleQuote;
}

/** The items a property improvement plan states, each with its completion date and estimated cost. */
export function pipItems(pages: readonly PackRulePage[]): PipItem[] {
  const found: PipItem[] = [];
  for (const own of byDocument(pages)) {
    if (kind(headingOf(own)) !== 'PIP') continue;
    for (const { page, sentence } of all(own)) {
      const item = PIP_ITEM.exec(sentence);
      const dueAt = sentence.search(DUE);
      const due = dueAt >= 0 ? dateIn(sentence.slice(dueAt)) : null;
      const estimateAt = sentence.search(ESTIMATE);
      const money = estimateAt >= 0 ? moneyIn(sentence.slice(estimateAt)) : null;
      if (!item || !due || !money || found.some((entry) => entry.number === item[1])) continue;
      const description = (item[2] ?? '').trim();
      const element = elementOf(description);
      found.push({ number: item[1] ?? '', description, element: element ? { key: element.key, label: element.label } : null, due, currency: money.currency, amount: money.amount, quote: quoteOf(page, sentence) });
    }
  }
  return found.sort((a, b) => a.due.localeCompare(b.due) || Number(a.number) - Number(b.number));
}

export interface PipCheck {
  readonly item: PipItem;
  readonly scheduled: readonly CapexItem[];
  readonly scheduledAmount: Decimal;
  readonly state: 'UNBUDGETED' | 'UNDER_BUDGETED' | 'BUDGETED';
  /** What the schedule does not fund: the estimate, or the estimate less what is scheduled. */
  readonly shortfall: Decimal;
}

/** A capex line funds a PIP item when it names the item ("PIP item 2"), or its element, by category or by its words. */
function funds(line: CapexItem, item: PipItem): boolean {
  if (new RegExp(`\\bPIP item ${item.number}\\b`, 'i').test(line.item)) return true;
  if (!item.element) return false;
  return line.category === item.element.key || elementOf(line.item)?.key === item.element.key;
}

/** Each PIP item against the seller's capex schedule. */
export function pipChecks(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): PipCheck[] {
  const schedule = capexSchedule(evidence);
  return pipItems(pages).map((item): PipCheck => {
    const scheduled = schedule.filter((line) => funds(line, item));
    const scheduledAmount = sum(scheduled, (line) => line.amount);
    const state = scheduled.length === 0 ? 'UNBUDGETED' : scheduledAmount.lt(item.amount.times(CAPEX_BUDGET_SHARE)) ? 'UNDER_BUDGETED' : 'BUDGETED';
    return { item, scheduled, scheduledAmount, state, shortfall: state === 'BUDGETED' ? new D(0) : item.amount.minus(scheduledAmount) };
  });
}

/** A PIP item due within this many months of the closing (or before it) is near-term. */
export const PIP_NEAR_TERM_MONTHS = 12;

// ------------------------------------------------------------------ the management agreement

const BASE_FEE = /\bbase (?:management )?fee\b[^%]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i;
const INCENTIVE_FEE = /\bincentive (?:management )?fee\b[^%]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i;
const SURVIVES =
  /\bruns with the (?:hotel|property)\b|\bbinds? (?:any|a|the) (?:purchaser|buyer|successor|transferee)\b|\bsurvives? (?:a|any|the) sale\b|\bnot (?:be )?terminat\w* (?:on|upon|by reason of) (?:a |the )?sale\b|\bassign\w* (?:it |this agreement )?to (?:any|the) purchaser\b/i;
/** The owner's right: "may terminate on sale", never a clause heading such as "Termination on sale." */
const ON_SALE = /\bmay terminate\b.*\b(?:on|upon) (?:the )?sale\b/i;
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const MULTIPLE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+(?:\.[0-9]+)?)\s*(?:times|×|x)\s+the prior year.s base (?:management )?fee\b/i;

export interface ManagementReading {
  readonly documentId: string;
  readonly heading: PackRuleQuote;
  readonly term: HotelTerm;
  readonly baseFee: { readonly rate: Decimal; readonly quote: PackRuleQuote } | null;
  readonly incentiveFee: { readonly rate: Decimal; readonly quote: PackRuleQuote } | null;
  /** The sentence that makes the agreement bind a purchaser of the hotel. */
  readonly survives: PackRuleQuote | null;
  /** The owner's right to terminate on a sale, and the multiple of the prior year's base fee it costs when stated. */
  readonly terminationOnSale: { readonly quote: PackRuleQuote; readonly multiple: Decimal | null } | null;
}

/** The first hotel management agreement on file, read sentence by sentence. */
export function managementReading(pages: readonly PackRulePage[]): ManagementReading | null {
  const own = byDocument(pages).find((document) => kind(headingOf(document)) === 'MANAGEMENT');
  const first = own?.[0];
  if (!own || !first) return null;
  const entries = all(own);
  const rate = (pattern: RegExp) => {
    const hit = entries.find((entry) => pattern.test(entry.sentence));
    const value = hit ? dec(pattern.exec(hit.sentence)?.[1]) : null;
    return hit && value ? { rate: value.div(100), quote: quoteOf(hit.page, hit.sentence) } : null;
  };
  const survives = entries.find((entry) => SURVIVES.test(entry.sentence)) ?? null;
  const onSale = entries.find((entry) => ON_SALE.test(entry.sentence)) ?? null;
  const multipleWord = onSale ? MULTIPLE.exec(onSale.sentence)?.[1]?.toLowerCase() : undefined;
  const multiple = multipleWord ? (NUMBER_WORDS[multipleWord] !== undefined ? new D(NUMBER_WORDS[multipleWord] as number) : dec(multipleWord)) : null;
  return {
    documentId: first.documentId,
    heading: quoteOf(first, headingOf(own)),
    term: hotelTermOf(entries),
    baseFee: rate(BASE_FEE),
    incentiveFee: rate(INCENTIVE_FEE),
    survives: survives ? quoteOf(survives.page, survives.sentence) : null,
    terminationOnSale: onSale ? { quote: quoteOf(onSale.page, onSale.sentence), multiple } : null,
  };
}

// ------------------------------------------------------------------ the performance claims register

export type PerformanceClaimKey = 'OCCUPANCY' | 'ADR' | 'REVPAR' | 'REVPAR_INDEX' | 'OCCUPANCY_INDEX' | 'ADR_INDEX';
export interface PerformanceClaim {
  readonly key: PerformanceClaimKey;
  readonly label: string;
  /** A fraction for occupancy, index points for an index, money otherwise. */
  readonly value: Decimal;
  readonly currency: string | null;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<PerformanceClaimKey, string>> = {
  OCCUPANCY: 'Occupancy',
  ADR: 'Average daily rate (ADR)',
  REVPAR: 'RevPAR',
  REVPAR_INDEX: 'RevPAR index against the competitive set',
  OCCUPANCY_INDEX: 'Occupancy index (MPI) against the competitive set',
  ADR_INDEX: 'ADR index (ARI) against the competitive set',
};
const VERB = String.raw`\b(?:of|was|at|averaged|is|reached|stood at)\s+`;
/** Never across a colon (a KPI table line). */
const CLAIM_PATTERNS: readonly [PerformanceClaimKey, RegExp][] = [
  ['REVPAR_INDEX', new RegExp(String.raw`\b(?:RevPAR index|RGI)\b[^:%]*?${VERB}([0-9]+(?:\.[0-9]+)?)\b(?!\s?%)`, 'i')],
  ['OCCUPANCY_INDEX', new RegExp(String.raw`\b(?:occupancy index|MPI)\b[^:%]*?${VERB}([0-9]+(?:\.[0-9]+)?)\b(?!\s?%)`, 'i')],
  ['ADR_INDEX', new RegExp(String.raw`\b(?:ADR index|ARI)\b[^:%]*?${VERB}([0-9]+(?:\.[0-9]+)?)\b(?!\s?%)`, 'i')],
  ['OCCUPANCY', new RegExp(String.raw`\boccupancy\b(?!\s+index)[^:%]*?${VERB}([0-9]+(?:\.[0-9]+)?)\s?%`, 'i')],
  ['ADR', new RegExp(String.raw`\b(?:ADR|average daily rate)\b(?!\s+index)[^:]*?${VERB}([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)`, 'i')],
  ['REVPAR', new RegExp(String.raw`\bRevPAR\b(?!\s+index)[^:]*?${VERB}([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)`, 'i')],
];
const ORDER: readonly PerformanceClaimKey[] = ['REVPAR_INDEX', 'OCCUPANCY_INDEX', 'ADR_INDEX', 'OCCUPANCY', 'ADR', 'REVPAR'];

/** The performance claims the narrative documents state, the first of each. */
export function performanceClaims(pages: readonly PackRulePage[]): PerformanceClaim[] {
  const found = new Map<PerformanceClaimKey, PerformanceClaim>();
  for (const page of hotelClaimPages(pages)) {
    for (const sentence of sentences(page.text)) {
      for (const [key, pattern] of CLAIM_PATTERNS) {
        if (found.has(key)) continue;
        const match = pattern.exec(sentence);
        if (!match) continue;
        const money = key === 'ADR' || key === 'REVPAR';
        const value = dec(money ? match[2] : match[1]);
        if (!value) continue;
        found.set(key, { key, label: CLAIM_LABELS[key], value: key === 'OCCUPANCY' ? value.div(100) : value, currency: money ? (match[1] ?? '').toUpperCase() : null, quote: quoteOf(page, sentence) });
      }
    }
  }
  return ORDER.flatMap((key) => {
    const claim = found.get(key);
    return claim ? [claim] : [];
  });
}

/** Within `verified` a claim holds; beyond `contradicted` it fails: points for occupancy, index points, a share for money. */
export const PERFORMANCE_TOLERANCE = {
  OCCUPANCY: { verified: '0.01', contradicted: '0.03' },
  INDEX: { verified: '1', contradicted: '3' },
  MONEY: { verified: '0.02', contradicted: '0.05' },
} as const;

export interface PerformanceClaimCheck {
  readonly claim: PerformanceClaim;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'WITHIN_TOLERANCE';
  readonly measured: Decimal | null;
  /** 'STR' for the indices, 'OPERATING' for the hotel's own figures. */
  readonly source: 'STR' | 'OPERATING';
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly evidenceIds: readonly string[];
  /** Why a claim could not be checked, when it could not. */
  readonly gap: string | null;
}

/** Each claim against the trailing twelve months of the STR benchmark (the indices) or the operating history (the hotel's own figures). */
export function checkPerformanceClaims(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): PerformanceClaimCheck[] {
  const operating = operatingYear(evidence);
  const benchmark = benchmarkYear(evidence);
  return performanceClaims(pages).map((claim): PerformanceClaimCheck => {
    const isIndex = claim.key.endsWith('INDEX');
    const source = isIndex ? 'STR' : 'OPERATING';
    const year = isIndex ? benchmark : operating;
    const measured = !year
      ? null
      : claim.key === 'REVPAR_INDEX'
        ? (benchmark?.revparIndex ?? null)
        : claim.key === 'OCCUPANCY_INDEX'
          ? (benchmark?.occupancyIndex ?? null)
          : claim.key === 'ADR_INDEX'
            ? (benchmark?.adrIndex ?? null)
            : claim.key === 'OCCUPANCY'
              ? (operating?.occupancy ?? null)
              : claim.key === 'ADR'
                ? (operating?.adr ?? null)
                : (operating?.revpar ?? null);
    const period = year ? { from: year.from, to: year.to } : null;
    const evidenceIds = year?.evidenceIds ?? [];
    if (!measured) {
      const gap = !year
        ? isIndex
          ? 'No twelve consecutive months of the STR benchmark are imported.'
          : 'No twelve consecutive months of the operating history are imported.'
        : 'The STR benchmark does not carry the competitive set’s figure for every month.';
      return { claim, status: 'UNVERIFIED', measured: null, source, period, evidenceIds, gap };
    }
    const tolerance = claim.key === 'OCCUPANCY' ? PERFORMANCE_TOLERANCE.OCCUPANCY : isIndex ? PERFORMANCE_TOLERANCE.INDEX : PERFORMANCE_TOLERANCE.MONEY;
    const gap = isIndex || claim.key === 'OCCUPANCY' ? claim.value.minus(measured).abs() : claim.value.minus(measured).abs().div(measured);
    const status = gap.lte(tolerance.verified) ? 'VERIFIED' : gap.gt(tolerance.contradicted) ? 'CONTRADICTED' : 'WITHIN_TOLERANCE';
    return { claim, status, measured, source, period, evidenceIds, gap: null };
  });
}

// ------------------------------------------------------------------ franchise and brand fees across the P&L years

const ROOMS_LINE = /\brooms?\b/i;
const BRAND_FEE_LINE = /\bfranchise\b|\broyalt(?:y|ies)\b|\bbrand\b|\bmarketing (?:fund|fee|contribution)\b|\breservation\b|\bloyalty\b/i;

export interface FeeYear {
  readonly year: string;
  readonly roomsRevenue: Decimal;
  readonly brandFees: Decimal;
  /** Franchise and brand fees ÷ rooms revenue. */
  readonly share: Decimal;
  readonly evidenceIds: readonly string[];
}

/** Each fiscal year of the imported P&L: rooms revenue and the franchise and brand fee lines, oldest first. */
export function hotelFeeYears(evidence: readonly PackRuleEvidence[]): FeeYear[] {
  const { years } = fiscalYears(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))));
  return years.flatMap((year): FeeYear[] => {
    const rooms = year.sources.filter((row) => row.kind === 'REVENUE' && ROOMS_LINE.test(row.account));
    const fees = year.sources.filter((row) => row.kind !== 'REVENUE' && row.kind !== 'OTHER_INCOME' && BRAND_FEE_LINE.test(row.account));
    const roomsRevenue = sum(rooms, (row) => new D(row.amount).abs());
    const brandFees = sum(fees, (row) => new D(row.amount).abs());
    if (rooms.length === 0 || fees.length === 0 || !roomsRevenue.gt(0)) return [];
    return [{ year: year.period, roomsRevenue, brandFees, share: brandFees.div(roomsRevenue), evidenceIds: [...rooms, ...fees].map((row) => row.evidenceId) }];
  });
}

/** Fees ÷ rooms revenue rising every year to this multiple of its first year or more is a finding. */
export const BRAND_FEE_TREND_FACTOR = '1.1';
/** Fewest consecutive years the brand-fee trend needs. */
export const BRAND_FEE_TREND_MIN_YEARS = 3;

/** The latest run of consecutive fiscal years. */
export function hotelYearRun<T extends { readonly year: string }>(years: readonly T[]): T[] {
  const run: T[] = [];
  for (const year of [...years].reverse()) {
    const next = run[0];
    if (next && Number(next.year) !== Number(year.year) + 1) break;
    run.unshift(year);
  }
  return run;
}

/** The hotel's occupancy and ADR by calendar year from the operating history (all twelve months of the year). */
export function operatingByYear(evidence: readonly PackRuleEvidence[]): { year: string; occupancy: Decimal | null; adr: Decimal | null; roomRevenue: Decimal }[] {
  const rows = hotelMonths(evidence, HOTEL_OPERATING);
  return [...new Set(rows.map((row) => text(row, 'month').slice(0, 4)))].sort().flatMap((year) => {
    const own = rows.filter((row) => text(row, 'month').startsWith(`${year}-`));
    if (own.length < 12) return [];
    const field = (name: string) => sum(own, (row) => dec(row.canonical[name]) ?? new D(0));
    return [{ year, occupancy: ratio(field('rooms_sold'), field('rooms_available')), adr: ratio(field('room_revenue'), field('rooms_sold')), roomRevenue: field('room_revenue') }];
  });
}

// ------------------------------------------------------------------ seasonality from hotelMonths statements

export interface StatementSeasonality {
  readonly from: string;
  readonly to: string;
  /** The two strongest months' rooms revenue, averaged, ÷ the weakest month's. */
  readonly ratio: Decimal;
  readonly peak: readonly string[];
  readonly trough: string;
  readonly evidenceIds: readonly string[];
}

/** Seasonality from the P&L by month (rooms revenue), over the latest twelve consecutive hotelMonths periods; null without them. */
export function statementSeasonality(evidence: readonly PackRuleEvidence[]): StatementSeasonality | null {
  const months = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)))
    .filter((period) => period.granularity === 'MONTH')
    .map((period) => ({ month: period.period, rows: period.sources.filter((row) => row.kind === 'REVENUE' && ROOMS_LINE.test(row.account)) }))
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
  const first = months[0];
  const last = months.at(-1);
  if (months.length < 12 || !first || !last || wholeMonths(`${first.month}-01`, `${last.month}-01`) !== 11) return null;
  const revenue = (entry: (typeof months)[number]) => sum(entry.rows, (row) => new D(row.amount).abs());
  const ranked = [...months].sort((a, b) => revenue(b).comparedTo(revenue(a)));
  const trough = ranked.at(-1) as (typeof months)[number];
  if (!revenue(trough).gt(0)) return null;
  const peak = ranked.slice(0, 2);
  return {
    from: first.month,
    to: last.month,
    ratio: sum(peak, revenue).div(2).div(revenue(trough)),
    peak: peak.map((entry) => entry.month).sort(),
    trough: trough.month,
    evidenceIds: months.flatMap((entry) => entry.rows.map((row) => row.evidenceId)),
  };
}

/** A hotel's key expenses for the shared multi-year P&L trend. Franchise and brand fees are read against rooms revenue by their own rule. */
export const HOTELS_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'rooms', label: 'Rooms department expenses', pattern: /\brooms? (?:department|division) (?:expenses?|costs?)\b|\brooms expenses?\b/i },
  { key: 'food', label: 'Food and beverage costs', pattern: /\bfood and beverage (?:costs?|expenses?)\b|\bF&B (?:costs?|expenses?)\b/i },
  { key: 'utilities', label: 'Utilities and energy', pattern: /\butilit(?:y|ies)\b|\benergy\b/i },
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\brepairs?\b|\bmaintenance\b/i },
];

