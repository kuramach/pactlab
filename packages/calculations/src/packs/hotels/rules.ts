import { D } from '../../metrics/decimal';
import { wholeMonths } from '../clinics/practice';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, monthName, percent, revenueConcentrationRule } from '../common';
import { CAPEX_ITEM, capexSchedule } from '../commercial-property/leases';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import type { HoldWindow } from '../pharma/pipeline';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  BRAND_FEE_TREND_FACTOR,
  BRAND_FEE_TREND_MIN_YEARS,
  checkPerformanceClaims,
  franchiseTermCheck,
  HOTELS_KEY_EXPENSES,
  hotelAddMonths,
  hotelFeeYears,
  hotelsHoldWindow,
  hotelYearRun,
  managementReading,
  operatingByYear,
  operatingYear,
  PIP_NEAR_TERM_MONTHS,
  pipChecks,
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

// ---------------------------------------------------------------- franchise, PIP, performance claims, management and brand fees (T-166, ADR 0069)

type Decimal = InstanceType<typeof D>;
const cite = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
const quotesOf = (quotes: readonly (PackRuleQuote | null | undefined)[]) => quotes.filter((quote): quote is PackRuleQuote => Boolean(quote)).slice(0, MAX_CITED);
const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${monthName(`${year}-${month}`)}`;
};
const measuredFrom = (hold: HoldWindow) =>
  hold.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${longDate(hold.from)}` : `${longDate(hold.from)}, the end of the latest month in the exports (no closing date is stated)`;
const holdLabel = (hold: HoldWindow) => `the ${hold.years}-year hold${hold.yearsStated ? ' the documents state' : ' (none is stated; five years assumed)'}`;
const yearsAndMonths = (months: number) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} year${years === 1 ? '' : 's'}` : '', rest ? `${rest} month${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'less than a month';
};
const fiscal = (year: string) => `FY${year}`;
const twelveMonths = (period: { from: string; to: string }) => `${monthName(period.from)} to ${monthName(period.to)}`;
const money2 = (value: Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * The franchise register: the franchise agreement's term measured from the expected closing a document states (else
 * the analysis date) over the hold, with its termination rights, its liquidated damages and its fees as the
 * sentences state them. A term that ends before the closing or inside the hold is a drag (−1): the buyer must renew,
 * re-flag or run independent within the hold, and leaving early costs what the agreement says. A term that runs past
 * the hold is not drafted. Documents and dates only: no view on what the flag is worth.
 */
export const HOTELS_FRANCHISE_TERM: PackRule = {
  id: 'hotels-franchise-term',
  version: '1',
  evidenceTypes: [OPERATING, BENCHMARK, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const check = franchiseTermCheck(evidence, pages);
    if (!check || check.holdYear > check.hold.years) return [];
    const { reading, hold } = check;
    const end = reading.term.end as string;
    const when = check.holdYear === 0 ? 'before the closing' : `in year ${check.holdYear} of the hold`;
    const fees = reading.fees.length ? ` Fees the agreement states: ${reading.fees.map((fee) => `${fee.label.toLowerCase()} ${percent(fee.rate)}`).join(', ')}.` : '';
    const rights = reading.terminationRights.length ? ` Termination rights: ${reading.terminationRights.map((quote) => `“${quote.quote}”`).join(' ')}` : '';
    const penalty = reading.penalty ? ` Leaving early: “${reading.penalty.quote.quote}”` : ' The agreement states no liquidated damages or termination payment.';
    return [
      {
        key: `${end}:${hold.from}:${hold.years}`,
        domain: 'LEGAL',
        title: `Franchise term ends ${when}`,
        description:
          `The franchise agreement’s term ends on ${longDate(end)}, ${check.monthsAfterClosing === null ? 'before the closing' : `${yearsAndMonths(check.monthsAfterClosing)} after ${measuredFrom(hold)}`}, inside ${holdLabel(hold)}: “${reading.term.quote?.quote ?? ''}”` +
          `${penalty}${rights}${fees}` +
          ' Within the hold the buyer must renew on the brand’s terms then (often with a further PIP), re-flag or run the hotel independent: carry that in the scenarios, or make a renewal or extension a closing condition. Documents and dates only; no view on what the flag is worth.',
        severity: check.holdYear <= 3 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'The flag the revenue depends on ends within the hold: a renewal, re-flagging or exit-cost assumption the reviewer sets.',
        evidenceIds: [],
        quotes: quotesOf([reading.term.quote, reading.penalty?.quote, hold.closingQuote, ...reading.terminationRights]),
      },
    ];
  },
};

