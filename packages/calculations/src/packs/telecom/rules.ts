import { D, parseDecimal } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, monthName, percent, revenueConcentrationRule } from '../common';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from '../rule-types';
import {
  AGREEMENT,
  arpuFlat,
  CAPEX_SQUEEZE_FACTOR,
  CAPEX_YEAR,
  checkClaims,
  CONTENT_SQUEEZE_FACTOR,
  COUNTERPARTY_SHARE,
  MOVEMENT,
  REVENUE_MONTH,
  rightsWindow,
  risingTo,
  squeezeYears,
  streamWindows,
  TELECOM_KEY_EXPENSES,
  trailingRevenue,
  type ClaimCheck,
  type SqueezeYear,
} from './subscribers';

/**
 * Telecom and media pack rules (T-062, spec §19). Subscriber counts come from
 * the billing extract; reported figures come from management documents.
 */
const SUBSCRIBERS = 'telecom.subscribers_month';
type Decimal = InstanceType<typeof D>;

/** Billed subscribers per month, oldest first, with the rows behind each total. */
function monthlyTotals(evidence: readonly PackRuleEvidence[]) {
  const months = new Map<string, { total: Decimal; rows: PackRuleEvidence[] }>();
  for (const row of evidence) {
    const month = row.evidenceType === SUBSCRIBERS ? row.canonical['month'] : null;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue;
    const entry = months.get(month) ?? { total: new D(0), rows: [] };
    entry.total = entry.total.plus(amountOf(row, 'billed_subscribers'));
    entry.rows.push(row);
    months.set(month, entry);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({ month, ...entry }));
}

const REPORTED = /subscribers at [^:]*:\s*([0-9][0-9,]*)/i;
const REPORTED_CHURN = /churn[^:]*:\s*([0-9]+(?:\.[0-9]+)?)%/i;

/** Management reports more subscribers than the billing extract bills in the same month. */
export const TELECOM_REPORTED_SUBSCRIBERS: PackRule = {
  id: 'telecom-reported-subscribers',
  version: '1',
  evidenceTypes: [SUBSCRIBERS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const latest = monthlyTotals(evidence).at(-1);
    const hit = findSentence(pages, (sentence) => REPORTED.test(sentence));
    const reported = hit ? parseDecimal((REPORTED.exec(hit.quote)?.[1] ?? '').replaceAll(',', '')) : null;
    if (!latest || !hit || !reported || !latest.total.gt(0)) return [];
    const gap = reported.minus(latest.total);
    const share = gap.div(latest.total);
    if (share.lt('0.02')) return [];
    return [
      {
        key: latest.month,
        domain: 'FINANCIAL',
        title: 'Reported subscribers exceed billed subscribers',
        description: `Management reports ${grouped(reported)} subscribers; the billing extract bills ${grouped(latest.total)} in ${monthName(latest.month)} — ${grouped(gap)} (${percent(share)}) more than are billed.`,
        severity: share.gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Revenue and the valuation should rest on billed subscribers; the reviewer prices the gap.',
        evidenceIds: latest.rows.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      },
    ];
  },
};

