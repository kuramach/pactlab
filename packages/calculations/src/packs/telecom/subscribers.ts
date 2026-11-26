import { D, parseDecimal } from '../../metrics/decimal';
import type { KeyExpense, TrendYear } from '../../pnl/trend';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { INVOICE_LINE, rowMonth } from '../common';
import { dateIn, lastDayOfMonth, monthsTo } from '../fintech/payments';
import { trendOf } from '../pnl-trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The telecom and media subscriber model (T-168, ADR 0056), deterministic and decimal-only: subscribers,
 * churn and ARPU recomputed from the subscriber movements export (by month, and for every calendar year it
 * covers in full); the subscriber claims a deck states; the rights and carriage register against the
 * expected closing, a document's end date governing; advertising and affiliate revenue by counterparty;
 * and content cost and capital expenditure per year against ARPU. Every figure names the rows or the
 * sentence it rests on. Changing a rule is a new TELECOM_SUBSCRIBERS_VERSION, never a silent edit.
 */
export const TELECOM_SUBSCRIBERS_VERSION = 'telecom-subscribers-1';
export const SUBSCRIBERS_MONTH = 'telecom.subscribers_month';
export const MOVEMENT = 'telecom.subscriber_movement';
export const AGREEMENT = 'telecom.agreement';
export const REVENUE_MONTH = 'telecom.revenue_month';
export const CAPEX_YEAR = 'telecom.capex_year';

export const TELECOM_CONVENTIONS = [
  'Monthly churn is disconnects ÷ opening subscribers, summed over the months read; ARPU is service revenue ÷ the average of opening and closing subscribers, summed over the same months.',
  'A deck’s subscriber count is checked against the closing subscribers of the latest month; its churn and ARPU against the trailing twelve months. An annual churn figure is compared as a twelfth of itself.',
  'A year is read only when all twelve of its months are in the export, never scaled up.',
  'An agreement’s end date is the one a document states for its reference, else the register’s; it is measured from the expected closing a document states, else the latest month in the exports.',
  'An agreement is material when its annual value is 5% or more of the trailing twelve months of billed, advertising and affiliate revenue.',
  'Advertising and affiliate revenue by counterparty is read over the trailing twelve months of the statements.',
  'Content cost per subscriber is the P&L’s content and programming lines ÷ the year’s subscriber-months; capex intensity is the year’s capital expenditure ÷ the P&L’s revenue.',
] as const;

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const zero = () => new D(0);
const cap = (text: string) => (text.length > 400 ? text.slice(0, 400) : text);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();

// ------------------------------------------------------------------ subscriber movements

export interface MovementMonth {
  readonly month: string;
  readonly opening: Decimal;
  readonly adds: Decimal;
  readonly disconnects: Decimal;
  readonly closing: Decimal;
  readonly revenue: Decimal;
  readonly rows: readonly PackRuleEvidence[];
}

/** The movements export summed by month, oldest first; a row without a month or its four counts is skipped. */
export function movementMonths(evidence: readonly PackRuleEvidence[]): MovementMonth[] {
  const months = new Map<string, { opening: Decimal; adds: Decimal; disconnects: Decimal; closing: Decimal; revenue: Decimal; rows: PackRuleEvidence[] }>();
  for (const row of evidence) {
    if (row.evidenceType !== MOVEMENT) continue;
    const month = text(row, 'month');
    const opening = dec(row.canonical['opening_subscribers']);
    const adds = dec(row.canonical['gross_adds']);
    const disconnects = dec(row.canonical['disconnects']);
    const closing = dec(row.canonical['closing_subscribers']);
    if (!MONTH.test(month) || !opening || !adds || !disconnects || !closing) continue;
    const entry = months.get(month) ?? { opening: zero(), adds: zero(), disconnects: zero(), closing: zero(), revenue: zero(), rows: [] };
    entry.opening = entry.opening.plus(opening);
    entry.adds = entry.adds.plus(adds);
    entry.disconnects = entry.disconnects.plus(disconnects);
    entry.closing = entry.closing.plus(closing);
    entry.revenue = entry.revenue.plus(dec(row.canonical['service_revenue']) ?? zero());
    entry.rows.push(row);
    months.set(month, entry);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({ month, ...entry }));
}

