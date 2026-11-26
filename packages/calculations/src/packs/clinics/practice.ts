import { D, parseDecimal } from '../../metrics/decimal';
import { dateIn, lastDayOfMonth, monthsTo } from '../fintech/payments';
import { CLINICIAN_MONTH, clinicianMonths, REMITTANCE } from '../healthcare/practice';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The small clinics practice model (T-161, ADR 0052), deterministic and decimal-only: what concentrates
 * in a clinic of a few sites. The selling owner's share of visits and collections, and each service
 * line's margin and providers, recomputed from the schedule and billing exports; visits by referral
 * source; and the clinic lease read sentence by sentence — when the term ends, whether it can be
 * renewed, whether it can be assigned on a sale. Every figure names the rows or the sentence it rests
 * on. Documents, dates and arithmetic only: never clinical or legal judgment. Changing a rule is a new
 * CLINICS_PRACTICE_VERSION, never a silent edit.
 */
export const CLINICS_PRACTICE_VERSION = 'clinics-practice-1';
export const SERVICE_LINE_MONTH = 'clinics.service_line_month';
export const REFERRAL_MONTH = 'clinics.referral_month';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });

/** The analysis date: the last day of the latest month in the remittance, service-line, referral or collections exports. */
export function clinicsAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const types = new Set([REMITTANCE, SERVICE_LINE_MONTH, REFERRAL_MONTH, CLINICIAN_MONTH]);
  const latest = evidence
    .filter((row) => types.has(row.evidenceType))
    .map((row) => text(row, 'month'))
    .filter((month) => MONTH.test(month))
    .sort()
    .at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

// ------------------------------------------------------------------ the selling owner

/** A pseudonymous provider reference as the exports write it: P01, PR-03, DR-2. */
const REF_TOKEN = /(?<![A-Za-z0-9-])([A-Z]{1,4}-?\d{1,4})(?![A-Za-z0-9])/;
const OWNER_WORDS = /\b(?:selling owner|owner[- ]operator|practice owner|principal and owner|owner and principal)\b/i;

/** The sentence that names the selling owner by pseudonymous reference ("P01 is the selling owner"), if any document has one. */
export function sellingOwner(pages: readonly PackRulePage[]): { providerRef: string; quote: PackRuleQuote } | null {
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      if (!OWNER_WORDS.test(sentence)) continue;
      const ref = REF_TOKEN.exec(sentence)?.[1];
      if (ref) return { providerRef: ref, quote: quoteOf(page, sentence) };
    }
  }
  return null;
}

const SUCCESSION = /\b(?:succession(?: plan)?|transition (?:plan|period|services)|post-?closing employment|associate coverage|stays? on (?:for|after)|locum cover)\b/i;
const NEGATED = /\b(?:no|not|none|without|nor)\b/i;

/**
 * What the documents say about cover for the owner after a sale: the first sentence on succession, a
 * transition period, post-closing employment or associate coverage. `inPlace` is false when the
 * sentence says there is none ("There is no succession plan").
 */
export function successionEvidence(pages: readonly PackRulePage[]): { inPlace: boolean; quote: PackRuleQuote } | null {
  for (const page of pages) {
    const sentence = sentences(page.text).find((candidate) => SUCCESSION.test(candidate));
    if (sentence) return { inPlace: !NEGATED.test(sentence), quote: quoteOf(page, sentence) };
  }
  return null;
}

// ------------------------------------------------------------------ service lines

export interface ServiceLineMonth {
  readonly id: string;
  readonly month: string;
  readonly serviceLine: string;
  readonly providerRef: string;
  readonly visits: Decimal;
  readonly collected: Decimal;
  /** Direct cost of the visits; null when the export leaves it blank. */
  readonly directCost: Decimal | null;
}