/** Billed subscribers grew to a peak and have fallen every month since. */
export const TELECOM_CHURN_TURNING: PackRule = {
  id: 'telecom-churn-turning',
  version: '1',
  evidenceTypes: [SUBSCRIBERS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const months = monthlyTotals(evidence);
    if (months.length < 6) return [];
    const peakIndex = months.reduce((best, month, index) => (month.total.gt(months[best]?.total ?? 0) ? index : best), 0);
    const first = months[0];
    const peak = months[peakIndex];
    const latest = months.at(-1);
    const after = months.slice(peakIndex);
    // At least three months of decline, each below the one before, after real growth.
    if (!first || !peak || !latest || peakIndex === 0 || after.length < 4 || !after.every((month, index) => index === 0 || month.total.lt(after[index - 1]?.total ?? 0))) return [];
    const growth = peak.total.minus(first.total).div(first.total).div(peakIndex);
    const decline = peak.total.minus(latest.total).div(peak.total).div(after.length - 1);
    if (!growth.gt(0)) return [];
    // The finding is the contrast with the reported rate, so it waits for the document that states it.
    const churn = findSentence(pages, (sentence) => REPORTED_CHURN.test(sentence));
    if (!churn) return [];
    return [
      {
        key: peak.month,
        domain: 'COMMERCIAL',
        title: 'Churn rising against the reported rate',
        description: `Billed subscribers grew about ${percent(growth)} a month to ${grouped(peak.total)} in ${monthName(peak.month)}, then fell about ${percent(decline)} a month to ${grouped(latest.total)} in ${monthName(latest.month)}. Management still reports ${REPORTED_CHURN.exec(churn.quote)?.[1]}% monthly churn.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Churn and growth assumptions in the scenarios should follow billed subscribers, not the reported rate.',
        evidenceIds: [...peak.rows, ...latest.rows].slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: churn.page.documentId, pageNumber: churn.page.pageNumber, quote: churn.quote }],
      },
    ];
  },
};

/** The largest region's share of the latest month's revenue (customer names read "<Region> region — <plan>"). */
export const TELECOM_REGIONAL_CONCENTRATION = revenueConcentrationRule({
  id: 'telecom-regional-concentration',
  title: 'Regional concentration',
  domain: 'COMMERCIAL',
  threshold: '0.4',
  groupBy: { key: (name) => /^(.+? region)\b/i.exec(name)?.[1] ?? null, label: (region) => `The ${region}` },
  direction: 0,
  directionRationale: 'A regional build-out or competition sensitivity in the scenarios, not a price term.',
  consequence: 'A competitor building into that region moves a large share of revenue.',
});

export const TELECOM_WHOLESALE_REVIEW = documentClauseRule({
  id: 'telecom-wholesale-review',
  title: 'Wholesale price review ahead',
  domain: 'COMMERCIAL',
  severity: 'MEDIUM',
  direction: -1,
  directionRationale: 'Network access cost may rise at the review; the reviewer prices the exposure.',
  sentences: [(sentence) => /re-?priced|pricing review/i.test(sentence) && /next review/i.test(sentence)],
  description: ([clause]) => `The wholesale network agreement re-prices access charges before the forecast ends: “${clause}”`,
});

// ---------------------------------------------------------------- subscriber claims, rights windows and concentration (T-168, ADR 0056)

const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const span = (years: readonly { year: string }[]) => (years.length === 1 ? (years[0]?.year ?? '') : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);
const cents = (value: Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${monthName(`${year}-${month}`)}`;
};

/** A claim's measured figure in words: a count, a churn rate or an ARPU. */
function measuredText(check: ClaimCheck): string {
  const period = check.period;
  const measured = check.measured;
  if (!period || !measured) return '';
  const window = `${monthName(period.from)} to ${monthName(period.to)}`;
  if (check.claim.key === 'SUBSCRIBERS') return `The subscriber movements export closes ${monthName(period.to)} at ${grouped(measured)} subscribers.`;
  if (check.claim.key === 'CHURN')
    return `The subscriber movements export gives ${grouped(period.disconnects)} disconnects on ${grouped(period.opening)} opening subscribers for ${window}, ${percent(measured)} a month${check.claim.annual ? ` (the stated ${percent(check.claim.value)} a year is ${percent(check.claim.value.div(12))} a month)` : ''}.`;
  return `The subscriber movements export gives ${cents(period.revenue)} of service revenue over ${grouped(period.subscriberMonths)} subscriber-months for ${window}, ${cents(measured)} a subscriber a month.`;
}

function claimProposal(check: ClaimCheck): PackRuleProposal | null {
  const { claim, status } = check;
  if (status === 'WITHIN_TOLERANCE') return null;
  const quotes = [claim.quote];
  const basis = measuredText(check);
  const record = { statement: claim.quote.quote, status, rationale: basis || 'The subscriber movements export does not hold twelve complete months.' };
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:unverified`,
      domain: 'COMMERCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” The subscriber movements export does not hold twelve complete months to check it against. Ask the seller for the billing or CRM export behind it before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
      evidenceIds: [],
      quotes,
      claim: record,
    };
  const evidenceIds = cite(check.period?.rows.slice(-MAX_CITED) ?? []);
  if (status === 'VERIFIED')
    return {
      key: `${claim.key}:verified`,
      domain: 'COMMERCIAL',
      title: `Claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” holds against the export. ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the subscriber movements export`, impliedValue: null, basis },
      evidenceIds,
      quotes,
      claim: record,
    };
  return {
    key: `${claim.key}:contradicted`,
    domain: 'COMMERCIAL',
    title: `Claim contradicted: ${claim.label}`,
    description: `“${claim.quote.quote}” The export contradicts it. ${basis} Carry the recomputed figure in the scenarios, not the deck’s, and price the gap.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on a subscriber figure the billing export does not support; the reviewer prices the gap.',
    evidenceIds,
    quotes,
    claim: record,
  };
}

/**
 * The subscriber claims register (the T-083/T-159 pattern): the subscriber count, monthly churn and ARPU a
 * deck states, recomputed from the subscriber movements export — each VERIFIED, CONTRADICTED or UNVERIFIED
 * and recorded in the claims register with its finding. Documents reproducing the extracts are never read.
 */
export const TELECOM_SUBSCRIBER_CLAIMS: PackRule = {
  id: 'telecom-subscriber-claims',
  version: '1',
  evidenceTypes: [MOVEMENT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => checkClaims(evidence, pages).flatMap((check) => claimProposal(check) ?? []),
};

/**
 * The rights and carriage register against the expected closing: a material agreement (its annual value 5%
 * or more of trailing revenue) that ends before the closing or within twelve months after it, and does not
 * renew automatically, is a renewal exposure. A document's end date and renewal sentence govern over the
 * register, so the check waits until documents have been read. Dates and arithmetic only: Pactlab never
 * judges whether the counterparty will renew. Unpriced: the reviewer prices it or makes a renewal a closing
 * condition.
 */
export const TELECOM_RIGHTS_WINDOW: PackRule = {
  id: 'telecom-rights-window',
  version: '1',
  evidenceTypes: [AGREEMENT, INVOICE_LINE, REVENUE_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const window = rightsWindow(evidence, pages);
    if (!window.from || !window.revenue) return [];
    const from = window.from;
    const revenue = window.revenue;
    return window.agreements.flatMap((status): PackRuleProposal[] => {
      if (!status.material || !status.share || !status.endsOn || (status.state !== 'ENDS_IN_WINDOW' && status.state !== 'ENDS_BEFORE_CLOSING')) return [];
      const { agreement } = status;
      const when = status.state === 'ENDS_BEFORE_CLOSING' ? 'before the closing' : `${status.monthsAfter} month${status.monthsAfter === 1 ? '' : 's'} after the closing`;
      const basis = from.basis === 'EXPECTED_CLOSING' ? `the expected closing of ${longDate(from.date)}` : `${longDate(from.date)}, the latest month in the exports (no closing date is stated)`;
      const fees = agreement.flow === 'payable' ? 'pays' : 'receives';
      const quotes = [status.endQuote, status.renewalQuote, from.quote].filter((quote): quote is NonNullable<typeof quote> => quote !== null);
      return [
        {
          key: `${agreement.agreementId}:${status.endsOn}`,
          domain: 'COMMERCIAL',
          title: `Material agreement ends ${status.state === 'ENDS_BEFORE_CLOSING' ? 'before the closing' : 'within 12 months of the closing'}: ${agreement.agreementId}`,
          description:
            `${agreement.agreementId}, the ${agreement.kind.replaceAll('_', ' ')} agreement with ${agreement.counterparty}, ends on ${longDate(status.endsOn)} (${status.endBasis === 'DOCUMENT' ? 'as the agreement states' : 'from the rights register'}), ${when}, measured from ${basis}` +
            `; ${status.renews === false ? 'it states it does not renew automatically' : 'no automatic renewal is recorded'}. ` +
            `The company ${fees} ${grouped(agreement.annualValue)} a year under it, ${percent(status.share)} of the ${grouped(revenue.total)} billed, advertising and affiliate revenue for ${monthName(revenue.from)} to ${monthName(revenue.to)}. ` +
            'A renewal on worse terms, or none, lands inside the first year of ownership: price it, or make a renewal a closing condition. Dates and arithmetic only; no view on whether it will be renewed.',
          severity: status.share.gte('0.1') || status.state === 'ENDS_BEFORE_CLOSING' ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'Revenue or content that depends on a renewal inside the first year; the reviewer prices it or makes the renewal a closing condition.',
          evidenceIds: [agreement.id],
          quotes,
        },
      ];
    });
  },
};

const STREAM_LABEL: Readonly<Record<string, string>> = { advertising: 'Advertising', affiliate: 'Affiliate' };

/**
 * Advertising and affiliate revenue by counterparty over the trailing twelve months of the statements: one
 * advertiser or distributor at 30% or more of its stream is a dominant counterparty. Unpriced: carried in
 * the scenarios as revenue that can leave with one relationship.
 */
export const TELECOM_COUNTERPARTY_CONCENTRATION: PackRule = {
  id: 'telecom-counterparty-concentration',
  version: '1',
  evidenceTypes: [REVENUE_MONTH, INVOICE_LINE],
  detect: ({ evidence }) => {
    const revenue = trailingRevenue(evidence);
    return streamWindows(evidence).flatMap((stream): PackRuleProposal[] => {
      const top = stream.counterparties[0];
      if (stream.missing.length || !top?.share || top.share.lt(COUNTERPARTY_SHARE)) return [];
      const label = STREAM_LABEL[stream.stream] ?? stream.stream;
      const ofAll = revenue?.total.gt(0) ? `, ${percent(top.amount.div(revenue.total))} of all ${grouped(revenue.total)} billed, advertising and affiliate revenue` : '';
      const next = stream.counterparties[1];
      return [
        {
          key: `${stream.stream}:${top.counterparty}:${stream.to}`,
          domain: 'COMMERCIAL',
          title: `${label} revenue concentrated in one counterparty: ${top.counterparty}`,
          description:
            `${top.counterparty} paid ${grouped(top.amount)} of the ${grouped(stream.total)} ${label.toLowerCase()} revenue for ${monthName(stream.from)} to ${monthName(stream.to)}, ${percent(top.share)}${ofAll}` +
            `${next?.share ? `; the next largest, ${next.counterparty}, is ${percent(next.share)}` : ''}. From the ${label.toLowerCase()} statements. One relationship carries a large share of the stream: carry it in the scenarios as revenue that can leave, and price it.`,
          severity: top.share.gte('0.4') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'Revenue that can leave with one relationship; the reviewer carries it in the scenarios and prices it.',
          evidenceIds: cite(top.rows),
        },
      ];
    });
  },
};

const arpuLine = (years: readonly SqueezeYear[]) => years.map((year) => `${year.year} ${cents(year.arpu)}`).join(', ');

/**
 * Content cost per subscriber against ARPU, year by year: the P&L's content and programming cost ÷ the
 * year's subscriber-months rising every year to 1.15× its first year or more, while ARPU from the movements
 * export stays flat (within 3%) or falls. The margin squeeze a single year misses. Unpriced.
 */
export const TELECOM_CONTENT_SQUEEZE: PackRule = {
  id: 'telecom-content-squeeze',
  version: '1',
  evidenceTypes: [MOVEMENT, PNL_LINE],
  detect: ({ evidence }) => {
    const years = squeezeYears(evidence).filter((year) => year.contentPerSubscriber !== null);
    if (years.length < 2 || !arpuFlat(years) || !risingTo(years.map((year) => year.contentPerSubscriber), CONTENT_SQUEEZE_FACTOR)) return [];
    const first = years[0] as SqueezeYear;
    const last = years.at(-1) as SqueezeYear;
    const firstSpread = first.arpu.minus(first.contentPerSubscriber as Decimal);
    const lastSpread = last.arpu.minus(last.contentPerSubscriber as Decimal);
    return [
      {
        key: `${first.year}-${last.year}`,
        domain: 'FINANCIAL',
        title: `Content costs rising against flat ARPU, ${span(years)}`,
        description:
          `Content and programming cost per subscriber a month rose every year — ${years.map((year) => `${year.year} ${cents(year.contentPerSubscriber as Decimal)}`).join(', ')}, ${(last.contentPerSubscriber as Decimal).div(first.contentPerSubscriber as Decimal).toFixed(2)}× — ` +
          `while ARPU held at ${arpuLine(years)}. What is left of each subscriber’s monthly revenue after content fell from ${cents(firstSpread)} to ${cents(lastSpread)}. ` +
          'Content cost from the imported P&L over the subscriber-months of the movements export; ARPU from the same export. A single year shows only that year’s cost. The margin the scenarios assume should carry the latest year, priced by the reviewer.',
        severity: lastSpread.lt(firstSpread.times('0.85')) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: [...new Set([...years.flatMap((year) => year.contentIds), ...years.flatMap((year) => year.subscriberIds.slice(-3))])].slice(0, MAX_CITED),
      },
    ];
  },
};

/**
 * Capital expenditure intensity against ARPU, year by year: capex ÷ the P&L's revenue rising every year to
 * 1.25× its first year or more, while ARPU stays flat or falls. Unpriced.
 */
export const TELECOM_CAPEX_SQUEEZE: PackRule = {
  id: 'telecom-capex-squeeze',
  version: '1',
  evidenceTypes: [CAPEX_YEAR, MOVEMENT, PNL_LINE],
  detect: ({ evidence }) => {
    const years = squeezeYears(evidence).filter((year) => year.capexIntensity !== null);
    if (years.length < 2 || !arpuFlat(years) || !risingTo(years.map((year) => year.capexIntensity), CAPEX_SQUEEZE_FACTOR)) return [];
    const first = years[0] as SqueezeYear;
    const last = years.at(-1) as SqueezeYear;
    return [
      {
        key: `${first.year}-${last.year}`,
        domain: 'FINANCIAL',
        title: `Capex intensity rising against flat ARPU, ${span(years)}`,
        description:
          `Capital expenditure as a share of revenue rose every year — ${years.map((year) => `${year.year} ${percent(year.capexIntensity as Decimal)} (${grouped(year.capex as Decimal)})`).join(', ')} — while ARPU held at ${arpuLine(years)}. ` +
          'Capex from its import over the imported P&L’s revenue; ARPU from the subscriber movements export. More is spent per unit of revenue each year for the same price per subscriber: carry the latest year’s intensity in the scenarios, priced by the reviewer.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: [...new Set(years.flatMap((year) => year.capexIds))].slice(0, MAX_CITED),
      },
    ];
  },
};

export const [TELECOM_PNL_TREND, TELECOM_PNL_MARGIN_DRIFT, TELECOM_PNL_EXPENSE_OUTPACING] = pnlTrendRules('telecom', TELECOM_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

export const TELECOM_RULES: readonly PackRule[] = [
  TELECOM_REPORTED_SUBSCRIBERS,
  TELECOM_CHURN_TURNING,
  TELECOM_REGIONAL_CONCENTRATION,
  TELECOM_WHOLESALE_REVIEW,
  TELECOM_SUBSCRIBER_CLAIMS,
  TELECOM_RIGHTS_WINDOW,
  TELECOM_COUNTERPARTY_CONCENTRATION,
  TELECOM_CONTENT_SQUEEZE,
  TELECOM_CAPEX_SQUEEZE,
  TELECOM_PNL_TREND,
  TELECOM_PNL_MARGIN_DRIFT,
  TELECOM_PNL_EXPENSE_OUTPACING,
];
export const TELECOM_EVIDENCE = { SUBSCRIBERS, MOVEMENT, AGREEMENT, REVENUE_MONTH, CAPEX_YEAR } as const;
