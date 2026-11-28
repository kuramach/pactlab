import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, monthName, percent, revenueConcentrationRule } from '../common';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  agreementTerms,
  BRAND_FEE_OUTPACING_FACTOR,
  brandFeesOutpacing,
  brandFeeYears,
  checkPerformanceClaims,
  FRANCHISE_MIN_TERM_MONTHS,
  HOTEL_AGREEMENT,
  HOTEL_BENCHMARK,
  HOTEL_CAPEX_BUDGET,
  HOTEL_OPERATING,
  HOTEL_PIP_ITEM,
  hotelAgreements,
  HOTELS_KEY_EXPENSES,
  measuredFrom,
  nearTermUnbudgeted,
  PIP_NEAR_TERM_MONTHS,
  pipItems,
  statedPipTotal,
  survivingTerms,
  type PerformanceClaimCheck,
} from './performance';

/**
 * Hotels pack rules (T-067, spec §19). Operating and benchmark data are
 * property aggregates; guest data is never accepted.
 */
const OPERATING = 'hotels.operating_month';
const BENCHMARK = 'hotels.benchmark_month';
const byMonth = (evidence: readonly PackRuleEvidence[], type: string) =>
  evidence.filter((row) => row.evidenceType === type && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? '')).sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const calendarMonth = (row: PackRuleEvidence) => MONTH_NAMES[Number((row.canonical['month'] ?? '').slice(5, 7)) - 1] ?? '';

/** The franchise requires a PIP on change of ownership; priced at the estimate the agreement states. */
export const HOTELS_BRAND_PIP = documentClauseRule({
  id: 'hotels-brand-pip',
  title: 'Brand PIP required on change of ownership',
  domain: 'PROPERTY',
  severity: 'HIGH',
  direction: -1,
  directionRationale: 'Capital the buyer must spend after closing: a remediation cost on the bridge, or an escrow.',
  // The estimate first: the price is read from the first quote.
  sentences: [(sentence) => /estimate of the (PIP|property improvement plan)/i.test(sentence), (sentence) => /(property improvement plan|\bPIP\b)/i.test(sentence) && /change of ownership|transfer/i.test(sentence)],
  description: ([estimate, obligation]) => `The franchise requires a property improvement plan on any change of ownership: “${obligation}” “${estimate}”`,
  price: { type: 'REMEDIATION_COST', basis: 'The PIP estimate stated in the franchise agreement.' },
});

