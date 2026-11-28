import { D, parseDecimal } from '../../metrics/decimal';
import { pnlLinesFromRecords, fiscalYears, type KeyExpense } from '../../pnl/trend';
import { pnlPeriods } from '../../pnl/pnl';
import { moneyIn } from '../common';
import { dateIn } from '../fintech/payments';
import { holdWindow, pharmaAnalysisDate, type HoldWindow } from '../pharma/pipeline';
import { PNL_LINE } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The commercial property lease model (T-165, ADR 0068), deterministic and decimal-only: the rent roll read
 * against the leases, recoveries against what the leases make recoverable, the landlord's obligations, the
 * expiry profile over the hold and the condition reports against the seller's capex schedule. Every figure
 * names the rows or the sentence it rests on. Documents and arithmetic only: it never values the property.
 * Changing a rule is a new CRE_LEASES_VERSION.
 */
export const CRE_LEASES_VERSION = 'cre-leases-2';
export const LEASE = 'cre.lease';
export const CAM = 'cre.cam_category';
export const CAPEX_ITEM = 'cre.capex_item';

type Decimal = InstanceType<typeof D>;
const YEAR = /^\d{4}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const cents = (value: Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
/** A tenant's name without its "(synthetic)" marker, lower-cased, for matching a heading. */
export const tenantKey = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/** The analysis date: the last day of the latest billed month (as the T-066 rules read it). */
export const creAnalysisDate = pharmaAnalysisDate;

/** The hold after closing: the expected closing a document states (else the analysis date), for the hold a document states (else five years). */
export const creHoldWindow = (evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): HoldWindow | null => holdWindow(evidence, pages);

// ------------------------------------------------------------------ the rent roll

export interface RollLease {
  readonly row: PackRuleEvidence;
  readonly tenant: string;
  readonly suite: string;
  readonly sqft: Decimal | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly monthlyRent: Decimal;
}

/** The rent roll as imported, one entry per suite, largest rent first. */
export function rentRoll(evidence: readonly PackRuleEvidence[]): RollLease[] {
  return evidence
    .filter((row) => row.evidenceType === LEASE && text(row, 'tenant'))
    .map((row) => ({
      row,
      tenant: text(row, 'tenant'),
      suite: text(row, 'suite'),
      sqft: dec(row.canonical['sqft']),
      start: ISO.test(text(row, 'lease_start')) ? text(row, 'lease_start') : null,
      end: ISO.test(text(row, 'lease_end')) ? text(row, 'lease_end') : null,
      monthlyRent: dec(row.canonical['monthly_base_rent']) ?? new D(0),
    }))
    .sort((a, b) => b.monthlyRent.comparedTo(a.monthlyRent) || a.suite.localeCompare(b.suite));
}

// ------------------------------------------------------------------ the leases (documents)

/** A document is a lease when its heading says "lease agreement" (an abstract or the extracts' copy never is). */
const LEASE_HEADING = /\blease agreement\b/i;
const EXTRACTS_HEADING = /\bextracts?\b/i;
const TERM = /\bterm runs from\b/i;
const INITIAL_RENT = /\binitial base rent\b/i;
const ESCALATION = /\bbase rent (?:increases|rises|escalates)\b[^.]*?\b([0-9]+(?:\.[0-9]+)?)\s?%/i;
const FIXED_RENT = /\bbase rent is fixed\b/i;
const NNN = /\btriple[- ]net\b|\bNNN\b/;
const GROSS = /\b(?:full[- ]service |modified )?gross lease\b/i;
const SHARE = /\bproportionate share of ([0-9]+(?:\.[0-9]+)?)\s?%/i;
const TI = /\btenant improvement allowance\b/i;
const LC = /\bleasing commissions?\b/i;
const OUTSTANDING = /\b(?:remains?|remaining|is|are) (?:unpaid|outstanding|payable)\b|\boutstanding\b|\bunpaid\b/i;

export interface CreLeaseReading {
  readonly documentId: string;
  readonly tenant: string;
  /** The heading that names the tenant. */
  readonly heading: PackRuleQuote;
  readonly start: string | null;
  readonly end: string | null;
  readonly termQuote: PackRuleQuote | null;
  readonly initialRent: Decimal | null;
  readonly rentQuote: PackRuleQuote | null;
  /** Annual escalation as a fraction; 0 for a fixed rent; null when the lease states neither. */
  readonly escalation: Decimal | null;
  readonly escalationQuote: PackRuleQuote | null;
  readonly recovery: 'NNN' | 'GROSS' | 'NOT_STATED';
  /** The tenant's proportionate share of recoverable expenses, as a fraction (NNN only). */
  readonly share: Decimal | null;
  readonly recoveryQuote: PackRuleQuote | null;
  /** Tenant improvement allowance still unpaid by the landlord. */
  readonly tiOutstanding: { readonly currency: string; readonly amount: Decimal; readonly quote: PackRuleQuote } | null;
  /** Leasing commission still payable by the landlord. */
  readonly lcOutstanding: { readonly currency: string; readonly amount: Decimal; readonly quote: PackRuleQuote } | null;
}

function byDocument(pages: readonly PackRulePage[]): PackRulePage[][] {
  const grouped = new Map<string, PackRulePage[]>();
  for (const page of pages) grouped.set(page.documentId, [...(grouped.get(page.documentId) ?? []), page]);
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, own]) => [...own].sort((a, b) => a.pageNumber - b.pageNumber));
}