export interface SubscriberPeriod {
  readonly from: string;
  readonly to: string;
  /** Months of the period with no row in the export. */
  readonly missing: readonly string[];
  readonly opening: Decimal;
  readonly adds: Decimal;
  readonly disconnects: Decimal;
  /** Closing subscribers of the period's last month. */
  readonly closing: Decimal;
  /** Σ (opening + closing) ÷ 2 over the months read. */
  readonly subscriberMonths: Decimal;
  readonly revenue: Decimal;
  /** Disconnects ÷ opening subscribers: the average monthly churn. */
  readonly churn: Decimal | null;
  /** Service revenue ÷ subscriber-months. */
  readonly arpu: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}

export function subscriberPeriod(months: readonly MovementMonth[], window: readonly string[]): SubscriberPeriod {
  const inside = months.filter((month) => window.includes(month.month));
  const sum = (pick: (month: MovementMonth) => Decimal) => inside.reduce((total, month) => total.plus(pick(month)), zero());
  const opening = sum((month) => month.opening);
  const disconnects = sum((month) => month.disconnects);
  const subscriberMonths = sum((month) => month.opening.plus(month.closing).div(2));
  const revenue = sum((month) => month.revenue);
  return {
    from: window[0] ?? '',
    to: window.at(-1) ?? '',
    missing: window.filter((month) => !inside.some((entry) => entry.month === month)),
    opening,
    adds: sum((month) => month.adds),
    disconnects,
    closing: inside.at(-1)?.closing ?? zero(),
    subscriberMonths,
    revenue,
    churn: opening.gt(0) ? disconnects.div(opening) : null,
    arpu: subscriberMonths.gt(0) ? revenue.div(subscriberMonths) : null,
    rows: inside.flatMap((month) => month.rows),
  };
}

/** The twelve months to the export's latest month; null with no movements. */
export function trailingSubscribers(months: readonly MovementMonth[]): SubscriberPeriod | null {
  const latest = months.at(-1)?.month;
  return latest ? subscriberPeriod(months, monthsTo(latest, 12)) : null;
}

export interface SubscriberYear extends SubscriberPeriod {
  readonly year: string;
}

/** Calendar years with all twelve months in the export, oldest first. */
export function subscriberYears(months: readonly MovementMonth[]): SubscriberYear[] {
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))].sort();
  return years.flatMap((year) => {
    const period = subscriberPeriod(months, monthsTo(`${year}-12`, 12));
    return period.missing.length ? [] : [{ ...period, year }];
  });
}

// ------------------------------------------------------------------ what the documents state

/** Documents that reproduce imported extracts never verify themselves: they are left out of every document read. */
const EXTRACTS_HEADING = /\bextracts?\b/i;

function byDocument(pages: readonly PackRulePage[]): PackRulePage[][] {
  const grouped = new Map<string, PackRulePage[]>();
  for (const page of pages) grouped.set(page.documentId, [...(grouped.get(page.documentId) ?? []), page]);
  return [...grouped.values()].map((own) => [...own].sort((a, b) => a.pageNumber - b.pageNumber));
}
const headingOf = (own: readonly PackRulePage[]) => sentences(own[0]?.text ?? '')[0] ?? '';

/** Every page except those of documents whose heading says they reproduce the extracts. */
export function narrativePages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => !EXTRACTS_HEADING.test(headingOf(own)))
    .flat();
}

