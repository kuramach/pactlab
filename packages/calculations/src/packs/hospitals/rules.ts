import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, monthName, percent } from '../common';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  CAPEX_FALL_FACTOR,
  capexYears,
  CENSUS_MONTH,
  COST_REPORT_CLAIM_TOLERANCE,
  COST_REPORT_FIGURE_LABELS,
  costReportReconciliations,
  costReports,
  conditionAssessments,
  deckFigures,
  departmentClusters,
  HOSPITALS_KEY_EXPENSES,
  hospitalsAnalysisDate,
  MEDICAL_STAFF,
  medicalStaff,
  modernPlantClaim,
  PAYER_MONTH,
  hospitalPayerContracts,
  PRIVILEGES_DUE_DAYS,
  qualityClaims,
  qualityReports,
  staffStatuses,
  type CostReportReading,
  type DeckFigure,
} from './operations';

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

// ---------------------------------------------------------------- cost reports, contracts, staff, plant, quality (T-162, ADR 0053)

type Decimal = InstanceType<typeof D>;
const pct1 = (value: Decimal | null) => (value === null ? 'n/a' : percent(value));
const points = (value: Decimal) => `${value.toFixed(1)}%`;
const uniqueQuotes = (quotes: readonly (PackRuleQuote | null | undefined)[]) =>
  quotes.filter((quote, index, all): quote is PackRuleQuote => !!quote && all.findIndex((other) => other?.quote === quote.quote && other.pageNumber === quote.pageNumber && other.documentId === quote.documentId) === index);

function costReportClaim(figure: DeckFigure, status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED', basis: string, report: CostReportReading | null): PackRuleProposal {
  const label = COST_REPORT_FIGURE_LABELS[figure.key];
  const record = { statement: figure.quote.quote, status, rationale: basis };
  const quotes = uniqueQuotes([figure.quote, report?.figures.find((entry) => entry.key === figure.key)?.quote, report?.heading]);
  if (status === 'UNVERIFIED')
    return {
      key: `${figure.key}:unverified`,
      domain: 'FINANCIAL',
      title: `Claim not verified against a cost report: ${label}`,
      description: `The document states “${figure.quote.quote}” ${basis} Ask the seller for the filed cost report before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: a figure no filed cost report states is neither priced nor relied on.',
      evidenceIds: [],
      quotes,
      claim: record,
    };
  if (status === 'VERIFIED')
    return {
      key: `${figure.key}:verified`,
      domain: 'FINANCIAL',
      title: `Claim verified against the cost report: ${label}`,
      description: `“${figure.quote.quote}” agrees with the filed cost report. ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${label} verified against the filed cost report`, impliedValue: null, basis },
      directionRationale: 'Confirmed value in the buyer-confidential ledger, never a price increase.',
      evidenceIds: [],
      quotes,
      claim: record,
    };
  return {
    key: `${figure.key}:contradicted`,
    domain: 'FINANCIAL',
    title: `The cost report contradicts the deck: ${label}`,
    description: `The deck states “${figure.quote.quote}” ${basis} The filed cost report governs: rebuild the scenarios on its figure, and ask the seller to explain the difference.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'An operating assumption the deck overstates: a haircut on the volume or mix the scenarios assume.',
    evidenceIds: [],
    quotes,
    claim: record,
  };
}

/**
 * Cost-report reconciliation: occupancy and the payer shares of inpatient days the deck states, against
 * the filed cost report for the year (the report governs) — verified within a point, contradicted beyond
 * three, a gap with no cost report — and the cost report's total costs against the imported P&L for the
 * same fiscal year, beyond 2% a finding. Figures and sentences only: never a view on reimbursement.
 */
