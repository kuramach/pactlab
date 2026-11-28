import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, monthName, percent } from '../common';
import { CREDENTIAL, PAYER_CONTRACT, ROSTER } from '../healthcare/practice';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  amountAfter,
  CAPEX_DECLINE_FACTOR,
  capexFalling,
  checkCostReportClaims,
  checkQualityClaims,
  conditionFindings,
  CONTRACT_WINDOW_MONTHS,
  COST_RECONCILIATION_TOLERANCE,
  COST_REPORT,
  costReconciliations,
  contractRegister,
  HOSPITAL_CAPEX,
  HOSPITAL_CENSUS,
  HOSPITAL_PAYER,
  hospitalCapexYears,
  hospitalsAnalysisDate,
  HOSPITALS_KEY_EXPENSES,
  MATERIAL_PAYER_SHARE,
  modernPlantClaim,
  privilegeClusters,
  rosterGaps,
  staffCredentials,
  type CostReportClaimCheck,
  type QualityClaimCheck,
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


// ---------------------------------------------------------------- cost reports, payer contracts, medical staff, plant and quality (T-162, ADR 0067)

type Decimal = InstanceType<typeof D>;
const cite = (ids: readonly string[]) => [...new Set(ids)].slice(0, MAX_CITED);
const pct1 = (value: Decimal | null) => (value === null ? 'n/a' : percent(value));
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;
const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${monthName(`${year}-${month}`)}`;
};
const span = (years: readonly { year: string }[]) => (years.length === 1 ? (years[0]?.year ?? '') : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);

function costReportClaimProposal(check: CostReportClaimCheck): PackRuleProposal | null {
  const { claim, status, report, measured } = check;
  if (status === 'WITHIN_TOLERANCE') return null;
  const year = report?.year ?? claim.year;
  const basis =
    report && measured
      ? `The FY${report.year} cost report gives ${claim.key === 'OCCUPANCY' ? `${grouped(report.patientDays)} patient days on ${grouped(report.bedDaysAvailable)} bed days available` : `${grouped((claim.key === 'MEDICARE_SHARE' ? report.medicareDays : report.medicaidDays) ?? new D(0))} of ${grouped(report.patientDays)} patient days`}, ${percent(measured)}${status === 'CONTRADICTED' ? `, ${points(claim.value.minus(measured))} from the claim` : ''}.`
      : '';
  const record = { statement: claim.quote.quote, status, rationale: basis || `No cost report for ${claim.year ? `FY${claim.year}` : 'any year'} is imported.` };
  const quotes = [claim.quote];
  const evidenceIds = report ? [report.id] : [];
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:${year ?? 'latest'}:unverified`,
      domain: 'FINANCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” No filed cost report ${claim.year ? `for FY${claim.year} ` : ''}is imported to check it against. Ask the seller for the cost report before relying on it.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
      evidenceIds,
      quotes,
      claim: record,
    };
  if (status === 'VERIFIED')
    return {
      key: `${claim.key}:${year}:verified`,
      domain: 'FINANCIAL',
      title: `Claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” holds against the filed cost report. ${basis}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the filed cost report`, impliedValue: null, basis },
      evidenceIds,
      quotes,
      claim: record,
    };
  return {
    key: `${claim.key}:${year}:contradicted`,
    domain: 'FINANCIAL',
    title: `Cost report contradicts the deck: ${claim.label}`,
    description: `“${claim.quote.quote}” ${basis} Carry the cost report’s figure in the scenarios, not the deck’s, and price the gap.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on a volume or payer-mix figure the filed cost report does not support; the reviewer prices the gap.',
    evidenceIds,
    quotes,
    claim: record,
  };
}

/**
 * Cost-report claims (the claims-register pattern of T-083/T-159): occupancy and the Medicare and Medicaid
 * shares of patient days as the deck or memorandum states them, against the filed cost report of the year
 * the sentence names (else the latest). VERIFIED (+1, confirmed value only), CONTRADICTED (−1) or
 * UNVERIFIED (0), each in the claims register. The cost reports themselves are never read as claims.
 */
export const HOSPITALS_COST_REPORT_CLAIMS: PackRule = {
  id: 'hospitals-cost-report-claims',
  version: '1',
  evidenceTypes: [COST_REPORT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => checkCostReportClaims(evidence, pages).flatMap((check) => costReportClaimProposal(check) ?? []),
};

/**
 * The cost reports against the financial statements: each fiscal year's total costs as filed against the
 * imported P&L's cost of revenue and operating expenses. A gap beyond 2% is a drag: one of the two does not
 * describe the hospital the buyer is pricing.
 */
export const HOSPITALS_COST_REPORT_RECONCILIATION: PackRule = {
  id: 'hospitals-cost-report-reconciliation',
  version: '1',
  evidenceTypes: [COST_REPORT, PNL_LINE],
  detect: ({ evidence }) => {
    const off = costReconciliations(evidence).filter((entry) => entry.share?.gt(COST_RECONCILIATION_TOLERANCE));
    if (off.length === 0) return [];
    return [
      {
        key: off.map((entry) => entry.report.year).join(','),
        domain: 'FINANCIAL',
        title: `Cost reports do not reconcile to the P&L, ${span(off.map((entry) => entry.report))}`,
        description:
          `Total costs as filed against the imported P&L’s cost of revenue and operating expenses: ${off.map((entry) => `FY${entry.report.year} cost report ${grouped(entry.report.totalCosts ?? new D(0))} against ${grouped(entry.pnlCosts)} (${entry.gap.gte(0) ? '+' : '−'}${grouped(entry.gap.abs())}, ${pct1(entry.share)})`).join('; ')}. ` +
          'Ask the seller for the reconciliation between the filed reports and the audited statements before relying on either.',
        severity: off.some((entry) => entry.share?.gt('0.05')) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Earnings quality: the reviewer prices the unexplained gap or makes the reconciliation a closing deliverable.',
        evidenceIds: cite(off.flatMap((entry) => [entry.report.id, ...entry.year.evidenceIds])),
      },
    ];
  },
};

/**
 * The payer contract register against the expected closing: each material payer (10% or more of trailing net
 * revenue in the payer mix) whose agreement ends before the closing or within 12 months after it, and does not
 * renew automatically, is a renegotiation exposure. A payer agreement's own expiry sentence governs over the
 * register, so the check waits until documents have been read. A material payer with no agreement on the
 * register is a gap (0). Dates and arithmetic only: Pactlab never predicts the renegotiation.
 */
export const HOSPITALS_PAYER_CONTRACTS: PackRule = {
  id: 'hospitals-payer-contracts',
  version: '1',
  evidenceTypes: [HOSPITAL_PAYER, PAYER_CONTRACT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0 || !evidence.some((row) => row.evidenceType === PAYER_CONTRACT)) return [];
    const register = contractRegister(evidence, pages);
    const { from, window } = register;
    if (!from || !window) return [];
    const measured = from.basis === 'EXPECTED_CLOSING' ? `the expected closing on ${longDate(from.date)}` : `${longDate(from.date)}, the end of the latest payer-mix month (no closing date is stated)`;
    const out: PackRuleProposal[] = [];
    for (const status of register.payers) {
      if ((status.state !== 'ENDS_BEFORE_CLOSING' && status.state !== 'ENDS_IN_WINDOW') || !status.contract || !status.endsOn) continue;
      const when = status.state === 'ENDS_BEFORE_CLOSING' ? 'before the closing' : `${status.monthsAfter} month${status.monthsAfter === 1 ? '' : 's'} after closing`;
      const quotes = [status.endQuote, from.quote].filter((quote): quote is PackRuleQuote => quote !== null);
      out.push({
        key: `${status.contract.contractId}:${status.endsOn}`,
        domain: 'COMMERCIAL',
        title: `${status.rank === 1 ? 'The largest payer’s' : `${status.payer}’s`} contract ends ${when}${status.rank === 1 ? `: ${status.payer}` : ''}`,
        description:
          `${status.contract.contractId} with ${status.payer} ends on ${longDate(status.endsOn)} (${status.endBasis === 'DOCUMENT' ? 'as the agreement states' : 'from the payer contract register'}), ${when}, measured from ${measured}` +
          `${status.contract.rateBasis ? `; it pays on ${status.contract.rateBasis}` : ''}; no automatic renewal is recorded. ` +
          `${status.payer} is ${pct1(status.share)} of the ${grouped(window.total)} net revenue in the payer mix for ${monthName(window.from)} to ${monthName(window.to)}${status.rank === 1 ? ', the largest payer' : ''}. ` +
          `A renegotiation lands inside the first ${CONTRACT_WINDOW_MONTHS} months of ownership: test the rate in a payer-mix-adjusted scenario and price it, or make a renewal a closing condition. Dates and arithmetic only; no view on the outcome.`,
        severity: status.rank === 1 || (status.share?.gte('0.25') ?? false) || status.state === 'ENDS_BEFORE_CLOSING' ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'Reimbursement on the payer’s new terms is unknown at signing: a rate sensitivity the reviewer prices, or a renewal as a closing condition.',
        evidenceIds: cite([status.contract.id, ...status.rows.slice(-12).map((row) => row.id)]),
        quotes,
      });
    }
    const missing = register.payers.filter((status) => status.state === 'MISSING');
    if (missing.length)
      out.push({
        key: `missing:${missing.map((status) => status.payer).join(',')}`,
        domain: 'COMMERCIAL',
        title: `No contract on file for ${missing.length} material payer${missing.length === 1 ? '' : 's'}`,
        description: `${missing.map((status) => `${status.payer} (${pct1(status.share)} of trailing net revenue)`).join('; ')} ${missing.length === 1 ? 'pays' : 'pay'} at least ${percent(new D(MATERIAL_PAYER_SHARE))} of net revenue with no agreement on the payer contract register. Ask the seller for the agreements and their terms.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap to close in diligence, not a price term until the agreement is read.',
        evidenceIds: cite(missing.flatMap((status) => status.rows.slice(-12).map((row) => row.id))),
      });
    return out;
  },
};