export function serviceLineMonths(evidence: readonly PackRuleEvidence[]): ServiceLineMonth[] {
  return evidence
    .filter((row) => row.evidenceType === SERVICE_LINE_MONTH)
    .flatMap((row) => {
      const month = text(row, 'month');
      const collected = dec(row.canonical['collected']);
      const serviceLine = text(row, 'service_line');
      const providerRef = text(row, 'provider_ref');
      if (!MONTH.test(month) || !collected || !serviceLine || !providerRef) return [];
      return [{ id: row.id, month, serviceLine, providerRef, visits: dec(row.canonical['visits']) ?? new D(0), collected, directCost: dec(row.canonical['direct_cost']) }];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.serviceLine.localeCompare(b.serviceLine) || a.providerRef.localeCompare(b.providerRef) || a.id.localeCompare(b.id));
}

export interface ServiceLine {
  readonly serviceLine: string;
  readonly visits: Decimal;
  readonly collected: Decimal;
  /** Null when any row of the line has no direct cost. */
  readonly directCost: Decimal | null;
  /** (Collected − direct cost) ÷ collected. */
  readonly margin: Decimal | null;
  /** The line's share of the window's collections. */
  readonly share: Decimal | null;
  /** Providers who collected on the line in the window, largest first. */
  readonly providers: readonly { readonly providerRef: string; readonly collected: Decimal; readonly share: Decimal | null }[];
  readonly rows: readonly ServiceLineMonth[];
}

export interface ServiceLineWindow {
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly visits: Decimal;
  readonly collected: Decimal;
  /** Highest margin first; lines without a margin last. */
  readonly lines: readonly ServiceLine[];
}

/** Service lines over the twelve months to the latest service-line month. */
export function serviceLineWindow(rows: readonly ServiceLineMonth[]): ServiceLineWindow | null {
  const latest = rows.at(-1)?.month;
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes(row.month));
  const collected = sum(inside, (row) => row.collected);
  const names = [...new Set(inside.map((row) => row.serviceLine))];
  const lines = names
    .map((serviceLine): ServiceLine => {
      const of = inside.filter((row) => row.serviceLine === serviceLine);
      const lineCollected = sum(of, (row) => row.collected);
      const directCost = of.every((row) => row.directCost !== null) ? sum(of, (row) => row.directCost ?? new D(0)) : null;
      const refs = [...new Set(of.map((row) => row.providerRef))];
      const providers = refs
        .map((providerRef) => {
          const mine = sum(of.filter((row) => row.providerRef === providerRef), (row) => row.collected);
          return { providerRef, collected: mine, share: ratio(mine, lineCollected) };
        })
        .filter((provider) => provider.collected.gt(0))
        .sort((a, b) => b.collected.comparedTo(a.collected) || a.providerRef.localeCompare(b.providerRef));
      return {
        serviceLine,
        visits: sum(of, (row) => row.visits),
        collected: lineCollected,
        directCost,
        margin: directCost && lineCollected.gt(0) ? lineCollected.minus(directCost).div(lineCollected) : null,
        share: ratio(lineCollected, collected),
        providers,
        rows: of,
      };
    })
    .sort((a, b) => (b.margin && a.margin ? b.margin.comparedTo(a.margin) : a.margin ? -1 : b.margin ? 1 : 0) || a.serviceLine.localeCompare(b.serviceLine));
  return { from: months[0] ?? latest, to: latest, missing: months.filter((month) => !inside.some((row) => row.month === month)), visits: sum(inside, (row) => row.visits), collected, lines };
}

export interface OwnerShare {
  readonly providerRef: string;
  /** Where the shares were read: the service-line export, or collections by clinician when there is none. */
  readonly source: 'SERVICE_LINES' | 'CLINICIAN_COLLECTIONS';
  readonly from: string;
  readonly to: string;
  readonly visits: Decimal | null;
  readonly visitShare: Decimal | null;
  readonly collected: Decimal;
  readonly collectionShare: Decimal | null;
  readonly rows: readonly { readonly id: string }[];
}

/** The owner's share of visits and collections over the trailing twelve months, from the service lines, else collections by clinician. */
export function ownerShare(evidence: readonly PackRuleEvidence[], providerRef: string): OwnerShare | null {
  const lines = serviceLineWindow(serviceLineMonths(evidence));
  if (lines && lines.collected.gt(0)) {
    const mine = lines.lines.flatMap((line) => line.rows.filter((row) => row.providerRef === providerRef));
    const visits = sum(mine, (row) => row.visits);
    const collected = sum(mine, (row) => row.collected);
    return { providerRef, source: 'SERVICE_LINES', from: lines.from, to: lines.to, visits, visitShare: ratio(visits, lines.visits), collected, collectionShare: ratio(collected, lines.collected), rows: mine };
  }
  const months = clinicianMonths(evidence);
  const latest = months.at(-1)?.month;
  if (!latest) return null;
  const window = monthsTo(latest);
  const inside = months.filter((row) => window.includes(row.month));
  const mine = inside.filter((row) => row.providerRef === providerRef);
  const allVisits = inside.every((row) => row.visits !== null) ? sum(inside, (row) => row.visits ?? new D(0)) : null;
  const visits = allVisits ? sum(mine, (row) => row.visits ?? new D(0)) : null;
  const collected = sum(mine, (row) => row.collected);
  return {
    providerRef,
    source: 'CLINICIAN_COLLECTIONS',
    from: window[0] ?? latest,
    to: latest,
    visits,
    visitShare: visits && allVisits ? ratio(visits, allVisits) : null,
    collected,
    collectionShare: ratio(collected, sum(inside, (row) => row.collected)),
    rows: mine,
  };
}

