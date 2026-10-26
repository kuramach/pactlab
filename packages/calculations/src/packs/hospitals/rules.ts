import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, monthName, percent } from '../common';
import { MAX_CITED, type PackRule } from '../rule-types';

/**
 * Hospitals pack rules (T-069, spec §19; extends healthcare, T-061). Census and
 * payer data are aggregates; physician dependence comes only from aggregate
 * documents; no patient data, and nothing here reaches a model (rule 7).
 */
const CENSUS = 'hospitals.census_month';
const PAYER = 'hospitals.payer_month';

/** One payer's share of the latest month's net revenue, from the payer-mix extract. */
export const HOSPITALS_PAYER_CONCENTRATION: PackRule = {
  id: 'hospitals-payer-concentration',
  version: '1',
  evidenceTypes: [PAYER],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === PAYER && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
    const month = rows.map((row) => row.canonical['month'] ?? '').sort().at(-1);
    const inMonth = rows.filter((row) => row.canonical['month'] === month);
    const total = inMonth.reduce((sum, row) => sum.plus(amountOf(row, 'net_revenue')), new D(0));
    const top = [...inMonth].sort((a, b) => amountOf(b, 'net_revenue').comparedTo(amountOf(a, 'net_revenue')) || (a.canonical['payer'] ?? '').localeCompare(b.canonical['payer'] ?? ''))[0];
    if (!month || !top || !total.gt(0)) return [];
    const share = amountOf(top, 'net_revenue').div(total);
    if (share.lt('0.4')) return [];
    return [
      {
        key: `${month}:${top.canonical['payer']}`,
        domain: 'COMMERCIAL',
        title: 'Earnings concentrated in one payer',
        description: `${top.canonical['payer']} is ${percent(share)} of ${monthName(month)} net revenue (${grouped(total)} in the month in the deal's currency). A rate change by that payer moves earnings directly — test it in a payer-mix-adjusted EBITDA scenario.`,
        severity: share.gte('0.5') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A payer-mix and reimbursement-rate sensitivity in the valuation, not a price term.',
        evidenceIds: rows.filter((row) => row.canonical['payer'] === top.canonical['payer']).slice(-MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

export const HOSPITALS_ACCREDITATION_TRANSFER = documentClauseRule({
  id: 'hospitals-accreditation-transfer',
  title: 'Accreditation does not transfer automatically',
  domain: 'REGULATORY',
  severity: 'HIGH',
  direction: 0,
  directionRationale: 'A closing condition (application and survey on change of ownership), not a price term.',
  sentences: [(sentence) => /accreditation/i.test(sentence) && /(does not|doesn.t|will not) transfer/i.test(sentence)],
  description: ([condition]) => `The hospital's accreditation needs a new application on a change of ownership — make it a closing condition: “${condition}”`,
});

export const HOSPITALS_PHYSICIAN_DEPENDENCE = documentClauseRule({
  id: 'hospitals-physician-dependence',
  title: 'Key-physician dependence',
  domain: 'PEOPLE',
  severity: 'HIGH',
  direction: -1,
  directionRationale: 'Retention arrangements for the physicians as a closing condition, or a price adjustment the reviewer sets.',
  sentences: [(sentence) => /\b(physicians?|surgeons?|cardiologists?|specialists?)\b/i.test(sentence) && /(perform|account for|carry)[^.]*\b\d{2,3}\s*%/i.test(sentence)],
  description: ([dependence]) => `A few physicians carry a service line (aggregate staffing data, no individual records): “${dependence}”`,
});

export const HOSPITALS_REGULATORY_CAPEX = documentClauseRule({
  id: 'hospitals-regulatory-capex',
  title: 'Committed regulatory capex',
  domain: 'REGULATORY',
  severity: 'HIGH',
  direction: -1,
  directionRationale: 'Capital already committed to meet regulation: a remediation cost on the bridge.',
  sentences: [(sentence) => /committed regulatory capital expenditure/i.test(sentence)],
  description: ([capex]) => `The cost report shows regulatory capital expenditure already committed: “${capex}”`,
  price: { type: 'REMEDIATION_COST', basis: 'Committed regulatory capex stated in the cost report summary.', after: /committed regulatory capital expenditure/i },
});

export const HOSPITALS_RULES: readonly PackRule[] = [HOSPITALS_PAYER_CONCENTRATION, HOSPITALS_ACCREDITATION_TRANSFER, HOSPITALS_PHYSICIAN_DEPENDENCE, HOSPITALS_REGULATORY_CAPEX];
export const HOSPITALS_EVIDENCE = { CENSUS, PAYER } as const;