/** The money after a word in a sentence, else the first in it. */
function moneyAfter(sentence: string, word: RegExp): { currency: string; amount: Decimal } | null {
  const at = sentence.search(word);
  return at >= 0 ? moneyIn(sentence.slice(at)) : null;
}

/**
 * Each lease the documents hold, read sentence by sentence: the term, the initial base rent, the escalation,
 * the recovery basis and share, and any tenant improvement allowance or leasing commission still owed. A lease
 * is matched to the rent roll by the tenant its heading names; what no sentence states is absent.
 */
export function leaseReadings(pages: readonly PackRulePage[], tenants: readonly string[]): CreLeaseReading[] {
  const found: CreLeaseReading[] = [];
  for (const own of byDocument(pages)) {
    const first = own[0];
    const heading = sentences(first?.text ?? '')[0] ?? '';
    if (!first || !LEASE_HEADING.test(heading) || EXTRACTS_HEADING.test(heading)) continue;
    const lowered = heading.toLowerCase();
    const tenant = [...tenants].sort((a, b) => tenantKey(b).length - tenantKey(a).length).find((name) => tenantKey(name) && lowered.includes(tenantKey(name)));
    if (!tenant || found.some((reading) => reading.tenant === tenant)) continue;
    const all = own.flatMap((page) => sentences(page.text).map((sentence) => ({ page, sentence })));
    const pick = (test: (sentence: string) => boolean) => all.find((entry) => test(entry.sentence)) ?? null;
    const term = pick((sentence) => TERM.test(sentence));
    const termText = term ? term.sentence.slice(term.sentence.search(TERM)) : '';
    const start = term ? dateIn(termText) : null;
    const toAt = termText.search(/\b(?:to|until|through)\b/i);
    const end = term && toAt >= 0 ? dateIn(termText.slice(toAt)) : null;
    const rent = pick((sentence) => INITIAL_RENT.test(sentence));
    const escalated = pick((sentence) => ESCALATION.test(sentence));
    const fixed = pick((sentence) => FIXED_RENT.test(sentence));
    const recovery = pick((sentence) => NNN.test(sentence) || GROSS.test(sentence));
    const ti = pick((sentence) => TI.test(sentence));
    const lc = pick((sentence) => LC.test(sentence) && OUTSTANDING.test(sentence));
    const tiAmount = ti ? (OUTSTANDING.test(ti.sentence) ? (moneyAfter(ti.sentence, /\bof which\b/i) ?? moneyAfter(ti.sentence, TI)) : null) : null;
    const lcAmount = lc ? moneyAfter(lc.sentence, LC) : null;
    const escalation = escalated ? (dec(ESCALATION.exec(escalated.sentence)?.[1])?.div(100) ?? null) : fixed ? new D(0) : null;
    const share = recovery && NNN.test(recovery.sentence) ? (dec(SHARE.exec(recovery.sentence)?.[1])?.div(100) ?? null) : null;
    found.push({
      documentId: first.documentId,
      tenant,
      heading: quoteOf(first, heading),
      start,
      end,
      termQuote: term ? quoteOf(term.page, term.sentence) : null,
      initialRent: rent ? (moneyAfter(rent.sentence, INITIAL_RENT)?.amount ?? null) : null,
      rentQuote: rent ? quoteOf(rent.page, rent.sentence) : null,
      escalation,
      escalationQuote: escalated ? quoteOf(escalated.page, escalated.sentence) : fixed ? quoteOf(fixed.page, fixed.sentence) : null,
      recovery: !recovery ? 'NOT_STATED' : NNN.test(recovery.sentence) ? 'NNN' : 'GROSS',
      share,
      recoveryQuote: recovery ? quoteOf(recovery.page, recovery.sentence) : null,
      tiOutstanding: ti && tiAmount ? { ...tiAmount, quote: quoteOf(ti.page, ti.sentence) } : null,
      lcOutstanding: lc && lcAmount ? { ...lcAmount, quote: quoteOf(lc.page, lc.sentence) } : null,
    });
  }
  return found;
}