export type SubscriberClaimKey = 'SUBSCRIBERS' | 'CHURN' | 'ARPU';
export interface SubscriberClaim {
  readonly key: SubscriberClaimKey;
  readonly label: string;
  /** A count, a monthly churn as a fraction, or an amount. */
  readonly value: Decimal;
  /** A churn the sentence states as annual, compared as a twelfth of itself. */
  readonly annual: boolean;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<SubscriberClaimKey, string>> = { SUBSCRIBERS: 'Subscribers', CHURN: 'Monthly churn', ARPU: 'ARPU' };
/** "11,638 subscribers", "11,638 billed subscribers" — the number before the word (a KPI line "Subscribers at …: N" is not a claim of this kind). */
const SUBSCRIBERS = /\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})\s+(?:paying\s+|billed\s+|active\s+|broadband\s+|fibre\s+)?subscribers\b/i;
/** "churn was 0.9%", "churn of 0.9%" — never across a colon, so a KPI line "Monthly churn: 0.9%" is not read here. */
const CHURN = /\bchurn\b[^:%]*?\b(?:of|was|at|averaged|is)\s+([0-9]+(?:\.[0-9]+)?)\s?%/i;
const ARPU = /\b(?:ARPU|average revenue per (?:user|subscriber))\b[^:]*?\b(?:of|was|at|is)\s+(?:[A-Z]{3}\s?|[$€£]\s?)?([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const ANNUAL = /\b(?:annual|annualised|annualized|yearly|a year|per year)\b/i;

/** The subscriber, churn and ARPU claims the documents state, first of each, outside the extracts. */
export function subscriberClaims(pages: readonly PackRulePage[]): SubscriberClaim[] {
  const found = new Map<SubscriberClaimKey, SubscriberClaim>();
  for (const page of narrativePages(pages)) {
    for (const sentence of sentences(page.text)) {
      for (const [key, pattern] of [['SUBSCRIBERS', SUBSCRIBERS], ['CHURN', CHURN], ['ARPU', ARPU]] as const) {
        if (found.has(key)) continue;
        const match = pattern.exec(sentence);
        const value = match ? dec(match[1]) : null;
        if (!match || !value) continue;
        const annual = key === 'CHURN' && ANNUAL.test(sentence);
        found.set(key, { key, label: CLAIM_LABELS[key], value: key === 'CHURN' ? value.div(100) : value, annual, quote: quoteOf(page, sentence) });
      }
    }
  }
  return (['SUBSCRIBERS', 'CHURN', 'ARPU'] as const).flatMap((key) => {
    const claim = found.get(key);
    return claim ? [claim] : [];
  });
}

/** Within these, a claim is verified; beyond the second it is contradicted; between, nothing is drafted. */
export const CLAIM_TOLERANCES = {
  /** Relative difference in subscribers. */
  SUBSCRIBERS: { verified: '0.01', contradicted: '0.02' },
  /** Points of monthly churn, as a fraction. */
  CHURN: { verified: '0.001', contradicted: '0.0025' },
  /** Relative difference in ARPU. */
  ARPU: { verified: '0.01', contradicted: '0.03' },
} as const;

export interface ClaimCheck {
  readonly claim: SubscriberClaim;
  readonly status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'WITHIN_TOLERANCE';
  /** The figure the export gives, when it can be measured. */
  readonly measured: Decimal | null;
  readonly period: SubscriberPeriod | null;
}

/** Each claim against the trailing twelve months of the movements export. */
export function checkClaims(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): ClaimCheck[] {
  const trailing = trailingSubscribers(movementMonths(evidence));
  const complete = trailing && trailing.missing.length === 0 ? trailing : null;
  return subscriberClaims(pages).map((claim): ClaimCheck => {
    const measured = !complete ? null : claim.key === 'SUBSCRIBERS' ? complete.closing : claim.key === 'CHURN' ? complete.churn : complete.arpu;
    if (!complete || !measured || !measured.gt(0)) return { claim, status: 'UNVERIFIED', measured: null, period: complete };
    const stated = claim.annual ? claim.value.div(12) : claim.value;
    const gap = claim.key === 'CHURN' ? stated.minus(measured).abs() : stated.minus(measured).abs().div(measured);
    const tolerance = CLAIM_TOLERANCES[claim.key];
    const status = gap.lte(tolerance.verified) ? 'VERIFIED' : gap.gt(tolerance.contradicted) ? 'CONTRADICTED' : 'WITHIN_TOLERANCE';
    return { claim, status, measured, period: complete };
  });
}

// ------------------------------------------------------------------ the rights and carriage register

export interface AgreementRow {
  readonly id: string;
  readonly agreementId: string;
  readonly counterparty: string;
  readonly kind: string;
  readonly flow: string;
  readonly annualValue: Decimal;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly autoRenews: boolean | null;
  readonly row: PackRuleEvidence;
}

/** The register's rows, by reference; a row without a reference or annual value is skipped. */
export function agreementRows(evidence: readonly PackRuleEvidence[]): AgreementRow[] {
  return evidence
    .filter((row) => row.evidenceType === AGREEMENT)
    .flatMap((row) => {
      const agreementId = text(row, 'agreement_id');
      const annualValue = dec(row.canonical['annual_value']);
      if (!agreementId || !annualValue) return [];
      const date = (field: string) => (ISO_DATE.test(text(row, field)) ? text(row, field) : null);
      const renews = text(row, 'auto_renews').toLowerCase();
      return [
        {
          id: row.id,
          agreementId,
          counterparty: text(row, 'counterparty'),
          kind: text(row, 'kind').toLowerCase(),
          flow: text(row, 'flow').toLowerCase(),
          annualValue,
          startsOn: date('starts_on'),
          endsOn: date('ends_on'),
          autoRenews: ['yes', 'y', 'true'].includes(renews) ? true : ['no', 'n', 'false'].includes(renews) ? false : null,
          row,
        },
      ];
    })
    .sort((a, b) => b.annualValue.comparedTo(a.annualValue) || a.agreementId.localeCompare(b.agreementId));
}

/** An agreement, recognised by its heading: a document whose first sentence names an agreement, licence or contract. */
const AGREEMENT_HEADING = /\b(?:agreements?|licen[cs]es?|contracts?)\b/i;
export function agreementPages(pages: readonly PackRulePage[]): PackRulePage[] {
  return byDocument(pages)
    .filter((own) => AGREEMENT_HEADING.test(headingOf(own)) && !EXTRACTS_HEADING.test(headingOf(own)))
    .flat();
}

const END_WORD = /\b(?:expir\w*|ends?|terminat\w*)\b/i;
const RENEW_WORD = /\brenew\w*/i;
const NEGATED = /\b(?:no|not|none|without|never)\b/i;
const sentencesNaming = (pages: readonly PackRulePage[], ref: string) =>
  pages.flatMap((page) => sentences(page.text).filter((sentence) => new RegExp(`(?<![A-Za-z0-9])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(sentence)).map((sentence) => ({ page, sentence })));

/** The end date an agreement states for its reference ("Agreement AF-01 expires on 30 September 2027"), the date after the word. */
export function statedEnd(pages: readonly PackRulePage[], ref: string): { date: string; quote: PackRuleQuote } | null {
  for (const { page, sentence } of sentencesNaming(agreementPages(pages), ref)) {
    const at = sentence.search(END_WORD);
    const date = at >= 0 ? dateIn(sentence.slice(at)) : null;
    if (date && !RENEW_WORD.test(sentence.slice(0, at))) return { date, quote: quoteOf(page, sentence) };
  }
  return null;
}

/** What an agreement states about renewal for its reference: renews, or stated not to. */
export function statedRenewal(pages: readonly PackRulePage[], ref: string): { renews: boolean; quote: PackRuleQuote } | null {
  const hit = sentencesNaming(agreementPages(pages), ref).find(({ sentence }) => RENEW_WORD.test(sentence));
  return hit ? { renews: !NEGATED.test(hit.sentence), quote: quoteOf(hit.page, hit.sentence) } : null;
}

/** The last day of the latest month in the subscriber, revenue and billing exports. */
export function telecomAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const months = evidence.flatMap((row) => {
    if (row.evidenceType === INVOICE_LINE) return [rowMonth(row) ?? ''];
    if (row.evidenceType === MOVEMENT || row.evidenceType === REVENUE_MONTH || row.evidenceType === SUBSCRIBERS_MONTH) return [text(row, 'month')];
    return [];
  });
  const latest = months.filter((month) => MONTH.test(month)).sort().at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

/** `YYYY-MM-DD` plus whole months, clamped to the month's last day. */
export function addMonthsToDate(date: string, count: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export interface TrailingRevenue {
  readonly from: string;
  readonly to: string;
  /** Billed (subscription) revenue, advertising and affiliate revenue over the twelve months. */
  readonly billed: Decimal;
  readonly streams: Decimal;
  readonly total: Decimal;
}

/** The twelve months to the latest month in billing and the revenue statements, all of it. */
export function trailingRevenue(evidence: readonly PackRuleEvidence[]): TrailingRevenue | null {
  const dated = evidence.flatMap((row) => {
    if (row.evidenceType === INVOICE_LINE) return [{ month: rowMonth(row) ?? '', amount: dec(row.canonical['amount']), billed: true }];
    if (row.evidenceType === REVENUE_MONTH) return [{ month: text(row, 'month'), amount: dec(row.canonical['amount']), billed: false }];
    return [];
  });
  const latest = dated.map((entry) => entry.month).filter((month) => MONTH.test(month)).sort().at(-1);
  if (!latest) return null;
  const window = monthsTo(latest, 12);
  const inside = dated.filter((entry) => window.includes(entry.month));
  const billed = inside.filter((entry) => entry.billed).reduce((total, entry) => total.plus(entry.amount ?? 0), zero());
  const streams = inside.filter((entry) => !entry.billed).reduce((total, entry) => total.plus(entry.amount ?? 0), zero());
  return { from: window[0] ?? latest, to: latest, billed, streams, total: billed.plus(streams) };
}

/** Months after the closing within which a material agreement's end is a finding. */
export const RIGHTS_WINDOW_MONTHS = 12;
/** An agreement whose annual value is this share of trailing revenue or more is material. */
export const MATERIAL_AGREEMENT_SHARE = '0.05';

export type AgreementState = 'ENDS_BEFORE_CLOSING' | 'ENDS_IN_WINDOW' | 'RENEWS' | 'ENDS_LATER' | 'NO_END';
export interface AgreementStatus {
  readonly agreement: AgreementRow;
  readonly endsOn: string | null;
  readonly endBasis: 'DOCUMENT' | 'REGISTER' | null;
  readonly endQuote: PackRuleQuote | null;
  readonly renews: boolean | null;
  readonly renewalQuote: PackRuleQuote | null;
  readonly state: AgreementState;
  /** Whole months from the closing (or analysis date) to the end; null without an end or when it ends before. */
  readonly monthsAfter: number | null;
  /** Annual value ÷ trailing revenue. */
  readonly share: Decimal | null;
  readonly material: boolean;
}

export interface RightsWindow {
  /** The date the window runs from: the stated expected closing, else the analysis date. */
  readonly from: { readonly date: string; readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; readonly quote: PackRuleQuote | null } | null;
  readonly windowEnd: string | null;
  readonly revenue: TrailingRevenue | null;
  readonly agreements: readonly AgreementStatus[];
}

/** Every register row against the window after the expected closing. */
export function rightsWindow(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): RightsWindow {
  const closing = expectedClosing(narrativePages(pages));
  const asOf = telecomAnalysisDate(evidence);
  const from = closing ? { date: closing.date, basis: 'EXPECTED_CLOSING' as const, quote: closing.quote } : asOf ? { date: asOf, basis: 'ANALYSIS_DATE' as const, quote: null } : null;
  const windowEnd = from ? addMonthsToDate(from.date, RIGHTS_WINDOW_MONTHS) : null;
  const revenue = trailingRevenue(evidence);
  const agreements = agreementRows(evidence).map((agreement): AgreementStatus => {
    const stated = statedEnd(pages, agreement.agreementId);
    const renewal = statedRenewal(pages, agreement.agreementId);
    const endsOn = stated?.date ?? agreement.endsOn;
    const renews = renewal ? renewal.renews : agreement.autoRenews;
    const state: AgreementState = !endsOn ? 'NO_END' : renews ? 'RENEWS' : from && endsOn < from.date ? 'ENDS_BEFORE_CLOSING' : windowEnd && endsOn <= windowEnd ? 'ENDS_IN_WINDOW' : 'ENDS_LATER';
    const share = revenue?.total.gt(0) ? agreement.annualValue.div(revenue.total) : null;
    return {
      agreement,
      endsOn,
      endBasis: stated ? 'DOCUMENT' : agreement.endsOn ? 'REGISTER' : null,
      endQuote: stated?.quote ?? null,
      renews,
      renewalQuote: renewal?.quote ?? null,
      state,
      monthsAfter: endsOn && from && endsOn >= from.date ? wholeMonths(from.date, endsOn) : null,
      share,
      material: share ? share.gte(MATERIAL_AGREEMENT_SHARE) : false,
    };
  });
  return { from, windowEnd, revenue, agreements };
}

// ------------------------------------------------------------------ advertising and affiliate revenue

export interface CounterpartyShare {
  readonly counterparty: string;
  readonly amount: Decimal;
  /** Of the stream's trailing revenue. */
  readonly share: Decimal | null;
  readonly rows: readonly PackRuleEvidence[];
}
export interface StreamWindow {
  readonly stream: string;
  readonly from: string;
  readonly to: string;
  readonly missing: readonly string[];
  readonly total: Decimal;
  readonly counterparties: readonly CounterpartyShare[];
}

/** Each stream's trailing twelve months by counterparty, largest first. */
export function streamWindows(evidence: readonly PackRuleEvidence[]): StreamWindow[] {
  const rows = evidence.filter((row) => row.evidenceType === REVENUE_MONTH && MONTH.test(text(row, 'month')) && text(row, 'stream') && dec(row.canonical['amount']));
  const latest = rows.map((row) => text(row, 'month')).sort().at(-1);
  if (!latest) return [];
  const window = monthsTo(latest, 12);
  return [...new Set(rows.map((row) => text(row, 'stream').toLowerCase()))].sort().map((stream) => {
    const inside = rows.filter((row) => text(row, 'stream').toLowerCase() === stream && window.includes(text(row, 'month')));
    const total = inside.reduce((sum, row) => sum.plus(dec(row.canonical['amount']) ?? 0), zero());
    const counterparties = [...new Set(inside.map((row) => text(row, 'counterparty')))]
      .filter(Boolean)
      .map((counterparty) => {
        const own = inside.filter((row) => text(row, 'counterparty') === counterparty);
        const amount = own.reduce((sum, row) => sum.plus(dec(row.canonical['amount']) ?? 0), zero());
        return { counterparty, amount, share: total.gt(0) ? amount.div(total) : null, rows: own };
      })
      .sort((a, b) => b.amount.comparedTo(a.amount) || a.counterparty.localeCompare(b.counterparty));
    return { stream, from: window[0] ?? latest, to: latest, missing: window.filter((month) => !inside.some((row) => text(row, 'month') === month)), total, counterparties };
  });
}

/** One counterparty at this share of its stream's trailing revenue, or more, is dominant. */
export const COUNTERPARTY_SHARE = '0.3';

// ------------------------------------------------------------------ content cost and capex against ARPU

/** The telecom key expenses the multi-year P&L trend watches against revenue; content is also read per subscriber. */
export const TELECOM_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'content', label: 'Content and programming costs', pattern: /\b(?:content|programming|rights)\b/i },
  { key: 'network', label: 'Network costs', pattern: /\bnetwork\b/i },
  { key: 'carriage', label: 'Carriage and retransmission fees', pattern: /\b(?:carriage|retransmission)\b/i },
  { key: 'marketing', label: 'Marketing and subscriber acquisition', pattern: /\b(?:marketing|subscriber acquisition)\b/i },
];

/** ARPU counts as flat when the last year is within this share of the first, or below it. */
export const ARPU_FLAT = '0.03';
/** Content cost per subscriber rising every year to this many times its first year, or more, is a squeeze. */
export const CONTENT_SQUEEZE_FACTOR = '1.15';
/** Capex intensity rising every year to this many times its first year, or more, is a squeeze. */
export const CAPEX_SQUEEZE_FACTOR = '1.25';

export interface SqueezeYear {
  readonly year: string;
  readonly arpu: Decimal;
  readonly subscriberMonths: Decimal;
  readonly pnlRevenue: Decimal;
  readonly content: Decimal | null;
  /** Content cost ÷ subscriber-months: content per subscriber per month. */
  readonly contentPerSubscriber: Decimal | null;
  readonly capex: Decimal | null;
  /** Capex ÷ the P&L's revenue. */
  readonly capexIntensity: Decimal | null;
  readonly subscriberIds: readonly string[];
  readonly contentIds: readonly string[];
  readonly capexIds: readonly string[];
}

/** Capital expenditure by fiscal year, with its rows. */
export function capexYears(evidence: readonly PackRuleEvidence[]): { year: string; amount: Decimal; rows: PackRuleEvidence[] }[] {
  const years = new Map<string, { amount: Decimal; rows: PackRuleEvidence[] }>();
  for (const row of evidence) {
    const year = text(row, 'year');
    const amount = dec(row.canonical['amount']);
    if (row.evidenceType !== CAPEX_YEAR || !YEAR.test(year) || !amount) continue;
    const entry = years.get(year) ?? { amount: zero(), rows: [] };
    entry.amount = entry.amount.plus(amount);
    entry.rows.push(row);
    years.set(year, entry);
  }
  return [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, entry]) => ({ year, ...entry }));
}

/**
 * The years read three ways at once: ARPU from the movements export, content cost from the P&L and capex from
 * its import. Only years present in both the export (all twelve months) and the P&L are read.
 */
export function squeezeYears(evidence: readonly PackRuleEvidence[]): SqueezeYear[] {
  const subscribers = subscriberYears(movementMonths(evidence));
  const trend = trendOf(evidence, TELECOM_KEY_EXPENSES);
  const capex = capexYears(evidence);
  return trend.years.flatMap((year: TrendYear): SqueezeYear[] => {
    const subs = subscribers.find((entry) => entry.year === year.year);
    if (!subs?.arpu || !subs.subscriberMonths.gt(0)) return [];
    const pnlRevenue = new D(year.revenue);
    const content = year.ratios.find((ratio) => ratio.key === 'content');
    const contentAmount = content && new D(content.amount).gt(0) ? new D(content.amount) : null;
    const spend = capex.find((entry) => entry.year === year.year);
    return [
      {
        year: year.year,
        arpu: subs.arpu,
        subscriberMonths: subs.subscriberMonths,
        pnlRevenue,
        content: contentAmount,
        contentPerSubscriber: contentAmount ? contentAmount.div(subs.subscriberMonths) : null,
        capex: spend?.amount ?? null,
        capexIntensity: spend && pnlRevenue.gt(0) ? spend.amount.div(pnlRevenue) : null,
        subscriberIds: subs.rows.map((row) => row.id),
        contentIds: content?.evidenceIds ?? [],
        capexIds: spend?.rows.map((row) => row.id) ?? [],
      },
    ];
  });
}

/** ARPU flat or falling, first year to last: within ARPU_FLAT above the first year, or below it. */
export function arpuFlat(years: readonly SqueezeYear[]): boolean {
  const first = years[0];
  const last = years.at(-1);
  return Boolean(first && last && years.length >= 2 && last.arpu.div(first.arpu).minus(1).lte(ARPU_FLAT));
}

/** A series rising every year and ending at least `factor` times its first value. */
export function risingTo(values: readonly (Decimal | null)[], factor: string): boolean {
  if (values.length < 2 || values.some((value) => !value || !value.gt(0))) return false;
  const series = values as Decimal[];
  const first = series[0] as Decimal;
  return series.every((value, index) => index === 0 || value.gt(series[index - 1] as Decimal)) && (series.at(-1) as Decimal).gte(first.times(factor));
}