/**
 * The medical-staff register at hospital scale (the T-160 credentialing pattern): every physician's licence
 * and clinical privileges at the analysis date, a verification document's date governing. A department whose
 * physicians' privileges lapse on one date (at least two physicians, and half the department) is a drag: the
 * service line cannot run while they are re-credentialed. Individual lapses and roster gaps are recorded for
 * the reviewer (0). Status and dates only; never a view on a physician.
 */
export const HOSPITALS_MEDICAL_STAFF: PackRule = {
  id: 'hospitals-medical-staff',
  version: '1',
  evidenceTypes: [CREDENTIAL, ROSTER, HOSPITAL_CENSUS, HOSPITAL_PAYER],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const asOf = hospitalsAnalysisDate(evidence);
    if (!asOf || !evidence.some((row) => row.evidenceType === CREDENTIAL)) return [];
    const staff = staffCredentials(evidence, pages, asOf);
    const clusters = privilegeClusters(staff);
    const out: PackRuleProposal[] = clusters.map((cluster) => {
      const refs = [...new Set(cluster.members.map((entry) => entry.row.providerRef))].sort();
      const quotes = cluster.members.flatMap((entry) => (entry.quote ? [entry.quote] : []));
      return {
        key: `${cluster.department}:${cluster.date}:${cluster.state === 'LAPSED' ? 'lapsed' : 'near'}`,
        domain: 'REGULATORY',
        title: `${cluster.department}: ${refs.length} physicians’ privileges ${cluster.state === 'LAPSED' ? 'lapsed together' : 'lapse together'} on ${longDate(cluster.date)}`,
        description:
          `${refs.join(', ')} — ${refs.length} of the ${cluster.departmentSize} physicians holding privileges in ${cluster.department} — share a privilege renewal date of ${longDate(cluster.date)}, ${cluster.state === 'LAPSED' ? 'already past' : `within ${90} days of`} ${longDate(asOf)}, the end of the latest month in the exports. ` +
          'If the department’s privileges are not renewed, its service line cannot be staffed: make evidence of re-credentialing a closing condition, and price the service line’s revenue at risk. Status and dates from the register and the verification documents; never a view on a physician.',
        severity: cluster.state === 'LAPSED' ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        directionRationale: 'A department that cannot operate until re-credentialed: a closing condition, with the service line’s revenue at risk priced by the reviewer.',
        evidenceIds: cite(cluster.members.map((entry) => entry.row.id)),
        ...(quotes.length ? { quotes } : {}),
      };
    });
    const inCluster = new Set(clusters.flatMap((cluster) => cluster.members.map((entry) => entry.row.id)));
    const lapsed = staff.filter((entry) => entry.state === 'LAPSED' && !inCluster.has(entry.row.id));
    if (lapsed.length)
      out.push({
        key: `lapsed:${lapsed.map((entry) => entry.row.credentialRef).sort().join(',')}`,
        domain: 'REGULATORY',
        title: `${lapsed.length} medical-staff credential${lapsed.length === 1 ? '' : 's'} lapsed at the analysis date`,
        description: `${lapsed.map((entry) => `${entry.row.providerRef}: ${entry.row.kind.replaceAll('_', ' ')}${entry.department ? ` (${entry.department})` : ''}, ${entry.expiresOn ? `expired ${longDate(entry.expiresOn)}` : entry.row.status}`).join('; ')}. Ask for evidence of renewal before closing.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'Individual renewals to evidence before closing, not a price term.',
        evidenceIds: cite(lapsed.map((entry) => entry.row.id)),
      });
    const gaps = rosterGaps(evidence, staff);
    if (gaps.length)
      out.push({
        key: `roster:${gaps.map((gap) => `${gap.providerRef}-${gap.missing}`).join(',')}`,
        domain: 'REGULATORY',
        title: `${new Set(gaps.map((gap) => gap.providerRef)).size} rostered physician${new Set(gaps.map((gap) => gap.providerRef)).size === 1 ? ' has' : 's have'} no licence or privileges on the register`,
        description: `${gaps.map((gap) => `${gap.providerRef}: no ${gap.missing === 'LICENCE' ? 'licence' : 'clinical privileges'} recorded`).join('; ')}. Absence is shown as absence: ask the seller for the register rows.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap in the register to close, not a price term.',
        evidenceIds: cite(gaps.map((gap) => gap.row.id)),
      });
    return out;
  },
};