/** Lines where the owner is the only provider who collected in the window: no associate covers them. */
export function ownerOnlyLines(window: ServiceLineWindow, providerRef: string): ServiceLine[] {
  return window.lines.filter((line) => line.providers.length === 1 && line.providers[0]?.providerRef === providerRef);
}

// ------------------------------------------------------------------ referrals

export interface ReferralMonth {
  readonly id: string;
  readonly month: string;
  readonly source: string;
  readonly sourceType: string;
  readonly visits: Decimal;
  readonly newPatients: Decimal | null;
}

export function referralMonths(evidence: readonly PackRuleEvidence[]): ReferralMonth[] {
  return evidence
    .filter((row) => row.evidenceType === REFERRAL_MONTH)
    .flatMap((row) => {
      const month = text(row, 'month');
      const visits = dec(row.canonical['visits']);
      const source = text(row, 'referral_source');
      if (!MONTH.test(month) || !visits || !source) return [];
      return [{ id: row.id, month, source, sourceType: text(row, 'source_type'), visits, newPatients: dec(row.canonical['new_patients']) }];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
}

export interface ReferralSource {
  readonly source: string;
  readonly sourceType: string;
  readonly visits: Decimal;
  readonly share: Decimal | null;
  readonly rows: readonly ReferralMonth[];
}

/** Visits by referral source over the twelve months to the latest referral month, largest first. */
export function referralWindow(rows: readonly ReferralMonth[]): { from: string; to: string; missing: string[]; visits: Decimal; sources: ReferralSource[] } | null {
  const latest = rows.at(-1)?.month;
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes(row.month));
  const visits = sum(inside, (row) => row.visits);
  const sources = [...new Set(inside.map((row) => row.source))]
    .map((source) => {
      const of = inside.filter((row) => row.source === source);
      const mine = sum(of, (row) => row.visits);
      return { source, sourceType: of[0]?.sourceType ?? '', visits: mine, share: ratio(mine, visits), rows: of };
    })
    .sort((a, b) => b.visits.comparedTo(a.visits) || a.source.localeCompare(b.source));
  return { from: months[0] ?? latest, to: latest, missing: months.filter((month) => !inside.some((row) => row.month === month)), visits, sources };
}

// ------------------------------------------------------------------ the lease

const LEASE_HEADING = /\blease\b/i;
const TERM_END = /\b(?:term|lease)\b.*\b(?:ends?|ending|expires?|expiring|terminates?|until)\b|\b(?:expiry|expiration) date\b/i;
const END_WORD = /\b(?:ends?|ending|expires?|expiring|terminates?|until|expiry|expiration)\b/i;
const RENEWAL = /\b(?:option to (?:renew|extend)|renewal option|right to (?:renew|extend)|renew(?:al)? (?:term|period)|further term)\b/i;
const ASSIGNMENT = /\bassign(?:ment|ed|s)?\b|\bchange (?:of|in) control\b/i;
const CLOSING = /\b(?:expected|target(?:ed)?|anticipated|scheduled|proposed|planned)\s+(?:closing|completion|close)\b|\bclosing (?:date|is (?:expected|targeted))\b/i;

export type LeaseRenewal = 'GRANTED' | 'NONE' | 'NOT_STATED';
export type LeaseAssignment = 'FREE' | 'CONSENT' | 'PROHIBITED' | 'NOT_STATED';

export interface LeaseReading {
  readonly documentId: string;
  /** The heading it was recognised by. */
  readonly heading: PackRuleQuote;
  readonly expiresOn: string | null;
  readonly expiry: PackRuleQuote | null;
  readonly renewal: LeaseRenewal;
  readonly renewalQuote: PackRuleQuote | null;
  readonly assignment: LeaseAssignment;
  readonly assignmentQuote: PackRuleQuote | null;
}

/**
 * The clinic leases, each read from its own pages: a document whose first sentence names a lease, then
 * the sentence that says when the term ends, the one on renewal (granted, or stated as none) and the
 * one on assignment or a change of control. What no sentence states is NOT_STATED, never assumed. A
 * copy of a lease already read (the same heading and end date) is left out.
 */
export function clinicLeases(pages: readonly PackRulePage[]): LeaseReading[] {
  const byDocument = new Map<string, PackRulePage[]>();
  for (const page of pages) byDocument.set(page.documentId, [...(byDocument.get(page.documentId) ?? []), page]);
  const found: LeaseReading[] = [];
  for (const [documentId, own] of [...byDocument.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...own].sort((a, b) => a.pageNumber - b.pageNumber);
    const first = ordered[0];
    const heading = first ? sentences(first.text)[0] : undefined;
    if (!first || !heading || !LEASE_HEADING.test(heading)) continue;
    const all = ordered.flatMap((page) => sentences(page.text).map((sentence) => ({ page, sentence })));
    const end = all.find(({ sentence }) => TERM_END.test(sentence) && !RENEWAL.test(sentence) && dateIn(sentence.slice(Math.max(0, sentence.search(END_WORD)))));
    const renewal = all.find(({ sentence }) => RENEWAL.test(sentence));
    const assignment = all.find(({ sentence }) => ASSIGNMENT.test(sentence));
    const assignmentKind = (sentence: string): LeaseAssignment =>
      /\bconsent\b/i.test(sentence) ? 'CONSENT' : /\b(?:may not|shall not|must not|cannot|prohibited|not be assigned)\b/i.test(sentence) ? 'PROHIBITED' : 'FREE';
    const expiresOn = end ? dateIn(end.sentence.slice(Math.max(0, end.sentence.search(END_WORD)))) : null;
    // A copy of the same lease (a data room often holds two) is one lease, read once.
    if (found.some((other) => other.heading.quote === heading && other.expiresOn === expiresOn)) continue;
    found.push({
      documentId,
      heading: quoteOf(first, heading),
      expiresOn,
      expiry: end ? quoteOf(end.page, end.sentence) : null,
      renewal: renewal ? (NEGATED.test(renewal.sentence) ? 'NONE' : 'GRANTED') : 'NOT_STATED',
      renewalQuote: renewal ? quoteOf(renewal.page, renewal.sentence) : null,
      assignment: assignment ? assignmentKind(assignment.sentence) : 'NOT_STATED',
      assignmentQuote: assignment ? quoteOf(assignment.page, assignment.sentence) : null,
    });
  }
  return found;
}

/** The expected closing date a document states ("a target closing date of 30 November 2026"), if any. */
export function expectedClosing(pages: readonly PackRulePage[]): { date: string; quote: PackRuleQuote } | null {
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const at = sentence.search(CLOSING);
      const date = at >= 0 ? dateIn(sentence.slice(at)) : null;
      if (date) return { date, quote: quoteOf(page, sentence) };
    }
  }
  return null;
}