/**
 * The PIP items against the seller's capex schedule: each item the brand's property improvement plan states, with
 * its completion date and estimate, matched to the schedule by the item it names or by its element. Items due
 * within twelve months of the closing (or before it) that the schedule does not fund, or funds below 90% of the
 * estimate, are a drag priced as an escrow at what is unfunded (−1). Nothing is drafted until the schedule is
 * imported and the plan is read.
 */
export const HOTELS_PIP_SCHEDULE: PackRule = {
  id: 'hotels-pip-schedule',
  version: '1',
  evidenceTypes: [CAPEX_ITEM, OPERATING, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0 || !evidence.some((row) => row.evidenceType === CAPEX_ITEM)) return [];
    const hold = hotelsHoldWindow(evidence, pages);
    const checks = pipChecks(evidence, pages);
    if (!hold || checks.length === 0) return [];
    const limit = hotelAddMonths(hold.from, PIP_NEAR_TERM_MONTHS);
    const near = checks.filter((check) => check.state !== 'BUDGETED' && check.item.due <= limit);
    if (near.length === 0) return [];
    const currencies = new Set(near.map((check) => check.item.currency));
    const currency = currencies.size === 1 ? ([...currencies][0] as string) : null;
    const unfunded = near.reduce((total, check) => total.plus(check.shortfall), new D(0));
    const later = checks.filter((check) => check.state !== 'BUDGETED' && check.item.due > limit);
    const total = checks.reduce((all, check) => all.plus(check.item.amount), new D(0));
    const line = (check: (typeof checks)[number]) =>
      `item ${check.item.number}, ${check.item.description}, due ${longDate(check.item.due)}${check.item.due < hold.from ? ' (before the closing)' : `, ${wholeMonths(hold.from, check.item.due)} months after the closing`}, estimated at ${grouped(check.item.amount)}: ${check.state === 'UNBUDGETED' ? 'no line in the seller’s capex schedule' : `the schedule carries ${grouped(check.scheduledAmount)} (${check.scheduled.map((entry) => `${entry.item}, ${entry.year}`).join('; ')})`}`;
    return [
      {
        key: `${hold.from}:${near.map((check) => `${check.item.number}-${check.item.due}-${check.shortfall.toFixed(2)}`).join(',')}`,
        domain: 'PROPERTY',
        title: 'PIP work due within 12 months of closing is not in the seller’s capex budget',
        description:
          `The property improvement plan sets ${checks.length} item${checks.length === 1 ? '' : 's'}, ${grouped(total)} in all. Due within ${PIP_NEAR_TERM_MONTHS} months of ${measuredFrom(hold)} and not funded by the seller’s capex schedule: ${near.map(line).join('; ')}. ` +
          `${grouped(unfunded)} unfunded in the first year of ownership.` +
          (later.length ? ` Later and also unfunded: ${later.map((check) => `item ${check.item.number} (${grouped(check.shortfall)}, due ${longDate(check.item.due)})`).join(', ')}.` : '') +
          ' Fund it at closing — an escrow, or a price reduction — or have the seller complete it before. The brand-PIP draft prices the whole plan; accept the one that matches how the deal funds it, not both.',
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: currency ? { type: 'ESCROW', currency, low: unfunded.toFixed(2), high: unfunded.toFixed(2), basis: 'PIP items due within twelve months of closing, less what the seller’s capex schedule funds.' } : null,
        directionRationale: 'Brand-mandated capital the buyer funds in the first year of ownership with no budget behind it: an escrow at what is unfunded.',
        evidenceIds: cite(capexSchedule(evidence).map((entry) => entry.row.id)),
        quotes: quotesOf([...near.map((check) => check.item.quote), hold.closingQuote]),
      },
    ];
  },
};