/**
 * Plant and capex trend: capital expenditure ÷ revenue across the imported P&L years, falling every year to
 * three quarters of its first year or less — deferred investment that a single year's P&L hides. Against a
 * narrative document claiming a modern plant it is a drag (−1), cited to the claim and to a property or
 * facility condition assessment where one says what is deferred (priced as remediation at the amount it
 * states); without such a claim it is a watch item (0).
 */
export const HOSPITALS_CAPEX_TREND: PackRule = {
  id: 'hospitals-capex-trend',
  version: '1',
  evidenceTypes: [HOSPITAL_CAPEX, PNL_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // The claim and the condition assessment decide the direction: wait for the documents, so no stale watch item is left behind.
    if (pages.length === 0) return [];
    const years = hospitalCapexYears(evidence);
    if (!capexFalling(years)) return [];
    const claim = modernPlantClaim(pages);
    const condition = conditionFindings(pages);
    const priced = condition.map((quote) => amountAfter(quote.quote, /\b(?:deferred|backlog)\b/i)).find((entry) => entry !== null) ?? null;
    const series = years.map((year) => `FY${year.year} ${pct1(year.ratio)} (${grouped(year.capex)} on ${grouped(year.revenue)} revenue)`).join(', ');
    const first = years[0];
    const last = years.at(-1);
    return [
      {
        key: `${first?.year}-${last?.year}:${claim ? 'claimed-modern' : 'falling'}`,
        domain: 'PROPERTY',
        title: claim ? `Capex falling while the deck claims a modern plant, FY${span(years)}` : `Capex ratio falling, FY${span(years)}`,
        description:
          `Capital expenditure as a share of revenue fell every year — ${series} — to ${pct1(last?.ratio && first?.ratio ? last.ratio.div(first.ratio) : null)} of its first year (the trend threshold is ${percent(new D(CAPEX_DECLINE_FACTOR))}). Capex from its import over the imported P&L’s revenue. ` +
          (claim ? `The documents say: “${claim.quote}” ` : '') +
          (condition.length ? `The condition assessment says: “${condition[0]?.quote}” ` : 'No property or facility condition assessment is on file to show the plant’s state. ') +
          'Deferred investment raises earnings today and falls due after closing: carry a maintenance-capex normalisation in the scenarios, priced by the reviewer.',
        severity: claim ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: claim ? -1 : 0,
        ...(claim
          ? {
              pricedRisk: priced ? { type: 'REMEDIATION_COST' as const, currency: priced.currency, low: priced.amount.toFixed(2), high: priced.amount.toFixed(2), basis: 'The deferred work the condition assessment states.' } : null,
              directionRationale: 'Deferred plant investment the buyer funds after closing: a remediation cost or a capex normalisation, priced by the reviewer.',
            }
          : { directionRationale: 'A watch item: falling capex with no claim to the contrary may be a completed programme; confirm the plant’s condition.' }),
        evidenceIds: cite(years.flatMap((year) => [...year.capexIds, ...year.revenueIds])),
        quotes: [...(claim ? [claim] : []), ...condition.slice(0, 2)],
      },
    ];
  },
};