/** Whole months from `from` to `to` (a date one day short of a month anniversary counts the month before). */
export function wholeMonths(from: string, to: string): number {
  const [fy = 0, fm = 0, fd = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = to.split('-').map(Number);
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Month ends match month ends: 30 November to 31 January is two whole months.
  const reached = td >= fd || (fd === lastDay(fy, fm) && td === lastDay(ty, tm));
  return (ty - fy) * 12 + (tm - fm) - (reached ? 0 : 1);
}

/** A lease ending within this many months of the closing, with no renewal option, is a finding. */
export const PREMISES_SHORT_TERM_MONTHS = 24;

export interface PremisesStatus {
  readonly lease: LeaseReading;
  /** The date the remaining term is measured from: the stated expected closing, else the analysis date. */
  readonly from: { readonly date: string; readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; readonly quote: PackRuleQuote | null } | null;
  /** Whole months of term left after that date; null when the lease states no end. */
  readonly monthsRemaining: number | null;
  readonly short: boolean;
}

/** Each lease's remaining term after the expected closing (or, with none stated, the analysis date). */
export function premisesStatuses(pages: readonly PackRulePage[], asOf: string | null): PremisesStatus[] {
  const closing = expectedClosing(pages);
  const from = closing ? { date: closing.date, basis: 'EXPECTED_CLOSING' as const, quote: closing.quote } : asOf ? { date: asOf, basis: 'ANALYSIS_DATE' as const, quote: null } : null;
  return clinicLeases(pages).map((lease) => {
    const monthsRemaining = lease.expiresOn && from ? wholeMonths(from.date, lease.expiresOn) : null;
    return { lease, from, monthsRemaining, short: monthsRemaining !== null && monthsRemaining <= PREMISES_SHORT_TERM_MONTHS };
  });
}