export const HOSPITALS_COST_REPORT_RECONCILIATION: PackRule = {
  id: 'hospitals-cost-report-reconciliation',
  version: '1',
  evidenceTypes: [PNL_LINE, CENSUS_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const reports = costReports(pages);
    const latest = [...reports].sort((a, b) => (a.fiscalYear ?? '').localeCompare(b.fiscalYear ?? '')).at(-1) ?? null;
    const claims = deckFigures(pages).flatMap((figure): PackRuleProposal[] => {
      if (reports.length === 0) return [costReportClaim(figure, 'UNVERIFIED', 'No filed cost report is in the documents to check it against.', null)];
      const report = (figure.year ? reports.find((entry) => entry.fiscalYear === figure.year) : null) ?? latest;
      const stated = report?.figures.find((entry) => entry.key === figure.key);
      if (!report || !stated) return [costReportClaim(figure, 'UNVERIFIED', `The filed cost report${report?.fiscalYear ? ` for fiscal year ${report.fiscalYear}` : ''} states no ${COST_REPORT_FIGURE_LABELS[figure.key].toLowerCase()}.`, report ?? null)];
      const off = figure.value.minus(stated.value).abs();
      const basis = `The filed cost report${report.fiscalYear ? ` for fiscal year ${report.fiscalYear}` : ''} states ${points(stated.value)} (“${stated.quote.quote}”); the deck states ${points(figure.value)}, ${off.toFixed(1)} points ${figure.value.gt(stated.value) ? 'higher' : 'lower'}.`;
      if (off.lte(COST_REPORT_CLAIM_TOLERANCE.verified)) return [costReportClaim(figure, 'VERIFIED', basis, report)];
      if (off.gt(COST_REPORT_CLAIM_TOLERANCE.contradicted)) return [costReportClaim(figure, 'CONTRADICTED', basis, report)];
      return [];
    });
    const unreconciled = costReportReconciliations(evidence, pages)
      .filter((entry) => !entry.agrees)
      .map((entry): PackRuleProposal => {
        const total = entry.report.figures.find((figure) => figure.key === 'TOTAL_COSTS');
        return {
          key: `${entry.report.documentId}:${entry.fiscalYear}:costs`,
          domain: 'FINANCIAL',
          title: `The cost report and the P&L disagree on fiscal year ${entry.fiscalYear} costs`,
          description:
            `The filed cost report states total costs of ${grouped(entry.costReportCosts)}${total?.currency ? ` ${total.currency}` : ''} for fiscal year ${entry.fiscalYear}; the imported P&L’s cost of revenue and operating expenses for the year are ${grouped(entry.pnlCosts)}, ` +
            `${grouped(entry.difference.abs())} (${pct1(entry.share)}) ${entry.difference.gt(0) ? 'more' : 'less'}. Reconcile the two before relying on either for EBITDA.`,
          severity: entry.share.gte('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'An unreconciled cost base: a haircut on the EBITDA the scenarios assume until the two agree.',
          evidenceIds: entry.evidenceIds.slice(0, MAX_CITED),
          quotes: uniqueQuotes([total?.quote, entry.report.heading]),
        };
      });
    return [...claims, ...unreconciled];
  },
};

/**
 * The payer contract register: each material contracted payer in the payer-mix export (5% or more of
 * trailing net revenue), with its agreement read from the documents — the rate basis, the end of the term
 * and the renewal window. A term ending inside twelve months of closing (a document's stated closing date,
 * else the analysis date) with no automatic renewal, or already ended, is a drag: the payer renegotiates
 * its rates early in the hold. HIGH for the largest contracted payer. Dates only, never a reading in law.
 */
export const HOSPITALS_PAYER_CONTRACTS: PackRule = {
  id: 'hospitals-payer-contracts',
  version: '1',
  evidenceTypes: [PAYER_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const { from, payers } = hospitalPayerContracts(evidence, pages);
    if (!from) return [];
    const measured = from.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${from.date}` : `${from.date}, the end of the latest month in the exports (no document states a closing date)`;
    return payers.flatMap((status): PackRuleProposal[] => {
      const { payer, agreement } = status;
      if (!status.material || !agreement?.expiresOn || (status.state !== 'EXPIRES_WITHIN_YEAR' && status.state !== 'EXPIRED_AT_CLOSE')) return [];
      const expired = status.state === 'EXPIRED_AT_CLOSE';
      const months = status.monthsAfterClose ?? 0;
      const title = expired
        ? `${status.largestContracted ? 'Largest payer contract' : 'Payer contract'} ends before closing: ${payer.payer}`
        : `${status.largestContracted ? 'Largest payer contract' : 'Payer contract'} ends ${months} month${months === 1 ? '' : 's'} after closing: ${payer.payer}`;
      return [
        {
          key: `${payer.payer}:${agreement.expiresOn}:${expired ? 'expired' : 'expiring'}`,
          domain: 'COMMERCIAL',
          title,
          description:
            `${payer.payer} paid ${grouped(payer.netRevenue)} of net revenue over the trailing twelve months, ${pct1(payer.share)} of the payer mix${status.largestContracted ? ', the largest contracted payer' : ''}. ` +
            `Its agreement ${expired ? 'ended' : 'ends'} on ${agreement.expiresOn}, ${expired ? 'before' : `${months} whole month${months === 1 ? '' : 's'} after`} ${measured}` +
            (agreement.rateBasis ? `; it pays on this basis: “${agreement.rateBasis.quote}”` : '; no sentence in it states the rate basis') +
            (agreement.renegotiation ? `; renewal: “${agreement.renegotiation.quote}”` : '; it states no renewal or renegotiation window') +
            `. The payer renegotiates its rates ${expired ? 'before' : 'within the first year after'} closing: test a rate change for it in a payer-mix-adjusted EBITDA scenario, or make a renewed agreement a closing condition.`,
          severity: status.largestContracted || (payer.share?.gte('0.15') ?? false) ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          directionRationale: 'A rate renegotiation early in the hold: a haircut on that payer’s revenue in the scenarios, or a renewed agreement as a closing condition.',
          evidenceIds: payer.rows.slice(-MAX_CITED).map((row) => row.id),
          quotes: uniqueQuotes([agreement.heading, agreement.expiry, agreement.rateBasis, agreement.renegotiation, from.quote]),
        },
      ];
    });
  },
};

/**
 * The medical-staff register at hospital scale (the healthcare credentialing pattern): licences and
 * clinical privileges by pseudonymous reference at the analysis date. A department whose staff's
 * privileges lapsed together — three or more on one reappointment date — is a drag (the department may
 * not be able to admit or operate); privileges falling due together within 90 days are a closing
 * deliverable; licences expired at the analysis date (a verification document's date governs) are a drag.
 * Dates only: never a judgment on a physician's competence.
 */
export const HOSPITALS_MEDICAL_STAFF: PackRule = {
  id: 'hospitals-medical-staff',
  version: '1',
  evidenceTypes: [MEDICAL_STAFF, CENSUS_MONTH, PAYER_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const asOf = hospitalsAnalysisDate(evidence);
    const rows = medicalStaff(evidence);
    if (!asOf || rows.length === 0) return [];
    const clusters = departmentClusters(rows, asOf).map((cluster): PackRuleProposal => {
      const lapsed = cluster.state === 'LAPSED';
      const refs = cluster.staff.map((row) => row.staffRef);
      return {
        key: `${cluster.department}:${cluster.date}:${lapsed ? 'lapsed' : 'due'}`,
        domain: 'REGULATORY',
        title: lapsed ? `${cluster.department}: clinical privileges lapsed together for ${cluster.staff.length} medical staff on ${cluster.date}` : `${cluster.department}: clinical privileges for ${cluster.staff.length} medical staff fall due together on ${cluster.date}`,
        description:
          `In the medical-staff register, ${cluster.staff.length} of the ${cluster.departmentSize} ${cluster.department} staff (${refs.join(', ')}) share one privilege reappointment date, ${cluster.date}, ` +
          (lapsed
            ? `which passed before ${asOf}, the end of the latest month in the exports, with no reappointment recorded. A department whose privileges lapse together may not be able to admit or operate: confirm the reappointments with the medical staff office, and make them a closing condition or price the volume at risk.`
            : `within ${PRIVILEGES_DUE_DAYS} days of ${asOf}. Make the reappointments a closing deliverable.`) +
          ' Dates from the register only, never a view on any physician.',
        severity: lapsed ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: lapsed ? -1 : 0,
        pricedRisk: null,
        directionRationale: lapsed ? 'Volume at risk in the department until reappointed: a closing condition or a holdback the reviewer prices.' : 'A closing deliverable (reappointment before close), not a price adjustment.',
        evidenceIds: cluster.staff.slice(0, MAX_CITED).map((row) => row.id),
      };
    });
    const expired = staffStatuses(rows, pages, asOf).filter((status) => status.licenceExpired);
    const licences: PackRuleProposal[] = expired.length
      ? [
          {
            key: `licences:${expired.map((status) => status.row.staffRef).join(',')}:expired`,
            domain: 'REGULATORY',
            title: `${expired.length} medical-staff licence${expired.length === 1 ? '' : 's'} expired at ${asOf}`,
            description: `${expired.map((status) => `${status.row.staffRef} (${status.row.department}, licence ${status.licenceExpiresOn ?? status.row.licenceStatus})`).join('; ')}. A verification document's date governs over the register where one names the reference. Confirm renewal with the issuing board before closing; whether any work after expiry was lawful is for counsel.`,
            severity: 'HIGH',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            directionRationale: 'Renewal before close, or an indemnity the reviewer prices for any work after expiry.',
            evidenceIds: expired.slice(0, MAX_CITED).map((status) => status.row.id),
            quotes: uniqueQuotes(expired.map((status) => status.licenceVerified)),
          },
        ]
      : [];
    return [...clusters, ...licences];
  },
};