/** The hotel's RevPAR gap to its competitive set, widening from the first benchmark month to the latest. */
export const HOTELS_REVPAR_GAP: PackRule = {
  id: 'hotels-revpar-gap',
  version: '1',
  evidenceTypes: [BENCHMARK],
  detect: ({ evidence }) => {
    const rows = byMonth(evidence, BENCHMARK).filter((row) => amountOf(row, 'comp_set_revpar').gt(0));
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last || rows.length < 6) return [];
    const gap = (row: PackRuleEvidence) => new D(1).minus(amountOf(row, 'revpar').div(amountOf(row, 'comp_set_revpar')));
    if (gap(last).lt('0.05') || gap(last).minus(gap(first)).lt('0.02')) return [];
    return [
      {
        key: `${first.canonical['month']}:${last.canonical['month']}`,
        domain: 'COMMERCIAL',
        title: 'RevPAR trailing the competitive set',
        description: `The hotel's RevPAR trails the competitive set by ${percent(gap(first))} in ${monthName(first.canonical['month'] ?? '')}, widening to ${percent(gap(last))} by ${monthName(last.canonical['month'] ?? '')} (${last.canonical['revpar']} against ${last.canonical['comp_set_revpar']}).`,
        severity: gap(last).gte('0.1') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Lost share to the comp set: the RevPAR trend and NOI follow, priced by the reviewer.',
        evidenceIds: rows.slice(-MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

export const HOTELS_CHANNEL_CONCENTRATION = revenueConcentrationRule({
  id: 'hotels-channel-concentration',
  title: 'Channel concentration',
  domain: 'COMMERCIAL',
  threshold: '0.35',
  direction: 0,
  directionRationale: 'A commission and ranking sensitivity in the scenarios, not a price term.',
  consequence: 'Commission cost and ranking changes on that channel move a large share of revenue.',
});

/** In the latest twelve months, the two strongest months earn far more room revenue than the weakest. */
export const HOTELS_SEASONAL_DEMAND: PackRule = {
  id: 'hotels-seasonal-demand',
  version: '1',
  evidenceTypes: [OPERATING],
  detect: ({ evidence }) => {
    const year = byMonth(evidence, OPERATING).slice(-12);
    if (year.length < 12) return [];
    const revenue = (row: PackRuleEvidence) => amountOf(row, 'room_revenue');
    const ranked = [...year].sort((a, b) => revenue(b).comparedTo(revenue(a)));
    const peak = ranked.slice(0, 2).sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
    const trough = ranked.at(-1) as PackRuleEvidence;
    if (!revenue(trough).gt(0)) return [];
    const ratio = peak.reduce((sum, row) => sum.plus(revenue(row)), new D(0)).div(2).div(revenue(trough));
    if (ratio.lt('1.5')) return [];
    return [
      {
        key: year.at(-1)?.canonical['month'] ?? '',
        domain: 'OPERATIONAL',
        title: 'Seasonal demand',
        description: `In the twelve months to ${monthName(year.at(-1)?.canonical['month'] ?? '')}, ${peak.map(calendarMonth).join(' and ')} room revenue is ${ratio.toFixed(1)}× ${calendarMonth(trough)}'s. Cash flow and covenants should be tested on the low months.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A working-capital and seasonality input in the scenarios, not a price term.',
        evidenceIds: year.map((row) => row.id),
      },
    ];
  },
};

export const HOTELS_MANAGEMENT_TERMINATION_FEE = documentClauseRule({
  id: 'hotels-management-termination-fee',
  title: 'Management contract termination fee',
  domain: 'LEGAL',
  severity: 'MEDIUM',
  direction: -1,
  directionRationale: 'A cost to replace the operator after closing; the reviewer prices it from the base fee.',
  sentences: [(sentence) => /termination fee/i.test(sentence) && /(on|upon) (the )?sale/i.test(sentence)],
  description: ([clause]) => `The management contract charges a fee to terminate on sale: “${clause}”`,
});

// ---------------------------------------------------------------- the flag, the PIP, the operator, the claims and brand fees (T-166, ADR 0068)

type Decimal = InstanceType<typeof D>;
const cite = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
const pct1 = (value: Decimal | null) => (value === null ? 'n/a' : percent(value));
const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${monthName(`${year}-${month}`)}`;
};
const months = (count: number) => `${count} month${count === 1 ? '' : 's'}`;
const yearsAfter = (count: number) => (count % 12 === 0 ? `${count / 12} year${count === 12 ? '' : 's'}` : months(count));
const fromWords = (from: { date: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE' }) =>
  from.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${longDate(from.date)}` : `${longDate(from.date)}, the end of the latest month in the exports (no closing date is stated)`;

function shown(check: PerformanceClaimCheck, value: Decimal): string {
  const { claim } = check;
  if (claim.key === 'OCCUPANCY') return percent(value);
  if (claim.key === 'REVPAR_INDEX') return value.toFixed(1);
  return `${claim.currency ?? ''} ${value.toFixed(2)}`.trim();
}

function performanceProposal(check: PerformanceClaimCheck): PackRuleProposal | null {
  const { claim, status, measured, window, rows, source } = check;
  if (status === 'WITHIN_TOLERANCE') return null;
  const where = source === 'STR_BENCHMARK' ? 'the STR benchmark' : 'the operating history';
  const period = window ? `${monthName(window.from)} to ${monthName(window.to)}` : '';
  const formula =
    claim.key === 'REVPAR_INDEX'
      ? 'Σ the hotel’s RevPAR ÷ Σ the competitive set’s RevPAR × 100'
      : claim.key === 'OCCUPANCY'
        ? 'rooms sold ÷ rooms available'
        : claim.key === 'ADR'
          ? 'room revenue ÷ rooms sold'
          : 'room revenue ÷ rooms available';
  const basis = measured ? `${where} gives ${shown(check, measured)} for ${period} (${formula}).` : '';
  const record = { statement: claim.quote.quote, status, rationale: basis || (check.reason ?? 'Nothing imported measures it.') };
  const evidenceIds = cite(rows.map((row) => row.id));
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:unverified`,
      domain: 'COMMERCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” ${check.reason ?? ''} Ask the seller for the STR or performance reports behind it before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
      evidenceIds,
      quotes: [claim.quote],
      claim: record,
    };
  if (status === 'VERIFIED')
    return {
      key: `${claim.key}:${window?.to ?? ''}:verified`,
      domain: 'COMMERCIAL',
      title: `Claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” holds against ${where}: ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against ${where}`, impliedValue: null, basis },
      evidenceIds,
      quotes: [claim.quote],
      claim: record,
    };
  return {
    key: `${claim.key}:${window?.to ?? ''}:contradicted`,
    domain: 'COMMERCIAL',
    title: `${source === 'STR_BENCHMARK' ? 'STR report' : 'Operating history'} contradicts the deck: ${claim.label}`,
    description: `The deck claims ${shown(check, claim.value)} (“${claim.quote.quote}”); ${basis} Carry the measured figure in the scenarios, not the deck’s, and price the gap. Arithmetic on the reports supplied; no view on the market.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price rests on a performance figure the reports do not support; the reviewer prices the gap.',
    evidenceIds,
    quotes: [claim.quote],
    claim: record,
  };
}

/**
 * Performance claims register (the claims-register pattern of T-083/T-159): RevPAR, ADR, occupancy and the
 * RevPAR index as the deck or memorandum states them, against the trailing twelve months of the operating
 * history and the STR benchmark. VERIFIED (+1, confirmed value only), CONTRADICTED (−1) or UNVERIFIED (0), each
 * in the claims register. Agreements, the PIP and the reports themselves are never read as claims.
 */
export const HOTELS_PERFORMANCE_CLAIMS: PackRule = {
  id: 'hotels-performance-claims',
  version: '1',
  evidenceTypes: [HOTEL_OPERATING, HOTEL_BENCHMARK],
  readsDocuments: true,
  detect: ({ evidence, pages }) => checkPerformanceClaims(evidence, pages).flatMap((check) => performanceProposal(check) ?? []),
};

/**
 * The franchise term against the expected closing: a franchise (brand) agreement ending before the closing or
 * within five years after it — the agreement's own expiry sentence governing over the register — is a drag:
 * re-licensing or a re-flag lands inside the hold, and leaving early carries the penalty the agreement states.
 * The check waits for the documents, which decide the date and the penalty. Dates and arithmetic only: no view on
 * the flag's worth or on whether the brand will renew.
 */
export const HOTELS_FRANCHISE_TERM: PackRule = {
  id: 'hotels-franchise-term',
  version: '1',
  evidenceTypes: [HOTEL_AGREEMENT, HOTEL_OPERATING, HOTEL_BENCHMARK],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const from = measuredFrom(evidence, pages);
    if (!from) return [];
    const franchises = hotelAgreements(evidence).filter((agreement) => agreement.kind === 'FRANCHISE');
    return agreementTerms(franchises, pages, from.date).flatMap((term): PackRuleProposal[] => {
      const { agreement, endsOn, monthsAfter, penalty } = term;
      if (!endsOn || monthsAfter === null || monthsAfter >= FRANCHISE_MIN_TERM_MONTHS) return [];
      const when = monthsAfter < 0 ? 'before closing' : `${yearsAfter(monthsAfter)} after closing`;
      const penaltyWords = penalty
        ? `Leaving the brand early costs ${penalty.currency ? `${penalty.currency} ` : ''}${grouped(penalty.amount)} (${penalty.basis === 'DOCUMENT' ? 'as the agreement states' : 'from the agreements register'}). `
        : 'No early-termination penalty is stated in the agreement or the register. ';
      const quotes = [term.endQuote, penalty?.quote ?? null, ...term.terminationQuotes, from.quote].filter((quote): quote is PackRuleQuote => quote !== null);
      return [
        {
          key: `${agreement.agreementId}:${endsOn}`,
          domain: 'LEGAL',
          title: `The franchise ends ${when}: ${agreement.counterparty}`,
          description:
            `${agreement.agreementId} with ${agreement.counterparty} ends on ${longDate(endsOn)} (${term.endBasis === 'DOCUMENT' ? 'as the agreement states' : 'from the agreements register'}), ${when}, measured from ${fromWords(from)}. ` +
            penaltyWords +
            `${agreement.feeRate ? `It charges a royalty of ${percent(agreement.feeRate)}${agreement.otherFeeRate ? ` and ${percent(agreement.otherFeeRate)} in marketing and reservation fees` : ''}. ` : ''}` +
            `With less than ${FRANCHISE_MIN_TERM_MONTHS / 12} years of term left, a renewal (and the brand's PIP that comes with it) or a re-flag falls inside the hold: test both in the scenarios, price the penalty and the renewal capex, or make an extension a closing condition. Dates and arithmetic only; no view on the flag.`,
          severity: monthsAfter < 36 || penalty !== null ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'Re-licensing or a re-flag inside the hold, with a penalty for leaving early: the reviewer prices the renewal and the penalty.',
          evidenceIds: [agreement.id],
          quotes,
        },
      ];
    });
  },
};

/**
 * The brand's PIP against the owner's capex budget: items due on or before twelve months after the expected
 * closing that the budget does not fully fund are drafted as one finding, priced as an escrow at the unbudgeted
 * amount — a holdback for timing, alongside the whole PIP the T-067 check already prices as remediation. Waits for
 * the documents (they state the closing).
 */
export const HOTELS_PIP_DUE: PackRule = {
  id: 'hotels-pip-schedule',
  version: '1',
  evidenceTypes: [HOTEL_PIP_ITEM, HOTEL_CAPEX_BUDGET, HOTEL_OPERATING, HOTEL_BENCHMARK],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const from = measuredFrom(evidence, pages);
    const items = pipItems(evidence);
    if (!from || items.length === 0) return [];
    const due = nearTermUnbudgeted(items, from.date);
    if (due.length === 0) return [];
    const unbudgeted = due.reduce((total, item) => total.plus(item.unbudgeted), new D(0));
    const total = items.reduce((all, item) => all.plus(item.cost), new D(0));
    const stated = statedPipTotal(pages);
    const currency = stated?.currency ?? null;
    const lines = due.map((item) => `${item.itemId}${item.description ? ` (${item.description})` : ''}: ${grouped(item.cost)} due ${longDate(item.dueOn)}, ${item.budgeted.isZero() ? 'not in the capex budget' : `${grouped(item.budgeted)} budgeted`}`);
    return [
      {
        key: `${from.date}:${due.map((item) => `${item.itemId}=${item.unbudgeted.toFixed(2)}`).join(',')}`,
        domain: 'PROPERTY',
        title: `PIP due within ${PIP_NEAR_TERM_MONTHS} months of closing and unbudgeted: ${due.map((item) => item.itemId).join(', ')}`,
        description:
          `${lines.join('; ')}. ${grouped(unbudgeted)} of PIP work falls due by ${longDate(nearTermEnd(from.date))}, ${PIP_NEAR_TERM_MONTHS} months after ${fromWords(from)}, with no budget line funding it. ` +
          `The PIP schedule totals ${grouped(total)}${stated ? `; the documents state: “${stated.quote.quote}”` : ''}. ` +
          'The owner must fund it in the first year of ownership: hold the unbudgeted amount back in escrow, or have the seller complete it before closing.',
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: currency ? { type: 'ESCROW', currency, low: unbudgeted.toFixed(2), high: unbudgeted.toFixed(2), basis: 'The PIP items due within twelve months of closing that the capex budget does not fund.' } : null,
        directionRationale: 'Brand-required capital due in the first year that the budget does not fund: a holdback the reviewer sizes.',
        evidenceIds: cite(due.flatMap((item) => [item.id, ...item.budgetIds])),
        ...(stated || from.quote ? { quotes: [stated?.quote ?? null, from.quote].filter((quote): quote is PackRuleQuote => quote !== null) } : {}),
      },
    ];
  },
};

function nearTermEnd(from: string): string {
  const [year = 0, month = 1, day = 1] = from.split('-').map(Number);
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The management (operator) agreement: sentences that bind a buyer — rights or terms that survive a sale of the
 * hotel — are a drag the reviewer prices or clears before closing, with the agreement's term from the register.
 */
export const HOTELS_MANAGEMENT_SURVIVAL: PackRule = {
  id: 'hotels-management-survival',
  version: '1',
  evidenceTypes: [HOTEL_AGREEMENT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const surviving = survivingTerms(pages);
    if (surviving.length === 0) return [];
    const management = hotelAgreements(evidence).find((agreement) => agreement.kind === 'MANAGEMENT') ?? null;
    return [
      {
        key: surviving.map((quote) => `${quote.documentId}:${quote.pageNumber}`).join(','),
        domain: 'LEGAL',
        title: `Management agreement terms survive a sale${management ? `: ${management.counterparty}` : ''}`,
        description:
          `The management agreement says: ${surviving.map((quote) => `“${quote.quote}”`).join(' ')} ` +
          (management
            ? `${management.agreementId} runs to ${management.expiresOn ? longDate(management.expiresOn) : 'no stated end'}${management.feeRate ? `, with a base fee of ${percent(management.feeRate)}${management.otherFeeRate ? ` and an incentive fee of ${percent(management.otherFeeRate)}` : ''}` : ''}. `
            : '') +
          'A buyer takes the hotel subject to these terms: price them, or make their release a closing condition. The agreement’s words only; no legal view.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Operator rights that bind the buyer after closing: the reviewer prices them or makes their release a closing condition.',
        evidenceIds: management ? [management.id] : [],
        quotes: surviving.slice(0, 3),
      },
    ];
  },
};

/**
 * Brand fees against rooms revenue across the imported P&L years: franchise, royalty, marketing and reservation
 * fees ÷ rooms revenue rising every year, to 1.15× its first year or more — fees growing faster than the revenue
 * they are charged on, which one year's P&L hides.
 */
export const HOTELS_BRAND_FEE_TREND: PackRule = {
  id: 'hotels-brand-fee-trend',
  version: '1',
  evidenceTypes: [PNL_LINE],
  detect: ({ evidence }) => {
    const years = brandFeeYears(evidence);
    if (!brandFeesOutpacing(years)) return [];
    const first = years[0];
    const last = years.at(-1);
    if (!first || !last) return [];
    const growth = (of: (year: (typeof years)[number]) => Decimal) => (of(first).isZero() ? null : of(last).div(of(first)).minus(1));
    return [
      {
        key: `${first.year}-${last.year}`,
        domain: 'FINANCIAL',
        title: `Brand fees growing faster than rooms revenue, ${first.year}–${last.year}`,
        description:
          `Franchise, royalty, marketing and reservation fees as a share of rooms revenue: ${years.map((year) => `${year.year} ${pct1(year.ratio)} (${grouped(year.brandFees)} on ${grouped(year.roomsRevenue)})`).join(', ')}. ` +
          `Brand fees grew ${pct1(growth((year) => year.brandFees))} while rooms revenue grew ${pct1(growth((year) => year.roomsRevenue))}, to ${pct1(last.ratio && first.ratio ? last.ratio.div(first.ratio) : null)} of the first year’s ratio (the threshold is ${percent(new D(BRAND_FEE_OUTPACING_FACTOR))}). ` +
          'From the imported P&L lines by year. Carry the latest ratio, and the franchise agreement’s fee schedule, in the scenarios rather than an average year.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Fees rising faster than the revenue they are charged on compress margin after closing: an assumption the reviewer prices.',
        evidenceIds: cite(years.flatMap((year) => [...year.feeIds, ...year.roomsIds])),
      },
    ];
  },
};

export const [HOTELS_PNL_TREND, HOTELS_PNL_MARGIN_DRIFT, HOTELS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('hotels', HOTELS_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/** Five years of history: occupancy, ADR and RevPAR by calendar year from the operating history, beside the P&L. */
export const HOTELS_DRIVERS = {
  occupancy: { key: 'occupancy', label: 'Occupancy', unit: 'RATIO', evidenceType: HOTEL_OPERATING, mode: 'RATIO', numerator: ['rooms_sold'], denominator: ['rooms_available'], formula: 'Σ rooms sold ÷ Σ rooms available in the year' },
  adr: { key: 'adr', label: 'ADR', unit: 'MONEY', evidenceType: HOTEL_OPERATING, mode: 'RATIO', numerator: ['room_revenue'], denominator: ['rooms_sold'], formula: 'Σ room revenue ÷ Σ rooms sold in the year' },
  revpar: { key: 'revpar', label: 'RevPAR', unit: 'MONEY', evidenceType: HOTEL_OPERATING, mode: 'RATIO', numerator: ['room_revenue'], denominator: ['rooms_available'], formula: 'Σ room revenue ÷ Σ rooms available in the year' },
} as const satisfies Record<string, DriverSpec>;

export const HOTELS_HISTORY: PackHistorySpec = {
  drivers: [HOTELS_DRIVERS.occupancy, HOTELS_DRIVERS.adr, HOTELS_DRIVERS.revpar],
  keyExpenses: HOTELS_KEY_EXPENSES,
  driverImport: 'HOTELS_OPERATING_HISTORY',
  driverLabel: 'Operating history',
  driverWhat: 'operating history',
  keyDriver: 'occupancy',
};

/** RevPAR falling every year by this share or more, first year to last (5%). */
export const REVPAR_DECLINE_SHARE = '0.05';

export const HOTELS_REVPAR_TREND = driverTrendRule(
  {
    id: 'hotels-revpar-trend',
    driver: HOTELS_DRIVERS.revpar,
    adverse: 'DOWN',
    threshold: REVPAR_DECLINE_SHARE,
    domain: 'COMMERCIAL',
    advice: 'The hotel earns less per available room each year: check the comp-set index and the STR reports before projecting RevPAR forward.',
  },
  HOTELS_HISTORY,
);

export const HOTELS_RULES: readonly PackRule[] = [
  HOTELS_BRAND_PIP,
  HOTELS_REVPAR_GAP,
  HOTELS_CHANNEL_CONCENTRATION,
  HOTELS_SEASONAL_DEMAND,
  HOTELS_MANAGEMENT_TERMINATION_FEE,
  HOTELS_PERFORMANCE_CLAIMS,
  HOTELS_FRANCHISE_TERM,
  HOTELS_PIP_DUE,
  HOTELS_MANAGEMENT_SURVIVAL,
  HOTELS_BRAND_FEE_TREND,
  HOTELS_PNL_TREND,
  HOTELS_PNL_MARGIN_DRIFT,
  HOTELS_PNL_EXPENSE_OUTPACING,
  HOTELS_REVPAR_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('hotels', HOTELS_HISTORY),
];
export const HOTELS_EVIDENCE = { OPERATING, BENCHMARK, AGREEMENT: HOTEL_AGREEMENT, PIP_ITEM: HOTEL_PIP_ITEM, CAPEX_BUDGET: HOTEL_CAPEX_BUDGET } as const;