/** Anniversaries of `start` on or before `date`. */
export function anniversariesBy(start: string, date: string): number {
  const [sy = 0, sm = 0, sd = 0] = start.split('-').map(Number);
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  const years = y - sy - (m < sm || (m === sm && d < sd) ? 1 : 0);
  return Math.max(0, years);
}

/**
 * The monthly base rent a lease makes due on `date`: the initial rent stepped up by the escalation on each
 * anniversary of the commencement date reached, rounded half-up to the cent at each step. Null outside the
 * term or when the lease states no rent, start or escalation.
 */
export function rentDueOn(lease: CreLeaseReading, date: string): Decimal | null {
  if (!lease.initialRent || !lease.start || lease.escalation === null) return null;
  if (date < lease.start || (lease.end && date > lease.end)) return null;
  let rent = lease.initialRent;
  for (let step = 0; step < anniversariesBy(lease.start, date); step += 1) rent = cents(rent.times(new D(1).plus(lease.escalation)));
  return rent;
}

/** A rent roll rent more than this share above the lease's recomputed rent (and above a unit) is overstated. */
export const RENT_OVERSTATEMENT_TOLERANCE = '0.005';

export interface RentCheck {
  readonly roll: RollLease;
  readonly lease: CreLeaseReading | null;
  /** The rent the lease makes due at the analysis date. */
  readonly leaseRent: Decimal | null;
  /** Rent roll − lease, monthly; positive when the roll is higher. */
  readonly gap: Decimal | null;
  readonly state: 'MATCHES' | 'OVERSTATED' | 'UNDERSTATED' | 'NO_LEASE' | 'NOT_COMPUTABLE';
  /** The rent roll's expiry differs from the lease's term. */
  readonly expiryDiffers: boolean;
}

/** Each rent-roll suite against its lease, at the analysis date. */
export function rentChecks(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[], asOf: string): RentCheck[] {
  const roll = rentRoll(evidence);
  const leases = leaseReadings(pages, roll.map((entry) => entry.tenant));
  return roll.map((entry): RentCheck => {
    const lease = leases.find((reading) => reading.tenant === entry.tenant) ?? null;
    const expiryDiffers = Boolean(lease?.end && entry.end && lease.end !== entry.end);
    if (!lease) return { roll: entry, lease, leaseRent: null, gap: null, state: 'NO_LEASE', expiryDiffers };
    const leaseRent = rentDueOn(lease, asOf);
    if (!leaseRent) return { roll: entry, lease, leaseRent: null, gap: null, state: 'NOT_COMPUTABLE', expiryDiffers };
    const gap = entry.monthlyRent.minus(leaseRent);
    const material = gap.abs().gt(1) && gap.abs().gt(leaseRent.times(RENT_OVERSTATEMENT_TOLERANCE));
    return { roll: entry, lease, leaseRent, gap, state: !material ? 'MATCHES' : gap.gt(0) ? 'OVERSTATED' : 'UNDERSTATED', expiryDiffers };
  });
}