function qualityProposal(check: QualityClaimCheck): PackRuleProposal {
  const { claim, reported, status } = check;
  const quotes = [claim.quote, ...(reported ? [reported.quote] : [])];
  const record = { statement: claim.quote.quote, status, rationale: reported ? `The reporting document states: “${reported.quote.quote}”` : 'No reporting document supplied states this measure.' };
  const shown = (value: string) => (claim.measure === 'STAR_RATING' ? `${value} star${value === '1' ? '' : 's'}` : `grade ${value}`);
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.measure}:unverified`,
      domain: 'REGULATORY',
      title: `Quality claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” No reporting document supplied states the ${claim.label.toLowerCase()}. Ask the seller for the published report before relying on it. Pactlab compares documents; it never assesses the quality of care.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
      evidenceIds: [],
      quotes,
      claim: record,
    };
  if (status === 'VERIFIED')
    return {
      key: `${claim.measure}:${claim.value}:verified`,
      domain: 'REGULATORY',
      title: `Quality claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” The reporting document states the same, ${shown(claim.value)}: “${reported?.quote.quote ?? ''}” A match between documents, not a view on the quality of care.`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} as the reporting document states it`, impliedValue: null, basis: reported?.quote.quote ?? '' },
      evidenceIds: [],
      quotes,
      claim: record,
    };
  return {
    key: `${claim.measure}:${claim.value}:${reported?.value}:contradicted`,
    domain: 'REGULATORY',
    title: `Quality claim contradicted: ${claim.label}`,
    description: `The deck claims ${shown(claim.value)} (“${claim.quote.quote}”) but the reporting document states ${shown(reported?.value ?? '')}: “${reported?.quote.quote ?? ''}” Correct the marketed figure; a mismatch between documents, not a view on the quality of care.`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'A published-rating claim the reporting does not support: the reviewer weighs it in the scenarios and the disclosure schedule.',
    evidenceIds: [],
    quotes,
    claim: record,
  };
}

/**
 * Quality-reporting claims: star ratings and safety grades the deck states, as claims-register entries mapped
 * to the reporting documents supplied (VERIFIED +1, CONTRADICTED −1, UNVERIFIED 0). Never a prediction of a
 * survey and never a view on care.
 */
export const HOSPITALS_QUALITY_CLAIMS: PackRule = {
  id: 'hospitals-quality-claims',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => checkQualityClaims(pages).map(qualityProposal),
};

export const [HOSPITALS_PNL_TREND, HOSPITALS_PNL_MARGIN_DRIFT, HOSPITALS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('hospitals', HOSPITALS_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/** Five years of history (T-184c): admissions and patient days by calendar year from the census, beside the P&L. */
export const HOSPITALS_DRIVERS = {
  admissions: { key: 'admissions', label: 'Admissions', unit: 'COUNT', evidenceType: HOSPITAL_CENSUS, mode: 'SUM', numerator: ['admissions'], formula: 'Σ admissions in the year, every service line' },
  patientDays: { key: 'patient_days', label: 'Patient days', unit: 'COUNT', evidenceType: HOSPITAL_CENSUS, mode: 'SUM', numerator: ['patient_days'], formula: 'Σ inpatient days in the year, every service line' },
} as const satisfies Record<string, DriverSpec>;

export const HOSPITALS_HISTORY: PackHistorySpec = {
  drivers: [HOSPITALS_DRIVERS.admissions, HOSPITALS_DRIVERS.patientDays],
  keyExpenses: HOSPITALS_KEY_EXPENSES,
  driverImport: 'HOSPITALS_CENSUS',
  driverLabel: 'Census',
  driverWhat: 'census history',
};

/** Admissions falling every year by this share or more, first year to last (5%). */
export const ADMISSIONS_DECLINE_SHARE = '0.05';

export const HOSPITALS_ADMISSIONS_TREND = driverTrendRule(
  {
    id: 'hospitals-admissions-trend',
    driver: HOSPITALS_DRIVERS.admissions,
    adverse: 'DOWN',
    threshold: ADMISSIONS_DECLINE_SHARE,
    domain: 'COMMERCIAL',
    advice: 'Fewer patients are admitted each year: revenue growth is coming from rate and mix, not volume. Check the payer contracts and the medical staff before projecting volume forward.',
  },
  HOSPITALS_HISTORY,
);

export const HOSPITALS_RULES: readonly PackRule[] = [
  HOSPITALS_PAYER_CONCENTRATION,
  HOSPITALS_ACCREDITATION_TRANSFER,
  HOSPITALS_PHYSICIAN_DEPENDENCE,
  HOSPITALS_REGULATORY_CAPEX,
  HOSPITALS_COST_REPORT_CLAIMS,
  HOSPITALS_COST_REPORT_RECONCILIATION,
  HOSPITALS_PAYER_CONTRACTS,
  HOSPITALS_MEDICAL_STAFF,
  HOSPITALS_CAPEX_TREND,
  HOSPITALS_QUALITY_CLAIMS,
  HOSPITALS_PNL_TREND,
  HOSPITALS_PNL_MARGIN_DRIFT,
  HOSPITALS_PNL_EXPENSE_OUTPACING,
  HOSPITALS_ADMISSIONS_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('hospitals', HOSPITALS_HISTORY),
];
export const HOSPITALS_EVIDENCE = { CENSUS, PAYER, COST_REPORT, CAPEX: HOSPITAL_CAPEX } as const;