const PERFORMANCE_SOURCE = { STR: 'STR benchmark', OPERATING: 'operating history' } as const;
function performanceClaimProposal(check: PerformanceClaimCheck): PackRuleProposal | null {
  const { claim, status, measured, source, period } = check;
  if (status === 'WITHIN_TOLERANCE') return null;
  const shown = (value: Decimal) =>
    claim.key === 'OCCUPANCY' ? percent(value) : claim.key.endsWith('INDEX') ? value.toFixed(1) : `${claim.currency ?? ''} ${money2(value)}`.trim();
  const formula =
    claim.key === 'REVPAR_INDEX'
      ? 'Σ the hotel’s RevPAR ÷ Σ the competitive set’s, × 100'
      : claim.key === 'OCCUPANCY_INDEX'
        ? 'Σ the hotel’s occupancy ÷ Σ the competitive set’s, × 100'
        : claim.key === 'ADR_INDEX'
          ? 'Σ the hotel’s ADR ÷ Σ the competitive set’s, × 100'
          : claim.key === 'OCCUPANCY'
            ? 'rooms sold ÷ rooms available'
            : claim.key === 'ADR'
              ? 'room revenue ÷ rooms sold'
              : 'room revenue ÷ rooms available';
  const basis = measured && period ? `The ${PERFORMANCE_SOURCE[source]} gives ${shown(measured)} for ${twelveMonths(period)} (${formula}).` : '';
  const record = { statement: claim.quote.quote, status, rationale: basis || (check.gap ?? '') };
  const base = { evidenceIds: cite(check.evidenceIds), quotes: [claim.quote], claim: record } as const;
  if (status === 'UNVERIFIED')
    return {
      ...base,
      key: `${claim.key}:unverified`,
      domain: 'COMMERCIAL',
      title: `Performance claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” ${check.gap ?? ''} Ask the seller for the STR report or the export before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
    };
  if (status === 'VERIFIED')
    return {
      ...base,
      key: `${claim.key}:${claim.value.toString()}:${period?.to}:verified`,
      domain: 'COMMERCIAL',
      title: `Performance claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” holds against the ${PERFORMANCE_SOURCE[source]}. ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the ${PERFORMANCE_SOURCE[source]}`, impliedValue: null, basis },
    };
  const gap = claim.key === 'OCCUPANCY' ? `${claim.value.minus(measured as Decimal).times(100).abs().toFixed(1)} points` : claim.key.endsWith('INDEX') ? `${claim.value.minus(measured as Decimal).abs().toFixed(1)} index points` : percent(claim.value.minus(measured as Decimal).abs().div(measured as Decimal));
  return {
    ...base,
    key: `${claim.key}:${claim.value.toString()}:${period?.to}:contradicted`,
    domain: 'COMMERCIAL',
    title: `The ${PERFORMANCE_SOURCE[source]} contradicts the deck: ${claim.label}`,
    description: `“${claim.quote.quote}” ${basis} That is ${gap} from the claim. Carry the ${PERFORMANCE_SOURCE[source]}’s figure in the scenarios, not the deck’s, and price the gap.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on a performance figure the benchmark or the hotel’s own export does not support; the reviewer prices the gap.',
  };
}

/**
 * The performance claims register (the claims-register pattern of T-083/T-159): RevPAR, ADR and occupancy claims in
 * the deck or memorandum against the trailing twelve months of the operating history, and the RevPAR, occupancy and
 * ADR index claims against the STR benchmark. VERIFIED (+1, confirmed value only), CONTRADICTED (−1) or UNVERIFIED (0),
 * each in the claims register. Agreements, the PIP, STR reports and the extracts are never read as claims.
 */
export const HOTELS_PERFORMANCE_CLAIMS: PackRule = {
  id: 'hotels-performance-claims',
  version: '1',
  evidenceTypes: [OPERATING, BENCHMARK],
  readsDocuments: true,
  detect: ({ evidence, pages }) => checkPerformanceClaims(evidence, pages).flatMap((check) => performanceClaimProposal(check) ?? []),
};

/**
 * The management agreement: its term, base and incentive fees and termination rights as the sentences state them.
 * A term that binds a purchaser of the hotel ("runs with the hotel", "binds any purchaser"), or one that runs past
 * the closing with no right to end it on a sale, survives the sale: a drag (−1) the reviewer prices. The cost to end
 * it on a sale is shown as arithmetic where the agreement states it as a multiple of the base fee.
 */