/** Rent due under the leases on file in each month of a calendar year, summed. */
export function rentDueInYear(lease: CreLeaseReading, year: string): Decimal {
  return sum(Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}-01`), (date) => rentDueOn(lease, date) ?? new D(0));
}

/** Base rental income lines of the imported P&L: revenue lines that name rent and not recoveries. */
const RENT_LINE = /\brent(?:al)?\b/i;
const RECOVERY_LINE = /\brecover/i;

export interface StatementRent {
  readonly year: string;
  readonly statements: Decimal;
  readonly leases: Decimal;
  readonly gap: Decimal;
  readonly share: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/**
 * Each fiscal year of the imported P&L against the rent the leases on file make due in it. Only computed when
 * every rent-roll tenant has a lease whose rent can be recomputed; otherwise the leases cannot explain the year.
 * A year is compared only when every lease on file was in force for all of it (T-184c): before a lease began, or
 * after one ended, the space earned rent under a lease that is not on file, which these leases cannot explain.
 */
export function statementRent(evidence: readonly PackRuleEvidence[], checks: readonly RentCheck[]): StatementRent[] {
  if (checks.length === 0 || checks.some((check) => !check.lease || check.state === 'NOT_COMPUTABLE')) return [];
  const leases = checks.map((check) => check.lease as CreLeaseReading);
  const { years } = fiscalYears(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))));
  return years.flatMap((year): StatementRent[] => {
    const rows = year.sources.filter((row) => row.kind === 'REVENUE' && RENT_LINE.test(row.account) && !RECOVERY_LINE.test(row.account));
    if (rows.length === 0 || !YEAR.test(year.period)) return [];
    if (leases.some((lease) => !lease.start || lease.start > `${year.period}-01-01` || (lease.end !== null && lease.end < `${year.period}-12-31`))) return [];
    const statements = sum(rows, (row) => new D(row.amount));
    const due = sum(leases, (lease) => rentDueInYear(lease, year.period));
    const gap = statements.minus(due);
    return [{ year: year.period, statements, leases: due, gap, share: ratio(gap.abs(), due), evidenceIds: rows.map((row) => row.evidenceId) }];
  });
}

/** Statement rental income more than this share away from the leases is a finding. */
export const STATEMENT_RENT_TOLERANCE = '0.02';

// ------------------------------------------------------------------ concentration and the expiry cliff

export interface TenantShare {
  readonly entry: RollLease;
  readonly share: Decimal;
}

/** Rent share by tenant from the rent roll, largest first. */
export function tenantShares(evidence: readonly PackRuleEvidence[]): { total: Decimal; shares: TenantShare[] } {
  const roll = rentRoll(evidence);
  const total = sum(roll, (entry) => entry.monthlyRent);
  return { total, shares: total.gt(0) ? roll.map((entry) => ({ entry, share: entry.monthlyRent.div(total) })) : [] };
}

/** Weighted average lease term in years at `asOf`, by rent (a lease past its end counts zero). */
export function walt(evidence: readonly PackRuleEvidence[], asOf: string): Decimal | null {
  const { total, shares } = tenantShares(evidence);
  if (!total.gt(0)) return null;
  const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return sum(shares, ({ entry, share }) => (entry.end ? share.times(D.max(0, new D(days(asOf, entry.end)).div('365.25'))) : new D(0)));
}

const addYears = (date: string, years: number) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export interface ExpiryBucket {
  /** 0 = before the closing; 1..n = hold year; n+1 = after the hold. */
  readonly holdYear: number;
  readonly label: string;
  readonly share: Decimal;
  readonly tenants: readonly TenantShare[];
}

/** The hold year a lease ends in, from the hold window: 0 before it starts, years + 1 after it ends. */
export function holdYearOf(end: string, hold: HoldWindow): number {
  if (end < hold.from) return 0;
  for (let year = 1; year <= hold.years; year += 1) if (end < addYears(hold.from, year)) return year;
  return hold.years + 1;
}

/** Share of rent expiring by hold year, from the rent roll's lease ends. Leases with no end date count after the hold. */
export function expiryProfile(evidence: readonly PackRuleEvidence[], hold: HoldWindow): ExpiryBucket[] {
  const { shares } = tenantShares(evidence);
  return Array.from({ length: hold.years + 2 }, (_, holdYear): ExpiryBucket => {
    const tenants = shares.filter(({ entry }) => (entry.end ? holdYearOf(entry.end, hold) : hold.years + 1) === holdYear);
    const label = holdYear === 0 ? 'before the closing' : holdYear > hold.years ? 'after the hold' : `hold year ${holdYear}`;
    return { holdYear, label, share: sum(tenants, (tenant) => tenant.share), tenants };
  });
}

/** A tenant at this share of rent or more is dominant… */
export const DOMINANT_TENANT_SHARE = '0.25';
/** …and its lease ending in one of the first this-many years of the hold (or before the closing) is a cliff. */
export const EARLY_HOLD_YEARS = 2;

// ------------------------------------------------------------------ recoveries

export interface RecoveryYear {
  readonly year: string;
  /** Σ expenses in the CAM reconciliation: the recoverable pool. */
  readonly pool: Decimal;
  /** Σ recoveries billed to tenants. */
  readonly billed: Decimal;
  /** What the leases on file make recoverable: the pool × Σ the NNN tenants' proportionate shares. */
  readonly recoverable: Decimal | null;
  readonly shortfall: Decimal | null;
  readonly shortfallShare: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/** The NNN tenants' proportionate shares from the leases on file, summed (a fraction of the pool), and the leases read. */
export function recoverableShare(leases: readonly CreLeaseReading[]): { share: Decimal; leases: CreLeaseReading[] } {
  const nnn = leases.filter((lease) => lease.recovery === 'NNN' && lease.share);
  return { share: sum(nnn, (lease) => lease.share as Decimal), leases: nnn };
}

/** The CAM reconciliation by year, oldest first, against what the leases make recoverable. */
export function recoveryYears(evidence: readonly PackRuleEvidence[], share: Decimal | null): RecoveryYear[] {
  const rows = evidence.filter((row) => row.evidenceType === CAM && YEAR.test(text(row, 'year')));
  return [...new Set(rows.map((row) => text(row, 'year')))].sort().map((year): RecoveryYear => {
    const own = rows.filter((row) => text(row, 'year') === year);
    const pool = sum(own, (row) => dec(row.canonical['expenses']) ?? new D(0));
    const billed = sum(own, (row) => dec(row.canonical['recoveries']) ?? new D(0));
    const recoverable = share && share.gt(0) ? cents(pool.times(share)) : null;
    const shortfall = recoverable ? recoverable.minus(billed) : null;
    return { year, pool, billed, recoverable, shortfall, shortfallShare: recoverable && shortfall ? ratio(shortfall, recoverable) : null, evidenceIds: own.map((row) => row.id) };
  });
}

/** Recoveries short of the recoverable by this share or more are a shortfall… */
export const RECOVERY_SHORTFALL_SHARE = '0.02';
/** …and a shortfall in every one of at least this many consecutive years is persistent. */
export const RECOVERY_TREND_MIN_YEARS = 3;

/** The latest run of consecutive years each short by the threshold or more. */
export function persistentShortfall(years: readonly RecoveryYear[]): RecoveryYear[] {
  const run: RecoveryYear[] = [];
  for (const year of [...years].reverse()) {
    const prior = run.at(-1);
    if (!year.shortfallShare?.gte(RECOVERY_SHORTFALL_SHARE) || (prior && Number(prior.year) - Number(year.year) !== 1)) break;
    run.push(year);
  }
  return run.reverse();
}

// ------------------------------------------------------------------ the seller's capex schedule and the condition reports

export interface CapexItem {
  readonly row: PackRuleEvidence;
  readonly year: string;
  readonly item: string;
  readonly category: string;
  readonly amount: Decimal;
  readonly status: string;
}

/** The seller's capex schedule as imported. */
export function capexSchedule(evidence: readonly PackRuleEvidence[]): CapexItem[] {
  return evidence
    .filter((row) => row.evidenceType === CAPEX_ITEM)
    .map((row) => ({ row, year: text(row, 'year'), item: text(row, 'item'), category: text(row, 'category').toLowerCase(), amount: dec(row.canonical['amount']) ?? new D(0), status: text(row, 'status').toLowerCase() }))
    .sort((a, b) => a.year.localeCompare(b.year) || a.item.localeCompare(b.item));
}

/** Building elements, each with the words that name it in a condition report or a schedule line. */
export const BUILDING_ELEMENTS: readonly { readonly key: string; readonly label: string; readonly pattern: RegExp }[] = [
  { key: 'roof', label: 'Roof', pattern: /\broof(?:s|ing)?\b/i },
  { key: 'hvac', label: 'HVAC', pattern: /\bhvac\b|\brooftop units?\b|\bchillers?\b|\bboilers?\b|\bheating\b|\bcooling\b|\bair[- ]conditioning\b/i },
  { key: 'paving', label: 'Paving and parking', pattern: /\bpaving\b|\bcar park\b|\bparking\b|\basphalt\b|\bresurfac\w*/i },
  { key: 'elevators', label: 'Elevators', pattern: /\belevators?\b|\blifts?\b/i },
  { key: 'envelope', label: 'Facade and envelope', pattern: /\bfa[cç]ades?\b|\benvelope\b|\bcladding\b|\bwindows?\b/i },
  { key: 'fire', label: 'Fire and life safety', pattern: /\bfire\b|\bsprinklers?\b|\blife safety\b|\balarm\b/i },
  { key: 'electrical', label: 'Electrical', pattern: /\belectrical\b|\bswitchgear\b|\blighting\b/i },
  { key: 'plumbing', label: 'Plumbing', pattern: /\bplumbing\b|\bdrainage\b|\bwater\b/i },
  { key: 'structure', label: 'Structure', pattern: /\bstructur\w*\b|\bfoundations?\b|\bslab\b/i },
];

const elementOf = (words: string) => BUILDING_ELEMENTS.find((element) => element.pattern.test(words)) ?? null;
const CONDITION_HEADING = /\b(?:property|building|facility) condition (?:assessment|report|survey)\b|\benvironmental site assessment\b|\benvironmental report\b/i;
/** A flagged item: a recommendation with an estimated cost. */
const RECOMMENDED = /\brecommend\w*\b|\brequire[sd]?\b|\bneeds?\b/i;
const ESTIMATE = /\bestimated (?:cost|at)\b|\bat a cost of\b|\bcost(?:ing)? an estimated\b/i;

export interface ConditionItem {
  readonly element: { readonly key: string; readonly label: string };
  readonly currency: string;
  readonly amount: Decimal;
  readonly quote: PackRuleQuote;
}

/**
 * Items a property condition assessment or environmental report flags with an estimated cost, one per
 * building element (the first sentence that names it). The element is read from the words before the
 * sentence's colon, else the sentence itself.
 */
export function conditionItems(pages: readonly PackRulePage[]): ConditionItem[] {
  const found = new Map<string, ConditionItem>();
  for (const own of byDocument(pages)) {
    const heading = sentences(own[0]?.text ?? '')[0] ?? '';
    if (!CONDITION_HEADING.test(heading) || EXTRACTS_HEADING.test(heading)) continue;
    for (const page of own) {
      for (const sentence of sentences(page.text)) {
        if (!RECOMMENDED.test(sentence) || !ESTIMATE.test(sentence)) continue;
        const colon = sentence.indexOf(':');
        const element = elementOf(colon > 0 && colon < 60 ? sentence.slice(0, colon) : sentence);
        const money = moneyAfter(sentence, ESTIMATE);
        if (!element || !money || found.has(element.key)) continue;
        found.set(element.key, { element: { key: element.key, label: element.label }, currency: money.currency, amount: money.amount, quote: quoteOf(page, sentence) });
      }
    }
  }
  return [...found.values()];
}

/** A scheduled amount below this share of the condition report's estimate is under-budgeted. */
export const CAPEX_BUDGET_SHARE = '0.9';

export interface ConditionCheck {
  readonly item: ConditionItem;
  readonly scheduled: readonly CapexItem[];
  readonly scheduledAmount: Decimal;
  readonly state: 'OMITTED' | 'UNDER_BUDGETED' | 'COVERED';
}

/** Each flagged item against the seller's capex schedule, by building element. */
export function conditionChecks(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): ConditionCheck[] {
  const schedule = capexSchedule(evidence);
  return conditionItems(pages).map((item): ConditionCheck => {
    const scheduled = schedule.filter((line) => line.category === item.element.key || elementOf(`${line.category} ${line.item}`)?.key === item.element.key);
    const scheduledAmount = sum(scheduled, (line) => line.amount);
    const state = scheduled.length === 0 ? 'OMITTED' : scheduledAmount.lt(item.amount.times(CAPEX_BUDGET_SHARE)) ? 'UNDER_BUDGETED' : 'COVERED';
    return { item, scheduled, scheduledAmount, state };
  });
}

// ------------------------------------------------------------------ the obligations register

export interface Obligation {
  readonly kind: 'TENANT_IMPROVEMENTS' | 'LEASING_COMMISSION' | 'COMMITTED_CAPEX';
  readonly label: string;
  readonly currency: string | null;
  readonly amount: Decimal;
  readonly quote: PackRuleQuote | null;
  readonly evidenceId: string | null;
}

/** Tenant improvements and leasing commissions the leases say are still owed, and the committed lines of the seller's capex schedule. */
export function obligations(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): Obligation[] {
  const leases = leaseReadings(pages, rentRoll(evidence).map((entry) => entry.tenant));
  const owed = leases.flatMap((lease): Obligation[] => [
    ...(lease.tiOutstanding ? [{ kind: 'TENANT_IMPROVEMENTS' as const, label: `Tenant improvement allowance unpaid, ${lease.tenant}`, currency: lease.tiOutstanding.currency, amount: lease.tiOutstanding.amount, quote: lease.tiOutstanding.quote, evidenceId: null }] : []),
    ...(lease.lcOutstanding ? [{ kind: 'LEASING_COMMISSION' as const, label: `Leasing commission payable, ${lease.tenant}`, currency: lease.lcOutstanding.currency, amount: lease.lcOutstanding.amount, quote: lease.lcOutstanding.quote, evidenceId: null }] : []),
  ]);
  const committed = capexSchedule(evidence)
    .filter((line) => line.status === 'committed')
    .map((line): Obligation => ({ kind: 'COMMITTED_CAPEX', label: `Committed capex, ${line.item} (${line.year})`, currency: null, amount: line.amount, quote: null, evidenceId: line.row.id }));
  return [...owed, ...committed];
}

/** A CRE property's key expenses for the multi-year P&L trend. */
export const CRE_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /\brepairs?\b|\bmaintenance\b/i },
  { key: 'taxes', label: 'Real estate taxes', pattern: /\b(?:real estate|property) tax(?:es)?\b|\brates\b/i },
  { key: 'insurance', label: 'Insurance', pattern: /\binsurance\b/i },
  { key: 'utilities', label: 'Utilities', pattern: /\butilit(?:y|ies)\b|\benergy\b/i },
];