/**
 * The plant and capex trend: capital spend on plant and equipment as a share of revenue in every fiscal
 * year the imported P&L holds, falling every year to three quarters of its first-year ratio or less — the
 * deferred capex a single year hides — with the deck's "modern plant" claim set against it and the
 * property condition assessment's statements as evidence. Priced as remediation at the deferred
 * maintenance the assessment states, when it states one; otherwise the reviewer prices it.
 */
export const HOSPITALS_PLANT_CAPEX: PackRule = {
  id: 'hospitals-plant-capex',
  version: '1',
  evidenceTypes: [PNL_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const { years } = capexYears(evidence);
    const ratios = years.map((year) => year.ratio);
    if (years.length < 2 || ratios.some((value) => value === null)) return [];
    const series = ratios as Decimal[];
    const first = series[0] as Decimal;
    const last = series.at(-1) as Decimal;
    const fallingEveryYear = series.every((value, index) => index === 0 || value.lt(series[index - 1] as Decimal));
    if (!fallingEveryYear || last.gt(first.times(CAPEX_FALL_FACTOR))) return [];
    const claim = modernPlantClaim(pages);
    const assessments = conditionAssessments(pages);
    const statements = assessments.flatMap((assessment) => assessment.statements).slice(0, 3);
    const deferred = assessments.find((assessment) => assessment.deferredMaintenance)?.deferredMaintenance ?? null;
    const span = `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`;
    const byYear = years.map((year) => `${year.year} ${pct1(year.ratio)} (${grouped(year.amount)})`).join(', ');
    return [
      {
        key: `capex:${years.map((year) => year.year).join(',')}`,
        domain: 'PROPERTY',
        title: claim ? `Capital spend fell from ${pct1(first)} to ${pct1(last)} of revenue, ${span}, against a “modern plant” claim` : `Capital spend fell from ${pct1(first)} to ${pct1(last)} of revenue, ${span}`,
        description:
          `From the imported P&L, capital spend on plant and equipment as a share of revenue: ${byYear}. It fell every year, to ${pct1(last.div(first))} of its ${years[0]?.year ?? ''} ratio; one year alone does not show it.` +
          (claim ? ` The deck says: “${claim.quote}”` : '') +
          (statements.length ? ` The property condition assessment says: ${statements.map((quote) => `“${quote.quote}”`).join(' ')}` : ' No property condition assessment is in the documents; ask for one.') +
          ' Deferred capex lands on the buyer after closing: price it as remediation, or hold it back.',
        severity: claim || statements.length ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: deferred
          ? { type: 'REMEDIATION_COST', currency: deferred.currency, low: deferred.amount.toFixed(2), high: deferred.amount.toFixed(2), basis: 'Deferred maintenance stated in the property condition assessment.' }
          : null,
        directionRationale: 'Deferred capex the buyer funds after closing: a remediation cost on the bridge, priced from the condition assessment or by the reviewer.',
        evidenceIds: [...new Set(years.flatMap((year) => year.evidenceIds))].slice(0, MAX_CITED),
        quotes: uniqueQuotes([claim, ...statements, deferred?.quote]),
      },
    ];
  },
};

