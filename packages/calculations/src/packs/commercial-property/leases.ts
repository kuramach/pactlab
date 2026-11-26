import { D, parseDecimal } from '../../metrics/decimal';
import { pnlPeriods } from '../../pnl/pnl';
import { fiscalYears, pnlLinesFromRecords } from '../../pnl/trend';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { INVOICE_LINE, moneyIn, rowMonth } from '../common';
import { dateIn, lastDayOfMonth } from '../fintech/payments';
import { statedHoldYears } from '../music/catalog';
import { PNL_LINE } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The commercial-property lease model (T-165, ADR 0055), deterministic and decimal-only: the checks a buyer
 * makes on an income property without valuing it. Each lease is read sentence by sentence (the term, the
 * base rent, the escalation, the lease type and the tenant's share of recoverable expenses); rent is
 * recomputed lease by lease at the analysis date and set against the rent roll, and month by month against
 * the statements' base rent; NNN recoveries billed (the statements) are set against what the leases make
 * recoverable, year by year; tenant improvement allowances and leasing commissions the documents state, and
 * committed capex in the seller's schedule, form the obligations register; rent share by tenant and the
 * expiry profile run against the hold after closing; and items a property condition or environmental report
 * flags with a cost are set against the capex schedule. Every figure names the rows or the sentence it rests
 * on. Changing a rule is a new CRE_LEASES_VERSION, never a silent edit.
 */
export const CRE_LEASES_VERSION = 'commercial-property-leases-1';
export const CRE_LEASE = 'cre.lease';
export const CRE_CAM = 'cre.cam_category';
export const CRE_CAPEX = 'cre.capex_item';

/** A rent roll more than this far from its lease (as a fraction of the lease rent) is a mismatch. */
export const CRE_RENT_TOLERANCE = '0.005';
/** Statements' base rent more than this far from the leases' rent for a year is a finding. */
export const CRE_STATEMENT_TOLERANCE = '0.02';
/** Recoveries billed short of recoverable by more than this share of recoverable is a shortfall. */
export const CRE_RECOVERY_TOLERANCE = '0.02';
/** A tenant at this share of rent or more, expiring in the first CRE_CLIFF_YEARS of the hold, is a cliff. */
export const CRE_CLIFF_SHARE = '0.25';
export const CRE_CLIFF_YEARS = 2;
/** The hold the expiry profile assumes when no document states "hold period of N years". */
export const CRE_DEFAULT_HOLD_YEARS = 5;

export const CRE_CONVENTIONS = [
  'The analysis date is the last day of the latest billed month. Rent at a date is the lease’s base rent raised by its escalation once for every anniversary of the commencement date on or before it, rounded to the cent; a month bills the rent in force on its first day.',
  'A lease is a document page whose first sentence names it as a lease agreement with the tenant and the suite; the lease governs the rent roll on rent and expiry.',
  'Recoverable expenses are the statements’ real-estate tax, insurance, repairs and maintenance, security, common-area and utility lines; the leases’ net tenants owe their stated pro rata share of them, for the months their lease is in force. Recoveries billed are the statements’ recovery revenue lines.',
  'The hold runs from the expected closing a document states (else the analysis date) for the hold a document states (else five years). Year 1 of the hold is its first twelve months.',
  'Obligations are tenant improvement allowances and leasing commissions a document says the landlord shall pay, and committed projects in the capex schedule, due on or after the start of the hold. Those due earlier are the seller’s.',
  'A condition item is a sentence of a property condition or environmental report that recommends work at an estimated cost; it is covered when a capex schedule project names the same building element.',
  'No property value, market rent or cap rate is estimated: rent shares, dates and sums only.',
] as const;

type Decimal = InstanceType<typeof D>;
const zero = () => new D(0);
const cents = (value: Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
const NEGATED = /\b(?:no|not|none|without|nor|never)\b/i;
const normal = (value: string) => value.toLowerCase().replace(/\(synthetic\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ------------------------------------------------------------------ dates and the hold

/** The analysis date: the last day of the latest billed month; null with no billing import. */
export function creAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = evidence
    .filter((row) => row.evidenceType === INVOICE_LINE)
    .map((row) => rowMonth(row))
    .filter((month): month is string => month !== null)
    .sort()
    .at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

const plusYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

export interface CreHold {
  /** The stated expected closing, else the analysis date. */
  readonly from: string;
  readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE';
  readonly closingQuote: PackRuleQuote | null;
  readonly years: number;
  readonly yearsStated: boolean;
  readonly to: string;
}

/** The hold after closing: from the expected closing a document states (else the analysis date), for the hold a document states (else five years). */
export function creHold(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): CreHold | null {
  const closing = expectedClosing(pages);
  const from = closing?.date ?? creAnalysisDate(evidence);
  if (!from) return null;
  const stated = statedHoldYears(pages);
  const years = stated.stated ? stated.years : CRE_DEFAULT_HOLD_YEARS;
  return { from, basis: closing ? 'EXPECTED_CLOSING' : 'ANALYSIS_DATE', closingQuote: closing?.quote ?? null, years, yearsStated: stated.stated, to: plusYears(from, years) };
}

// ------------------------------------------------------------------ the rent roll

export interface RentRollRow {
  readonly id: string;
  readonly tenant: string;
  readonly suite: string;
  readonly sqft: Decimal | null;
  readonly leaseEnd: string | null;
  /** Monthly base rent as the roll states it. */
  readonly rent: Decimal;
  readonly marketRent: Decimal | null;
}

export function rentRoll(evidence: readonly PackRuleEvidence[]): RentRollRow[] {
  return evidence
    .filter((row) => row.evidenceType === CRE_LEASE)
    .map((row) => {
      const end = text(row, 'lease_end').slice(0, 10);
      return {
        id: row.id,
        tenant: text(row, 'tenant'),
        suite: text(row, 'suite'),
        sqft: parseDecimal(text(row, 'sqft')),
        leaseEnd: ISO_DATE.test(end) ? end : null,
        rent: parseDecimal(text(row, 'monthly_base_rent')) ?? zero(),
        marketRent: parseDecimal(text(row, 'monthly_market_rent')),
      };
    })
    .filter((row) => row.suite !== '' || row.tenant !== '')
    .sort((a, b) => a.suite.localeCompare(b.suite, undefined, { numeric: true }));
}

// ------------------------------------------------------------------ the leases

export type CreLeaseType = 'NET' | 'GROSS' | 'NOT_STATED';

export interface LeaseTerms {
  readonly documentId: string;
  readonly tenant: string;
  readonly suite: string;
  readonly heading: PackRuleQuote;
  readonly commencement: string | null;
  readonly expiry: string | null;
  readonly termQuote: PackRuleQuote | null;
  /** Monthly base rent at commencement. */
  readonly baseRent: Decimal | null;
  readonly currency: string | null;
  readonly rentQuote: PackRuleQuote | null;
  /** The yearly escalation as a fraction; zero for a fixed rent; null when no sentence states it. */
  readonly escalation: Decimal | null;
  readonly escalationQuote: PackRuleQuote | null;
  readonly leaseType: CreLeaseType;
  /** The tenant's pro rata share of recoverable expenses, as a fraction (net leases). */
  readonly share: Decimal | null;
  readonly typeQuote: PackRuleQuote | null;
}

/** A text copy of a paged document marks its page breaks so. */
const PAGE_MARKER = /-{3}page-{3}/;
const LEASE_HEADING = /^Lease agreement\s*(?:[—–-]\s*)?(.+?),\s+((?:Unit|Suite|Building)\s+[A-Za-z0-9-]+)\b/i;
const TERM = /\bterm\b.*\bcommences?\b/i;
const RENT = /\bbase rent (?:is|of)\b.*\b(?:per month|a month|monthly)\b/i;
const ESCALATION = /\bbase rent (?:increases|rises|escalates) by ([0-9]+(?:\.[0-9]+)?)%/i;
const FIXED = /\bbase rent is fixed\b/i;
const SHARE = /\bpro rata share of ([0-9]+(?:\.[0-9]+)?)%/i;

/**
 * Every sentence of each document, in page order, with the lease it belongs to: a sentence naming a lease
 * agreement with the tenant and the suite starts a lease, and the sentences after it in the same document
 * belong to it until the next. Sentences never run across a `---page---` marker (a text copy of a paged
 * document), so a heading is recognised wherever its page break falls.
 */
function leaseSentences(pages: readonly PackRulePage[]): { documentId: string; page: PackRulePage; sentence: string; lease: { heading: PackRuleQuote; tenant: string; suite: string } | null }[] {
  const byDocument = new Map<string, PackRulePage[]>();
  for (const page of pages) byDocument.set(page.documentId, [...(byDocument.get(page.documentId) ?? []), page]);
  const out: ReturnType<typeof leaseSentences> = [];
  for (const [documentId, own] of [...byDocument.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let lease: { heading: PackRuleQuote; tenant: string; suite: string } | null = null;
    for (const page of [...own].sort((a, b) => a.pageNumber - b.pageNumber)) {
      for (const sentence of page.text.split(PAGE_MARKER).flatMap((segment) => sentences(segment))) {
        const match = LEASE_HEADING.exec(sentence);
        if (match) lease = { heading: quoteOf(page, sentence), tenant: (match[1] ?? '').trim(), suite: (match[2] ?? '').trim() };
        out.push({ documentId, page, sentence, lease });
      }
    }
  }
  return out;
}

/** Each lease the documents hold, read sentence by sentence. */
export function leaseDocuments(pages: readonly PackRulePage[]): LeaseTerms[] {
  const grouped = new Map<PackRuleQuote, { documentId: string; tenant: string; suite: string; lines: { page: PackRulePage; sentence: string }[] }>();
  for (const line of leaseSentences(pages)) {
    if (!line.lease) continue;
    const entry = grouped.get(line.lease.heading) ?? { documentId: line.documentId, tenant: line.lease.tenant, suite: line.lease.suite, lines: [] };
    entry.lines.push({ page: line.page, sentence: line.sentence });
    grouped.set(line.lease.heading, entry);
  }
  return [...grouped.entries()].map(([heading, entry]) => readLease(entry.documentId, heading, entry.tenant, entry.suite, entry.lines));
}

function readLease(documentId: string, heading: PackRuleQuote, tenant: string, suite: string, lines: readonly { page: PackRulePage; sentence: string }[]): LeaseTerms {
  const find = (test: (sentence: string) => boolean) => lines.find((line) => test(line.sentence)) ?? null;
  const term = find((sentence) => TERM.test(sentence));
  const commenceAt = term ? term.sentence.search(/\bcommences?\b/i) : -1;
  const endAt = term ? term.sentence.search(/\b(?:ends|expires|terminates)\b/i) : -1;
  const rent = find((sentence) => RENT.test(sentence) && moneyIn(sentence) !== null);
  const money = rent ? moneyIn(rent.sentence) : null;
  const escalation = find((sentence) => ESCALATION.test(sentence) || FIXED.test(sentence));
  const rate = escalation ? ESCALATION.exec(escalation.sentence) : null;
  const net = find((sentence) => /\bnet lease\b/i.test(sentence) || (/\btriple net\b|\bNNN\b/.test(sentence) && SHARE.test(sentence)));
  const gross = find((sentence) => /\bgross lease\b/i.test(sentence));
  const share = net ? SHARE.exec(net.sentence) : null;
  return {
    documentId,
    tenant,
    suite,
    heading,
    commencement: term && commenceAt >= 0 ? dateIn(term.sentence.slice(commenceAt)) : null,
    expiry: term && endAt >= 0 ? dateIn(term.sentence.slice(endAt)) : null,
    termQuote: term ? quoteOf(term.page, term.sentence) : null,
    baseRent: money?.amount ?? null,
    currency: money?.currency ?? null,
    rentQuote: rent ? quoteOf(rent.page, rent.sentence) : null,
    escalation: escalation ? (rate ? new D(rate[1] ?? '0').div(100) : zero()) : null,
    escalationQuote: escalation ? quoteOf(escalation.page, escalation.sentence) : null,
    leaseType: net ? 'NET' : gross ? 'GROSS' : 'NOT_STATED',
    share: share ? new D(share[1] ?? '0').div(100) : null,
    typeQuote: net ? quoteOf(net.page, net.sentence) : gross ? quoteOf(gross.page, gross.sentence) : null,
  };
}

/** Escalations a lease has taken by `date`: one for each anniversary of commencement on or before it. */
export function escalationsBy(lease: LeaseTerms, date: string): number {
  if (!lease.commencement || date < lease.commencement) return 0;
  return Math.floor(wholeMonths(lease.commencement, date) / 12);
}

/** The monthly base rent in force on `date`; null when the lease does not state its rent, escalation or commencement. */
export function rentAt(lease: LeaseTerms, date: string): Decimal | null {
  if (!lease.baseRent || lease.escalation === null || !lease.commencement) return null;
  return cents(lease.baseRent.times(new D(1).plus(lease.escalation).pow(escalationsBy(lease, date))));
}

/** Whether the lease is in force on the first day of `month` (YYYY-MM). */
export function inForce(lease: { readonly commencement: string | null; readonly expiry: string | null }, month: string): boolean {
  const first = `${month}-01`;
  return lease.commencement !== null && lease.commencement.slice(0, 7) <= month && (lease.expiry === null || lease.expiry >= first);
}

const monthsOf = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);

/** The lease's base rent billed across a calendar year, month by month; null when its rent cannot be recomputed. */
export function leaseRentForYear(lease: LeaseTerms, year: string): Decimal | null {
  if (rentAt(lease, `${year}-01-01`) === null) return null;
  return monthsOf(year).reduce((total, month) => (inForce(lease, month) ? total.plus(rentAt(lease, `${month}-01`) ?? 0) : total), zero());
}

// ------------------------------------------------------------------ rent roll against the leases

export type RentCheckState = 'MATCHES' | 'OVERSTATED' | 'UNDERSTATED' | 'NO_LEASE';

export interface RentCheck {
  readonly row: RentRollRow;
  readonly lease: LeaseTerms | null;
  readonly state: RentCheckState;
  /** Monthly rent the lease gives at the analysis date. */
  readonly leaseRent: Decimal | null;
  readonly escalations: number;
  /** Roll − lease, monthly. */
  readonly difference: Decimal | null;
  readonly relative: Decimal | null;
  readonly expiryMatches: boolean | null;
}

/** The lease for a rent-roll row: the same suite, else the same tenant. */
export function leaseFor(row: RentRollRow, leases: readonly LeaseTerms[]): LeaseTerms | null {
  return leases.find((lease) => normal(lease.suite) === normal(row.suite)) ?? leases.find((lease) => normal(lease.tenant) === normal(row.tenant)) ?? null;
}

export function rentChecks(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { asOf: string | null; checks: RentCheck[] } {
  const asOf = creAnalysisDate(evidence);
  const leases = leaseDocuments(pages);
  const checks = rentRoll(evidence).map((row): RentCheck => {
    const lease = leaseFor(row, leases);
    const leaseRent = lease && asOf ? rentAt(lease, asOf) : null;
    const difference = leaseRent ? row.rent.minus(leaseRent) : null;
    const relative = leaseRent && difference && leaseRent.gt(0) ? difference.div(leaseRent) : null;
    const state: RentCheckState = !lease || !relative ? 'NO_LEASE' : relative.gt(CRE_RENT_TOLERANCE) ? 'OVERSTATED' : relative.lt(new D(CRE_RENT_TOLERANCE).neg()) ? 'UNDERSTATED' : 'MATCHES';
    return {
      row,
      lease,
      state,
      leaseRent,
      escalations: lease && asOf ? escalationsBy(lease, asOf) : 0,
      difference,
      relative,
      expiryMatches: lease?.expiry && row.leaseEnd ? lease.expiry === row.leaseEnd : null,
    };
  });
  return { asOf, checks };
}

// ------------------------------------------------------------------ the statements, by year

const BASE_RENT_LINE = /\b(?:base|minimum|contractual) rent\b|\brental income\b/i;
const RECOVERY_LINE = /\brecover(?:y|ies)\b|\breimbursement/i;
const RECOVERABLE_LINE = /\b(?:real estate|property) tax|\binsurance\b|\brepairs?\b|\bmaintenance\b|\bsecurity\b|\bcommon.?area\b|\bCAM\b|\butilit|\bjanitorial\b|\blandscap|\bsnow\b/i;
const NOT_RECOVERABLE_LINE = /\bmanagement fee|\bleasing\b|\bmarketing\b|\bdepreciation\b|\binterest\b|\bgeneral and administrative\b/i;

export interface StatementYear {
  readonly year: string;
  readonly baseRent: Decimal;
  readonly baseRentIds: readonly string[];
  readonly recoveriesBilled: Decimal;
  readonly recoveryIds: readonly string[];
  readonly recoverablePool: Decimal;
  readonly poolIds: readonly string[];
  readonly poolAccounts: readonly string[];
}

/** Each complete fiscal year of the imported P&L, read for base rent, recoveries billed and the recoverable expense pool. */
export function statementYears(evidence: readonly PackRuleEvidence[]): StatementYear[] {
  const { years } = fiscalYears(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))));
  return years.map((year) => {
    const revenue = year.sources.filter((row) => row.kind === 'REVENUE' || row.kind === 'OTHER_INCOME');
    const recoveries = revenue.filter((row) => RECOVERY_LINE.test(row.account));
    const base = revenue.filter((row) => BASE_RENT_LINE.test(row.account) && !RECOVERY_LINE.test(row.account));
    const pool = year.sources.filter((row) => (row.kind === 'OPEX' || row.kind === 'COGS') && RECOVERABLE_LINE.test(row.account) && !NOT_RECOVERABLE_LINE.test(row.account));
    const total = (rows: readonly { amount: string }[]) => rows.reduce((sum, row) => sum.plus(new D(row.amount).abs()), zero());
    return {
      year: year.period,
      baseRent: total(base),
      baseRentIds: base.map((row) => row.evidenceId),
      recoveriesBilled: total(recoveries),
      recoveryIds: recoveries.map((row) => row.evidenceId),
      recoverablePool: total(pool),
      poolIds: pool.map((row) => row.evidenceId),
      poolAccounts: [...new Set(pool.map((row) => row.account))],
    };
  });
}

export interface StatementRentYear {
  readonly year: string;
  readonly statement: Decimal;
  readonly leases: Decimal;
  readonly difference: Decimal;
  readonly relative: Decimal | null;
  readonly statementIds: readonly string[];
}

/**
 * The statements' base rent against the leases' rent for each complete year — only when every rent-roll
 * suite has a lease whose rent can be recomputed (otherwise the leases' total would be short by design).
 */
export function statementRent(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { complete: boolean; years: StatementRentYear[] } {
  const roll = rentRoll(evidence);
  const leases = leaseDocuments(pages);
  const matched = roll.map((row) => leaseFor(row, leases));
  const complete = roll.length > 0 && matched.every((lease) => lease !== null && rentAt(lease, lease.commencement ?? '') !== null);
  if (!complete) return { complete: false, years: [] };
  const own = [...new Set(matched)] as LeaseTerms[];
  const years = statementYears(evidence).flatMap((year): StatementRentYear[] => {
    if (year.baseRentIds.length === 0) return [];
    const total = own.reduce((sum, lease) => sum.plus(leaseRentForYear(lease, year.year) ?? 0), zero());
    const difference = year.baseRent.minus(total);
    return [{ year: year.year, statement: year.baseRent, leases: total, difference, relative: total.gt(0) ? difference.div(total) : null, statementIds: year.baseRentIds }];
  });
  return { complete: true, years };
}

// ------------------------------------------------------------------ recoveries

export interface RecoveryYear {
  readonly year: string;
  readonly pool: Decimal;
  readonly poolAccounts: readonly string[];
  /** Σ net tenants' share × the pool, for the months each lease is in force. */
  readonly recoverable: Decimal;
  readonly billed: Decimal;
  readonly shortfall: Decimal;
  readonly relative: Decimal | null;
  readonly short: boolean;
  readonly statementIds: readonly string[];
}

/** Recoveries billed against recoverable under the leases, for each complete statement year with a recoverable pool. */
export function recoveryYears(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { netLeases: LeaseTerms[]; years: RecoveryYear[] } {
  const netLeases = leaseDocuments(pages).filter((lease) => lease.leaseType === 'NET' && lease.share !== null);
  if (netLeases.length === 0) return { netLeases, years: [] };
  const years = statementYears(evidence).flatMap((year): RecoveryYear[] => {
    if (year.poolIds.length === 0 || year.recoveryIds.length === 0) return [];
    const recoverable = cents(
      netLeases.reduce((sum, lease) => {
        const months = monthsOf(year.year).filter((month) => inForce(lease, month)).length;
        return sum.plus((lease.share ?? zero()).times(year.recoverablePool).times(months).div(12));
      }, zero()),
    );
    const shortfall = recoverable.minus(year.recoveriesBilled);
    const relative = recoverable.gt(0) ? shortfall.div(recoverable) : null;
    return [
      {
        year: year.year,
        pool: year.recoverablePool,
        poolAccounts: year.poolAccounts,
        recoverable,
        billed: year.recoveriesBilled,
        shortfall,
        relative,
        short: relative !== null && relative.gt(CRE_RECOVERY_TOLERANCE),
        statementIds: [...year.poolIds, ...year.recoveryIds],
      },
    ];
  });
  return { netLeases, years };
}

// ------------------------------------------------------------------ the capex schedule and obligations

export interface CapexItem {
  readonly id: string;
  readonly item: string;
  readonly category: string;
  readonly year: string;
  readonly amount: Decimal;
  readonly status: string;
}

export function capexSchedule(evidence: readonly PackRuleEvidence[]): CapexItem[] {
  return evidence
    .filter((row) => row.evidenceType === CRE_CAPEX)
    .map((row) => ({ id: row.id, item: text(row, 'item'), category: text(row, 'category').toLowerCase(), year: text(row, 'year').slice(0, 4), amount: parseDecimal(text(row, 'amount')) ?? zero(), status: text(row, 'status').toLowerCase() }))
    .filter((row) => row.item !== '')
    .sort((a, b) => a.year.localeCompare(b.year) || a.item.localeCompare(b.item));
}

export type CreObligationKind = 'TENANT_IMPROVEMENT' | 'LEASING_COMMISSION' | 'COMMITTED_CAPEX';

export interface CreObligation {
  readonly key: string;
  readonly kind: CreObligationKind;
  /** The tenant (a lease's allowance), the payee (a commission) or the project. */
  readonly party: string;
  readonly amount: Decimal;
  readonly currency: string | null;
  /** A date the document states, or the scheduled year's first day for capex. */
  readonly due: string | null;
  readonly outstanding: boolean;
  readonly quote: PackRuleQuote | null;
  readonly evidenceIds: readonly string[];
}

const OBLIGATION_KIND = /\b(tenant improvement allowance|leasing commission)\b/i;
const OBLIGATION_DUTY = /\b(?:shall|will|must)\s+(?:pay|provide|fund|contribute)\b|\bpayable\b|\bremains? (?:unpaid|outstanding)\b/i;
const PAYEE = /\bto ([A-Z][A-Za-z&.' -]+?(?:\(synthetic\))?)(?= on\b| by\b| within\b|,|\.)/;

/** The obligations register: allowances and commissions the documents say the landlord shall pay, and committed capex; outstanding when due on or after the hold starts. */
export function obligations(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): CreObligation[] {
  const hold = creHold(evidence, pages);
  const found: CreObligation[] = [];
  for (const { page, sentence, lease } of leaseSentences(pages)) {
    const kind = OBLIGATION_KIND.exec(sentence);
    const money = moneyIn(sentence);
    if (!kind || !money || !OBLIGATION_DUTY.test(sentence) || NEGATED.test(sentence)) continue;
    const obligationKind: CreObligationKind = /commission/i.test(kind[1] ?? '') ? 'LEASING_COMMISSION' : 'TENANT_IMPROVEMENT';
    const party = obligationKind === 'TENANT_IMPROVEMENT' ? (lease?.tenant ?? 'A tenant') : (PAYEE.exec(sentence)?.[1]?.trim() ?? 'A broker');
    const due = dateIn(sentence);
    const key = `${obligationKind}:${normal(party)}:${money.amount.toFixed(2)}:${due ?? 'undated'}`;
    if (found.some((entry) => entry.key === key)) continue;
    found.push({ key, kind: obligationKind, party, amount: money.amount, currency: money.currency, due, outstanding: !hold || !due || due >= hold.from, quote: quoteOf(page, sentence), evidenceIds: [] });
  }
  for (const item of capexSchedule(evidence).filter((entry) => entry.status === 'committed')) {
    const due = /^\d{4}$/.test(item.year) ? `${item.year}-01-01` : null;
    found.push({
      key: `COMMITTED_CAPEX:${normal(item.item)}:${item.year}`,
      kind: 'COMMITTED_CAPEX',
      party: item.item,
      amount: item.amount,
      currency: null,
      due,
      outstanding: !hold || !due || item.year >= hold.from.slice(0, 4),
      quote: null,
      evidenceIds: [item.id],
    });
  }
  return found;
}

// ------------------------------------------------------------------ concentration and the expiry profile

export interface TenantRent {
  readonly tenant: string;
  readonly suite: string;
  readonly rent: Decimal;
  /** From the lease (recomputed at the analysis date) or, with none read, the rent roll. */
  readonly source: 'LEASE' | 'RENT_ROLL';
  readonly share: Decimal | null;
  readonly expiry: string | null;
  /** 0 before the hold starts, 1… within it, null after it or undated. */
  readonly holdYear: number | null;
  readonly afterHold: boolean;
  readonly rowId: string;
  readonly lease: LeaseTerms | null;
}

/** Rent share by tenant (the lease governs rent and expiry) and the year of the hold each lease expires in. */
export function tenantRents(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { hold: CreHold | null; tenants: TenantRent[]; total: Decimal } {
  const { checks } = rentChecks(evidence, pages);
  const hold = creHold(evidence, pages);
  const rows = checks.map((check) => ({ check, rent: check.leaseRent ?? check.row.rent, source: check.leaseRent ? ('LEASE' as const) : ('RENT_ROLL' as const), expiry: check.lease?.expiry ?? check.row.leaseEnd }));
  const total = rows.reduce((sum, row) => sum.plus(row.rent), zero());
  const tenants = rows
    .map(({ check, rent, source, expiry }): TenantRent => {
      const afterHold = Boolean(hold && expiry && expiry > hold.to);
      const holdYear = !hold || !expiry || afterHold ? null : expiry <= hold.from ? 0 : Math.floor(wholeMonths(hold.from, expiry) / 12) + 1;
      return { tenant: check.row.tenant, suite: check.row.suite, rent, source, share: total.gt(0) ? rent.div(total) : null, expiry, holdYear, afterHold, rowId: check.row.id, lease: check.lease };
    })
    .sort((a, b) => b.rent.comparedTo(a.rent) || a.suite.localeCompare(b.suite, undefined, { numeric: true }));
  return { hold, tenants, total };
}

export interface ExpiryBucket {
  /** "Before closing", "Year 1" … or "After the hold". */
  readonly label: string;
  readonly holdYear: number | null;
  readonly rent: Decimal;
  readonly share: Decimal | null;
  readonly tenants: readonly string[];
}

/** Rent expiring by year of the hold. */
export function expiryProfile(tenants: readonly TenantRent[], total: Decimal, hold: CreHold | null): ExpiryBucket[] {
  if (!hold) return [];
  const buckets: { label: string; holdYear: number | null; match: (tenant: TenantRent) => boolean }[] = [
    { label: 'Before closing', holdYear: 0, match: (tenant) => tenant.holdYear === 0 },
    ...Array.from({ length: hold.years }, (_, index) => ({ label: `Year ${index + 1}`, holdYear: index + 1, match: (tenant: TenantRent) => tenant.holdYear === index + 1 })),
    { label: 'After the hold', holdYear: null, match: (tenant) => tenant.afterHold },
  ];
  return buckets.map((bucket) => {
    const own = tenants.filter(bucket.match);
    const rent = own.reduce((sum, tenant) => sum.plus(tenant.rent), zero());
    return { label: bucket.label, holdYear: bucket.holdYear, rent, share: total.gt(0) ? rent.div(total) : null, tenants: own.map((tenant) => tenant.tenant) };
  });
}

// ------------------------------------------------------------------ condition items against the capex schedule

const CONDITION_DOCUMENT = /\b(?:property condition (?:assessment|report)|building (?:survey|condition)|environmental (?:site assessment|report))\b/i;
const ELEMENTS: readonly { readonly key: string; readonly label: string; readonly pattern: RegExp }[] = [
  // HVAC before the roof: rooftop units are HVAC.
  { key: 'hvac', label: 'HVAC', pattern: /\bhvac\b|\bheating\b|\bcooling\b|\bair[- ]?condition/i },
  { key: 'roof', label: 'Roof', pattern: /\broof/i },
  { key: 'parking', label: 'Parking and paving', pattern: /\bparking\b|\bpaving\b|\basphalt\b/i },
  { key: 'facade', label: 'Facade', pattern: /\bfa[cç]ade\b|\bcladding\b|\bbuilding envelope\b/i },
  { key: 'elevator', label: 'Elevators', pattern: /\belevators?\b|\blifts?\b/i },
  { key: 'fire', label: 'Fire and life safety', pattern: /\bfire\b|\bsprinkler/i },
  { key: 'plumbing', label: 'Plumbing', pattern: /\bplumbing\b|\bdrainage\b/i },
  { key: 'electrical', label: 'Electrical', pattern: /\belectrical\b|\bswitchgear\b/i },
  { key: 'structure', label: 'Structure', pattern: /\bstructur/i },
  { key: 'environmental', label: 'Environmental remediation', pattern: /\bremediat|\bcontaminat|\basbestos\b|\bunderground storage tank/i },
];

export interface ConditionItem {
  readonly element: string;
  readonly label: string;
  readonly amount: Decimal;
  readonly currency: string;
  readonly quote: PackRuleQuote;
  /** Capex schedule projects naming the same element. */
  readonly covered: readonly CapexItem[];
}

/** Items a property condition or environmental report recommends at an estimated cost, each against the capex schedule. */
export function conditionItems(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): ConditionItem[] {
  const schedule = capexSchedule(evidence);
  const byDocument = new Map<string, PackRulePage[]>();
  for (const page of pages) byDocument.set(page.documentId, [...(byDocument.get(page.documentId) ?? []), page]);
  const items: ConditionItem[] = [];
  for (const [, own] of [...byDocument.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...own].sort((a, b) => a.pageNumber - b.pageNumber);
    const heading = sentences(ordered[0]?.text ?? '')[0] ?? '';
    if (!CONDITION_DOCUMENT.test(heading)) continue;
    for (const page of ordered) {
      for (const sentence of sentences(page.text)) {
        if (!/\brecommend/i.test(sentence) || !/\bestimated cost\b/i.test(sentence)) continue;
        const money = moneyIn(sentence.slice(sentence.search(/\bestimated cost\b/i)));
        const element = ELEMENTS.find((entry) => entry.pattern.test(sentence));
        if (!money || !element || items.some((item) => item.element === element.key && item.amount.eq(money.amount))) continue;
        items.push({ element: element.key, label: element.label, amount: money.amount, currency: money.currency, quote: quoteOf(page, sentence), covered: schedule.filter((entry) => element.pattern.test(`${entry.item} ${entry.category}`)) });
      }
    }
  }
  return items;
}
