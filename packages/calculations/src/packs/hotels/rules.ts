import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, monthName, percent, revenueConcentrationRule } from '../common';
import { MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

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

export const HOTELS_RULES: readonly PackRule[] = [HOTELS_BRAND_PIP, HOTELS_REVPAR_GAP, HOTELS_CHANNEL_CONCENTRATION, HOTELS_SEASONAL_DEMAND, HOTELS_MANAGEMENT_TERMINATION_FEE];
export const HOTELS_EVIDENCE = { OPERATING, BENCHMARK } as const;