/**
 * Quality-reporting claims: each star rating the deck states, as a claims-register entry mapped to the
 * quality-reporting documents supplied — verified when the reporting states the same overall rating,
 * contradicted when it states another, unverified when no reporting document is supplied. The stated
 * rating only: never a view on the quality of care, and never a prediction of a survey.
 */
export const HOSPITALS_QUALITY_CLAIMS: PackRule = {
  id: 'hospitals-quality-claims',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const reports = qualityReports(pages);
    const rated = reports.find((report) => report.stars) ?? null;
    return qualityClaims(pages).map((claim): PackRuleProposal => {
      const base = { domain: 'REGULATORY' as const, confidence: 'HIGH' as const, evidenceIds: [] };
      if (!rated?.stars) {
        const basis = reports.length ? 'The quality-reporting documents supplied state no overall star rating.' : 'No quality-reporting document is in the documents to check it against.';
        return {
          ...base,
          key: `stars:${claim.stars}:unverified`,
          title: 'Quality claim not verified: overall star rating',
          description: `The deck states “${claim.quote.quote}” ${basis} Ask the seller for the published reporting before relying on it.`,
          severity: 'MEDIUM',
          direction: 0,
          directionRationale: 'A gap, not a defect: a claim with no reporting behind it is neither priced nor relied on.',
          quotes: uniqueQuotes([claim.quote, ...reports.map((report) => report.heading)]),
          claim: { statement: claim.quote.quote, status: 'UNVERIFIED', rationale: basis },
        };
      }
      const basis = `The quality reporting supplied states ${rated.stars.value} star${rated.stars.value === 1 ? '' : 's'}: “${rated.stars.quote.quote}”`;
      const quotes = uniqueQuotes([claim.quote, rated.stars.quote, rated.heading]);
      if (rated.stars.value === claim.stars)
        return {
          ...base,
          key: `stars:${claim.stars}:verified`,
          title: 'Quality claim verified: overall star rating',
          description: `“${claim.quote.quote}” agrees with the reporting. ${basis} The stated rating only, not a view on the quality of care.`,
          severity: 'LOW',
          direction: 1,
          valueConfirmation: { valueDriver: 'Overall star rating verified against the published quality reporting', impliedValue: null, basis },
          directionRationale: 'Confirmed value in the buyer-confidential ledger, never a price increase.',
          quotes,
          claim: { statement: claim.quote.quote, status: 'VERIFIED', rationale: basis },
        };
      return {
        ...base,
        key: `stars:${claim.stars}:contradicted`,
        title: 'Quality claim contradicted: overall star rating',
        description: `The deck states “${claim.quote.quote}” ${basis} Ask the seller to explain the difference; the stated rating only, not a view on the quality of care.`,
        severity: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'A marketing claim the reporting does not support: a haircut on the volume and payer terms the rating was said to win.',
        quotes,
        claim: { statement: claim.quote.quote, status: 'CONTRADICTED', rationale: basis },
      };
    });
  },
};

export const [HOSPITALS_PNL_TREND, HOSPITALS_PNL_MARGIN_DRIFT, HOSPITALS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('hospitals', HOSPITALS_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

export const HOSPITALS_RULES: readonly PackRule[] = [
  HOSPITALS_PAYER_CONCENTRATION,
  HOSPITALS_ACCREDITATION_TRANSFER,
  HOSPITALS_PHYSICIAN_DEPENDENCE,
  HOSPITALS_REGULATORY_CAPEX,
  HOSPITALS_COST_REPORT_RECONCILIATION,
  HOSPITALS_PAYER_CONTRACTS,
  HOSPITALS_MEDICAL_STAFF,
  HOSPITALS_PLANT_CAPEX,
  HOSPITALS_QUALITY_CLAIMS,
  HOSPITALS_PNL_TREND,
  HOSPITALS_PNL_MARGIN_DRIFT,
  HOSPITALS_PNL_EXPENSE_OUTPACING,
];
export const HOSPITALS_EVIDENCE = { CENSUS, PAYER, MEDICAL_STAFF } as const;