export const HOTELS_MANAGEMENT_CONTRACT: PackRule = {
  id: 'hotels-management-contract',
  version: '1',
  evidenceTypes: [OPERATING, INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const reading = managementReading(pages);
    const hold = hotelsHoldWindow(evidence, pages);
    if (!reading || !hold) return [];
    const end = reading.term.end;
    const survives = Boolean(reading.survives) || (!reading.terminationOnSale && Boolean(end && end > hold.from));
    if (!survives) return [];
    const operating = operatingYear(evidence);
    const exit =
      reading.terminationOnSale?.multiple && reading.baseFee && operating
        ? ` Ending it on the sale costs ${reading.terminationOnSale.multiple.toString()} × the prior year’s base fee: ${reading.terminationOnSale.multiple.toString()} × ${percent(reading.baseFee.rate)} × ${grouped(operating.grossOperatingRevenue)} of gross operating revenue (${twelveMonths(operating)}, rooms and food and beverage) ≈ ${grouped(reading.terminationOnSale.multiple.times(reading.baseFee.rate).times(operating.grossOperatingRevenue))}, before any other terms.`
        : '';
    const term = end ? `runs to ${longDate(end)}${end > hold.from ? `, ${yearsAndMonths(wholeMonths(hold.from, end))} after ${measuredFrom(hold)}` : ''}` : 'states no end date';
    const fees = [reading.baseFee ? `a base fee of ${percent(reading.baseFee.rate)}` : '', reading.incentiveFee ? `an incentive fee of ${percent(reading.incentiveFee.rate)}` : ''].filter(Boolean).join(' and ');
    return [
      {
        key: `${end ?? 'open'}:${hold.from}:${reading.survives ? 'binds-purchaser' : 'no-sale-termination'}`,
        domain: 'LEGAL',
        title: end ? `Management agreement survives a sale: runs to ${longDate(end)}` : 'Management agreement survives a sale',
        description:
          `The hotel management agreement ${term}${fees ? `, with ${fees}` : ''}. ` +
          (reading.survives ? `It binds a buyer: “${reading.survives.quote}”` : 'It gives the owner no right to end it on a sale.') +
          (reading.terminationOnSale ? ` The owner’s right on a sale: “${reading.terminationOnSale.quote.quote}”` : '') +
          `${exit} The buyer takes the operator and its fees with the hotel unless it pays to end the agreement: carry the fees in NOI and the exit cost in the scenarios, or negotiate the termination before closing.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'An operator contract the buyer inherits with the hotel: fees in NOI or an exit cost the reviewer prices (the termination-fee draft carries the price where one is stated).',
        evidenceIds: cite(operating?.evidenceIds ?? []),
        quotes: quotesOf([reading.term.quote, reading.survives, reading.terminationOnSale?.quote, reading.baseFee?.quote, reading.incentiveFee?.quote]),
      },
    ];
  },
};

/**
 * Franchise and brand fees against rooms revenue across the imported P&L years: the fee lines (royalty, marketing or
 * brand fund, reservation and loyalty) ÷ rooms revenue rising every year, across three or more consecutive fiscal
 * years, to 1.1× its first year or more: the fees grow faster than the rooms revenue they are charged on, the defect a
 * single year's view misses (−1). Occupancy and ADR by year from the operating history are shown beside it.
 */
export const HOTELS_BRAND_FEE_TREND: PackRule = {
  id: 'hotels-brand-fee-trend',
  version: '1',
  evidenceTypes: [PNL_LINE, OPERATING],
  detect: ({ evidence }) => {
    const run = hotelYearRun(hotelFeeYears(evidence));
    if (run.length < BRAND_FEE_TREND_MIN_YEARS) return [];
    const first = run[0] as (typeof run)[number];
    const last = run.at(-1) as (typeof run)[number];
    const risingEvery = run.slice(1).every((year, index) => year.share.gt((run[index] as (typeof run)[number]).share));
    if (!risingEvery || last.share.lt(first.share.times(BRAND_FEE_TREND_FACTOR))) return [];
    const growth = (to: Decimal, from: Decimal) => (from.gt(0) ? to.div(from).minus(1) : new D(0));
    const operating = operatingByYear(evidence);
    const drivers = run
      .map((year) => operating.find((entry) => entry.year === year.year))
      .filter((entry): entry is (typeof operating)[number] => Boolean(entry?.occupancy && entry.adr));
    const alignment = drivers.length
      ? ` The operating history beside it: ${drivers.map((entry) => `${fiscal(entry.year)} occupancy ${percent(entry.occupancy as Decimal)}, ADR ${money2(entry.adr as Decimal)}`).join('; ')}.`
      : '';
    const span = `${fiscal(first.year)}–${fiscal(last.year)}`;
    return [
      {
        key: `${first.year}-${last.year}:${last.share.toFixed(4)}`,
        domain: 'FINANCIAL',
        title: `Franchise and brand fees growing faster than rooms revenue, ${span}`,
        description:
          `From the imported P&L, franchise and brand fees (royalty, marketing, reservation and loyalty lines) ÷ rooms revenue: ${run.map((year) => `${fiscal(year.year)} ${percent(year.share)} (${grouped(year.brandFees)} on ${grouped(year.roomsRevenue)})`).join(', ')}. ` +
          `Rooms revenue grew ${percent(growth(last.roomsRevenue, first.roomsRevenue))} over the years; the fees grew ${percent(growth(last.brandFees, first.brandFees))}.${alignment} ` +
          'It rose every year; the latest year alone does not show it. Ask the seller which fees the brand added or raised, carry the latest rate (or the agreement’s schedule) forward in NOI, and test whether a renewal would raise it again.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'A cost of the flag growing faster than the revenue it is charged on: NOI on the current rate, priced by the reviewer.',
        evidenceIds: cite(run.flatMap((year) => year.evidenceIds)),
      },
    ];
  },
};

export const [HOTELS_PNL_TREND, HOTELS_PNL_MARGIN_DRIFT, HOTELS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('hotels', HOTELS_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/** Five years of history (ADR 0057): occupancy, ADR and RevPAR by year from the operating history, beside the P&L. */
export const HOTELS_DRIVERS = {
  occupancy: {
    key: 'occupancy',
    label: 'Occupancy',
    unit: 'RATIO',
    evidenceType: OPERATING,
    mode: 'RATIO',
    numerator: ['rooms_sold'],
    denominator: ['rooms_available'],
    formula: 'Σ rooms sold ÷ Σ rooms available, from the operating history',
  },
  adr: {
    key: 'adr',
    label: 'Average daily rate (ADR)',
    unit: 'MONEY',
    evidenceType: OPERATING,
    mode: 'RATIO',
    numerator: ['room_revenue'],
    denominator: ['rooms_sold'],
    formula: 'Σ room revenue ÷ Σ rooms sold, from the operating history',
  },
  revpar: {
    key: 'revpar',
    label: 'RevPAR',
    unit: 'MONEY',
    evidenceType: OPERATING,
    mode: 'RATIO',
    numerator: ['room_revenue'],
    denominator: ['rooms_available'],
    formula: 'Σ room revenue ÷ Σ rooms available, from the operating history',
  },
} as const satisfies Record<string, DriverSpec>;

export const HOTELS_HISTORY: PackHistorySpec = {
  drivers: [HOTELS_DRIVERS.occupancy, HOTELS_DRIVERS.adr, HOTELS_DRIVERS.revpar],
  keyExpenses: HOTELS_KEY_EXPENSES,
  driverImport: 'HOTELS_OPERATING_HISTORY',
  driverLabel: 'Operating history',
  driverWhat: 'monthly operating history',
  keyDriver: 'occupancy',
};

/** Occupancy falling every year by this many points or more, first to last. */
export const OCCUPANCY_DECLINE_POINTS = '0.03';
export const HOTELS_OCCUPANCY_TREND = driverTrendRule(
  {
    id: 'hotels-occupancy-trend',
    driver: HOTELS_DRIVERS.occupancy,
    adverse: 'DOWN',
    threshold: OCCUPANCY_DECLINE_POINTS,
    domain: 'COMMERCIAL',
    advice: 'Check it against the STR benchmark: a market-wide fall and lost share price differently. Carry the trend, not the best year, in the scenarios.',
  },
  HOTELS_HISTORY,
);

export const HOTELS_RULES: readonly PackRule[] = [
  HOTELS_BRAND_PIP,
  HOTELS_REVPAR_GAP,
  HOTELS_CHANNEL_CONCENTRATION,
  HOTELS_SEASONAL_DEMAND,
  HOTELS_MANAGEMENT_TERMINATION_FEE,
  HOTELS_FRANCHISE_TERM,
  HOTELS_PIP_SCHEDULE,
  HOTELS_PERFORMANCE_CLAIMS,
  HOTELS_MANAGEMENT_CONTRACT,
  HOTELS_BRAND_FEE_TREND,
  HOTELS_PNL_TREND,
  HOTELS_PNL_MARGIN_DRIFT,
  HOTELS_PNL_EXPENSE_OUTPACING,
  HOTELS_OCCUPANCY_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('hotels', HOTELS_HISTORY),
];
export const HOTELS_EVIDENCE = { OPERATING, BENCHMARK, CAPEX_ITEM } as const;
