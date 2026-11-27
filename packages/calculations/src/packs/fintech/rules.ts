import { D, parseDecimal, sum } from '../../metrics/decimal';
import { pnlPeriods, pnlForPeriod } from '../../pnl/pnl';
import { pnlLinesFromRecords, type KeyExpense } from '../../pnl/trend';
import { monthName } from '../common';
import { driverTrendRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findMatch, findSentence, MAX_CITED, sentences, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  complianceDocuments,
  fintechAnalysisDate,
  LICENCE,
  licenceStatuses,
  licenceRows,
  PCI_STALE_DAYS,
  paymentClaims,
  PROCESSOR_MONTH,
  processorMonths,
  quarterlyRates,
  statedThresholds,
  volumeModel,
  volumeWindow,
  type LicenceStatus,
  type PaymentClaim,
  type ProcessorMonth,
  type QuarterRates,
  type StatedThreshold,
} from './payments';

/**
 * Fintech pack rules (T-058, spec §19 pack 1). Deterministic and versioned:
 * the same loan tape, alerts and pages always give the same drafts. Money and
 * rates are decimal throughout; output amounts are fixed to two places.
 */
const LOAN = 'fintech.loan';
const ALERT = 'fintech.aml_alert';

const amount = (row: PackRuleEvidence, field: string) => parseDecimal(row.canonical[field]) ?? new D(0);
const pct = (value: InstanceType<typeof D>) => `${value.times(100).toFixed(1)}%`;
const fmt = (value: InstanceType<typeof D>) => value.toFixed(2);
const grouped = (value: InstanceType<typeof D>) => {
  const [whole = '0', fraction] = value.toFixed(0).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
};

/** "Allowance for credit losses: USD 15,567 …" on a balance-sheet page. */
const ALLOWANCE = /allowance for (?:credit|loan) losses\s*:?\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i;

export const FINTECH_CREDIT_LOSS: PackRule = {
  id: 'fintech-credit-loss',
  version: '1',
  evidenceTypes: [LOAN],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const loans = evidence.filter((row) => row.evidenceType === LOAN);
    const currency = loans[0]?.canonical['currency'] ?? null;
    if (loans.length === 0 || !currency || loans.some((row) => row.canonical['currency'] !== currency)) return [];
    const chargedOff = loans.filter((row) => row.canonical['status'] === 'charged_off');
    const originated = sum(loans.map((row) => amount(row, 'principal')));
    const outstanding = sum(loans.filter((row) => row.canonical['status'] !== 'charged_off').map((row) => amount(row, 'balance')));
    if (originated.isZero() || outstanding.isZero() || chargedOff.length === 0) return [];
    const lossRate = sum(chargedOff.map((row) => amount(row, 'principal'))).div(originated);

    const found = findMatch(pages, ALLOWANCE);
    if (!found || found.match[1]?.toUpperCase() !== currency) return [];
    const allowance = parseDecimal((found.match[2] ?? '').replaceAll(',', ''));
    if (!allowance) return [];
    const allowanceRate = allowance.div(outstanding);
    if (lossRate.lessThanOrEqualTo(allowanceRate)) return [];

    const shortfall = lossRate.minus(allowanceRate).times(outstanding);
    return [
      {
        key: `${currency}:${found.page.documentId}:${found.page.pageNumber}`,
        domain: 'FINANCIAL',
        title: 'Allowance below observed loss experience',
        description:
          `Charged-off loans are ${pct(lossRate)} of originated principal on the loan tape (${chargedOff.length} of ${loans.length} loans). ` +
          `The balance sheet carries an allowance of ${currency} ${grouped(allowance)}, ${pct(allowanceRate)} of the ${currency} ${grouped(outstanding)} outstanding.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: {
          type: 'PRICE_REDUCTION',
          currency,
          low: fmt(shortfall.div(2)),
          high: fmt(shortfall),
          basis: `Observed loss rate (${pct(lossRate)}) less the allowance rate (${pct(allowanceRate)}) applied to the outstanding balance; low end assumes half the gap closes.`,
        },
        evidenceIds: chargedOff.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: found.page.documentId, pageNumber: found.page.pageNumber, quote: found.quote }],
      },
    ];
  },
};

const REVIEW_REQUIREMENT = /\b(?:must|shall) be reviewed\b/i;

export const FINTECH_AML_UNREVIEWED: PackRule = {
  id: 'fintech-aml-unreviewed',
  version: '1',
  evidenceTypes: [ALERT],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const closed = evidence.filter((row) => row.evidenceType === ALERT && row.canonical['status'] === 'closed');
    const unreviewed = closed.filter((row) => row.canonical['review_evidence'] !== 'yes');
    if (unreviewed.length === 0) return [];
    const share = new D(unreviewed.length).div(closed.length);
    const procedure = findSentence(pages, (sentence) => REVIEW_REQUIREMENT.test(sentence));
    return [
      {
        key: 'closed-alerts',
        domain: 'REGULATORY',
        title: 'Alerts closed without review evidence',
        description:
          `${unreviewed.length} of ${closed.length} closed transaction-monitoring alerts (${pct(share)}) have no review evidence on file` +
          (procedure ? ', against a written procedure that requires every alert to be reviewed before closure.' : '.') +
          ' Price the remediation (escrow, indemnity or remediation cost) before accepting.',
        severity: share.greaterThan('0.10') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: unreviewed.slice(0, MAX_CITED).map((row) => row.id),
        quotes: procedure ? [{ documentId: procedure.page.documentId, pageNumber: procedure.page.pageNumber, quote: procedure.quote }] : [],
      },
    ];
  },
};

const CHANGE_OF_CONTROL = /change of control/i;
const TERMINATION = /terminat/i;

export const FINTECH_PARTNER_BANK_COC: PackRule = {
  id: 'fintech-partner-bank-coc',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) =>
    pages.flatMap((page) => {
      const sentence = sentences(page.text).find((text) => CHANGE_OF_CONTROL.test(text) && TERMINATION.test(text) && /\bbank\b/i.test(text));
      if (!sentence) return [];
      const quote = sentence.length > 400 ? sentence.slice(0, 400) : sentence;
      return [
        {
          key: `${page.documentId}:${page.pageNumber}`,
          domain: 'LEGAL' as const,
          title: 'Partner bank can terminate on change of control',
          description: 'The partner-bank agreement lets the bank terminate if the company undergoes a change of control without its consent.',
          severity: 'MEDIUM' as const,
          confidence: 'HIGH' as const,
          direction: 0 as const,
          directionRationale: 'A closing condition (the bank’s written consent), not a price adjustment.',
          evidenceIds: [],
          quotes: [{ documentId: page.documentId, pageNumber: page.pageNumber, quote }],
        },
      ];
    }),
};

// ---------------------------------------------------------------- payments and licences (T-159, ADR 0050)

type Decimal = InstanceType<typeof D>;
const pct2 = (value: Decimal) => `${value.times(100).toFixed(2)}%`;
const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const period = (rows: readonly ProcessorMonth[], from: string, to: string) => `${monthName(from)} to ${monthName(to)}${rows.length ? '' : ' (no rows)'}`;

/** Tolerances for the claims register, as fractions (TPV) or percentage points (growth, take rate). */
export const CLAIM_TOLERANCE = {
  TPV: { verified: '0.005', contradicted: '0.01' },
  TPV_GROWTH: { verified: '1', contradicted: '3' },
  TAKE_RATE: { verified: '0.05', contradicted: '0.15' },
} as const;

function claimProposal(claim: PaymentClaim, status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED', basis: string, detail: string, rows: readonly ProcessorMonth[]): PackRuleProposal {
  const quotes = [claim.quote];
  const record = { statement: claim.quote.quote, status, rationale: basis };
  if (status === 'UNVERIFIED')
    return {
      key: `${claim.key}:unverified`,
      domain: 'FINANCIAL',
      title: `Claim not verified: ${claim.label}`,
      description: `The document states “${claim.quote.quote}” ${basis} Ask the seller for the evidence behind it before relying on it.`,
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
      key: `${claim.key}:verified`,
      domain: 'FINANCIAL',
      title: `Claim verified: ${claim.label}`,
      description: `“${claim.quote.quote}” ${detail}`,
      severity: 'LOW',
      confidence: 'HIGH',
      direction: 1,
      valueConfirmation: { valueDriver: `${claim.label} verified against the processor exports`, impliedValue: null, basis },
      evidenceIds: cite(rows),
      quotes,
      claim: record,
    };
  return {
    key: `${claim.key}:contradicted`,
    domain: 'FINANCIAL',
    title: `Claim contradicted: ${claim.label}`,
    description: `“${claim.quote.quote}” ${detail}`,
    severity: 'HIGH',
    confidence: 'HIGH',
    direction: -1,
    pricedRisk: null,
    directionRationale: 'The price was set on a figure the processor exports do not support; price the gap as a haircut on the volume the scenarios assume.',
    evidenceIds: cite(rows),
    quotes,
    claim: record,
  };
}

/**
 * The claims register for payments (the T-083/T-141 pattern): TPV, its growth, the take rate and
 * retention as the deck states them, each set against the processor exports — VERIFIED,
 * CONTRADICTED or UNVERIFIED — and recorded in the claims register with its finding.
 */
export const FINTECH_VOLUME_CLAIMS: PackRule = {
  id: 'fintech-volume-claims',
  version: '1',
  evidenceTypes: [PROCESSOR_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = processorMonths(evidence);
    const model = volumeModel(rows);
    return paymentClaims(pages).flatMap((claim): PackRuleProposal[] => {
      if (claim.key === 'RETENTION') return [claimProposal(claim, 'UNVERIFIED', 'Processor exports carry no merchant-level identities, so retention cannot be recomputed from them.', '', [])];
      if (!model.latestMonth) return [claimProposal(claim, 'UNVERIFIED', 'No processor or bank export is in the evidence to check it against.', '', [])];
      if (claim.key === 'TPV') {
        const window = volumeWindow(rows, claim.month && claim.month <= model.latestMonth ? claim.month : model.latestMonth);
        if (window.missing.length) return [claimProposal(claim, 'UNVERIFIED', `The exports miss ${window.missing.length} of the twelve months to ${monthName(window.to)} (${window.missing.join(', ')}).`, '', [])];
        const gap = claim.value.minus(window.volume);
        const relative = gap.div(window.volume);
        const basis = `The processor exports give ${grouped(window.volume)} of processed volume for ${period(window.rows, window.from, window.to)} (${window.rows.length} processor-months).`;
        if (relative.abs().lte(CLAIM_TOLERANCE.TPV.verified)) return [claimProposal(claim, 'VERIFIED', basis, `ties to the exports. ${basis}`, window.rows)];
        if (relative.abs().lte(CLAIM_TOLERANCE.TPV.contradicted)) return [];
        const twice = gap.gt(0) ? window.rows.find((row) => row.volume.minus(gap).abs().lte(1)) : undefined;
        const why = twice ? ` The gap equals ${twice.processor}’s ${monthName(twice.month)} volume (${grouped(twice.volume)}) exactly: that month is counted twice.` : '';
        return [claimProposal(claim, 'CONTRADICTED', basis, `is ${grouped(gap.abs())} (${pct(relative.abs())}) ${gap.gt(0) ? 'above' : 'below'} the exports. ${basis}${why}`, twice ? [twice, ...window.rows.filter((row) => row.id !== twice.id)] : window.rows)];
      }
      if (claim.key === 'TPV_GROWTH') {
        if (!model.growth || !model.trailing || !model.prior) return [claimProposal(claim, 'UNVERIFIED', 'The exports do not hold two complete years to recompute growth.', '', [])];
        const actual = model.growth.times(100);
        const off = claim.value.minus(actual).abs();
        const basis = `Processed volume of ${grouped(model.trailing.volume)} for the twelve months to ${monthName(model.trailing.to)} against ${grouped(model.prior.volume)} the year before is ${actual.toFixed(1)}% growth.`;
        if (off.lte(CLAIM_TOLERANCE.TPV_GROWTH.verified)) return [claimProposal(claim, 'VERIFIED', basis, `agrees with the exports. ${basis}`, model.trailing.rows)];
        if (off.gt(CLAIM_TOLERANCE.TPV_GROWTH.contradicted)) return [claimProposal(claim, 'CONTRADICTED', basis, `is ${off.toFixed(1)} points off the exports. ${basis}`, model.trailing.rows)];
        return [];
      }
      const trailing = model.trailing;
      if (!trailing?.takeRate || trailing.missing.length) return [claimProposal(claim, 'UNVERIFIED', 'The exports do not hold twelve complete months of volume and net revenue.', '', [])];
      const actual = trailing.takeRate.times(100);
      const off = claim.value.minus(actual).abs();
      const basis = `Net revenue of ${grouped(trailing.netRevenue)} on ${grouped(trailing.volume)} of processed volume for the twelve months to ${monthName(trailing.to)} is an effective take rate of ${actual.toFixed(2)}%.`;
      if (off.lte(CLAIM_TOLERANCE.TAKE_RATE.verified)) return [claimProposal(claim, 'VERIFIED', basis, `agrees with the exports. ${basis}`, trailing.rows)];
      if (off.gt(CLAIM_TOLERANCE.TAKE_RATE.contradicted)) return [claimProposal(claim, 'CONTRADICTED', basis, `is ${off.toFixed(2)} points off the exports. ${basis}`, trailing.rows)];
      return [];
    });
  },
};

/** Lines of the imported P&L read as payments revenue, to reconcile to the processor exports. */
export const PAYMENTS_REVENUE_LINE = /\b(?:payment|payments|processing|transaction)\b/i;
/** A fiscal year's processor net revenue and the P&L's payments revenue differing by more than this share is a finding. */
export const RECONCILIATION_TOLERANCE = '0.02';

/** The processor exports' net revenue for each calendar year they cover in full, against the P&L's payments revenue lines. */
export function revenueReconciliation(evidence: readonly PackRuleEvidence[]) {
  const rows = processorMonths(evidence);
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  const years = [...new Set(rows.map((row) => row.month.slice(0, 4)))].sort();
  return years.flatMap((year) => {
    const window = volumeWindow(rows, `${year}-12`);
    const read = pnlForPeriod(periods, year);
    if (window.missing.length || !read) return [];
    const lines = read.sources.filter((row) => row.kind === 'REVENUE' && PAYMENTS_REVENUE_LINE.test(row.account));
    if (lines.length === 0) return [];
    const pnl = lines.reduce((total, row) => total.plus(row.amount), new D(0));
    const difference = pnl.minus(window.netRevenue);
    return [{ year, processor: window.netRevenue, pnl, difference, relative: window.netRevenue.gt(0) ? difference.div(window.netRevenue) : null, accounts: [...new Set(lines.map((row) => row.account))], rows: window.rows, pnlIds: lines.map((row) => row.evidenceId) }];
  });
}

/** The P&L's payments revenue against the processor exports' net revenue, year by year. */
export const FINTECH_REVENUE_RECONCILIATION: PackRule = {
  id: 'fintech-revenue-reconciliation',
  version: '1',
  evidenceTypes: [PROCESSOR_MONTH, PNL_LINE],
  detect: ({ evidence }) =>
    revenueReconciliation(evidence).flatMap((year): PackRuleProposal[] => {
      if (!year.relative || year.relative.abs().lte(RECONCILIATION_TOLERANCE)) return [];
      return [
        {
          key: `${year.year}`,
          domain: 'FINANCIAL',
          title: `P&L payments revenue does not reconcile to the processor exports, ${year.year}`,
          description:
            `The imported P&L books ${grouped(year.pnl)} of payments revenue for ${year.year} (${year.accounts.join(', ')}); the processor exports give ${grouped(year.processor)} of net revenue for the same twelve months, ` +
            `${grouped(year.difference.abs())} (${pct(year.relative.abs())}) ${year.difference.gt(0) ? 'more in the P&L' : 'less in the P&L'}. Ask the seller to reconcile the two before relying on the revenue line.`,
          severity: year.relative.abs().gt('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: [...year.pnlIds, ...cite(year.rows)].slice(0, MAX_CITED),
        },
      ];
    }),
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  money_transmitter: 'money-transmitter licence',
  lending: 'lending licence',
  payment_institution: 'payment-institution licence',
  e_money: 'e-money licence',
  other_licence: 'licence',
  sponsor_bank: 'sponsor-bank agreement',
};
const licenceName = (status: LicenceStatus) => `${status.row.jurisdiction} ${KIND_LABELS[status.row.kind] ?? 'licence'} (${status.row.licenceId})`;
const monthsAgo = (dayCount: number) => Math.round(dayCount / 30.44);

/**
 * The licence and sponsor register, checked at the analysis date (the end of the latest processor
 * month): a licence or agreement that has lapsed is a drag to price into terms; one expiring within
 * 90 days is a closing condition. Dates come from the documents where they state them, else the register,
 * so the check waits until documents have been read. Status and dates only: never whether the activity
 * needs the licence.
 */
export const FINTECH_LICENCE_STATUS: PackRule = {
  id: 'fintech-licence-status',
  version: '1',
  evidenceTypes: [LICENCE, PROCESSOR_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // The documents govern the dates: until any has been read (an import before the data room), wait for them.
    if (pages.length === 0) return [];
    const asOf = fintechAnalysisDate(processorMonths(evidence));
    return licenceStatuses(licenceRows(evidence), pages, asOf).flatMap((status): PackRuleProposal[] => {
      const quotes: PackRuleQuote[] = status.document ? [status.document.quote] : [];
      const source = status.document ? 'the licence document states' : 'the register records';
      const register = status.registerDiffers ? ` The register gives ${status.row.expiresOn ?? 'no date'}; the document governs.` : '';
      const name = licenceName(status);
      if (status.state === 'LAPSED') {
        const when =
          status.daysPastExpiry !== null && status.daysPastExpiry > 0 && status.expiresOn
            ? `${source} it expired on ${status.expiresOn}, ${monthsAgo(status.daysPastExpiry)} month${monthsAgo(status.daysPastExpiry) === 1 ? '' : 's'} before the latest processor month ends (${asOf ?? ''})`
            : `the register records it as ${status.row.status}`;
        const stillActive = status.row.status === 'active' ? '; the register still records it as active' : '';
        return [
          {
            key: `${status.row.licenceId}:lapsed`,
            domain: 'REGULATORY',
            title: `Lapsed: ${name}`,
            description:
              `The ${name}, issued by ${status.row.authority}: ${when}${stillActive}.${register} ` +
              'Pactlab reports status and dates only; whether the business needs this licence, and what follows from the lapse, is for counsel. Price it into terms (an escrow or special indemnity) or make reinstatement a closing condition.',
            severity: 'HIGH',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            evidenceIds: [status.row.id],
            quotes,
          },
        ];
      }
      if (status.state === 'NEAR_EXPIRY' && status.expiresOn)
        return [
          {
            key: `${status.row.licenceId}:${status.expiresOn}:near-expiry`,
            domain: 'REGULATORY',
            title: `Expires within ${NEAR_EXPIRY_DAYS_TEXT}: ${name}`,
            description: `The ${name}, issued by ${status.row.authority}: ${source} it expires on ${status.expiresOn}, ${-(status.daysPastExpiry ?? 0)} days after the latest processor month ends.${register} Make its renewal a closing condition.`,
            severity: 'MEDIUM',
            confidence: 'HIGH',
            direction: 0,
            directionRationale: 'A closing condition (renewal before close), not a price adjustment.',
            evidenceIds: [status.row.id],
            quotes,
          },
        ];
      return [];
    });
  },
};
const NEAR_EXPIRY_DAYS_TEXT = '90 days';

const MEASURE_LABEL = { CHARGEBACK: 'Chargeback rate', FRAUD: 'Fraud-loss rate' } as const;
function rateOf(quarter: QuarterRates, threshold: Pick<StatedThreshold, 'measure' | 'basis'>): Decimal | null {
  if (threshold.measure === 'FRAUD') return quarter.fraudRate;
  return threshold.basis === 'COUNT' ? quarter.chargebackRate : quarter.chargebackValueRate;
}

/**
 * Chargeback and fraud-loss rates by quarter from the processor exports, against the thresholds the
 * documents themselves state (a sponsor covenant, a network monitoring program). The latest complete
 * quarter breaching is a drag; a rate that rose three quarters running, still under it, is a watch
 * item. No threshold is assumed: with none stated, nothing is drafted.
 */
export const FINTECH_LOSS_THRESHOLDS: PackRule = {
  id: 'fintech-loss-thresholds',
  version: '1',
  evidenceTypes: [PROCESSOR_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const quarters = quarterlyRates(processorMonths(evidence));
    const latest = quarters.at(-1);
    const stated = statedThresholds(pages);
    // Only thresholds a document states are compared: with none, rates are shown and nothing is drafted.
    if (!latest || stated.length === 0) return [];
    return stated.flatMap((threshold): PackRuleProposal[] => {
      const measure = threshold;
      const series = quarters.map((quarter) => ({ quarter, rate: rateOf(quarter, measure) })).filter((entry): entry is { quarter: QuarterRates; rate: Decimal } => entry.rate !== null);
      const last = series.at(-1);
      if (!last || last.quarter.quarter !== latest.quarter) return [];
      const recent = series.slice(-4);
      const rising = recent.length === 4 && recent.every((entry, index) => index === 0 || entry.rate.gt(recent[index - 1]?.rate ?? entry.rate));
      const history = series.slice(-4).map((entry) => `${entry.quarter.quarter} ${pct2(entry.rate)}`).join(', ');
      const basis = measure.measure === 'FRAUD' ? 'fraud losses ÷ processed volume' : measure.basis === 'COUNT' ? 'chargebacks ÷ settled transactions, by count' : 'chargeback amount ÷ processed volume';
      const breached = threshold.strict ? last.rate.gte(threshold.limit) : last.rate.gt(threshold.limit);
      if (breached)
        return [
          {
            key: `${measure.measure}:${last.quarter.quarter}:breach`,
            domain: 'REGULATORY',
            title: `${MEASURE_LABEL[measure.measure]} breaches the stated threshold, ${last.quarter.quarter}`,
            description:
              `${MEASURE_LABEL[measure.measure]} for ${last.quarter.quarter} is ${pct2(last.rate)} (${basis}, from the processor exports), against the ${pct2(threshold.limit)} the document states. ` +
              `Recent quarters: ${history}.${rising ? ' It has risen three quarters running.' : ''} A breach can let the sponsor or the network impose fines, reserves or termination; price it (an escrow or a reserve holdback) before accepting.`,
            severity: 'HIGH',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            evidenceIds: cite(last.quarter.rows),
            quotes: [threshold.quote],
          },
        ];
      if (rising)
        return [
          {
            key: `${measure.measure}:${last.quarter.quarter}:rising`,
            domain: 'REGULATORY',
            title: `${MEASURE_LABEL[measure.measure]} rising three quarters running`,
            description:
              `${MEASURE_LABEL[measure.measure]} (${basis}, from the processor exports) rose every quarter: ${history}. ` +
              `The document's threshold is ${pct2(threshold.limit)}; the latest quarter is ${pct2(threshold.limit.minus(last.rate))} under it. A watch item for the covenant headroom.`,
            severity: 'MEDIUM',
            confidence: 'HIGH',
            direction: 0,
            directionRationale: 'Within the stated threshold: a watch item and a covenant to keep, not a price adjustment.',
            evidenceIds: cite(recent.flatMap((entry) => entry.quarter.rows)),
            quotes: [threshold.quote],
          },
        ];
      return [];
    });
  },
};

/**
 * Compliance evidence on file: the PCI attestation, the KYC/AML programme and regulatory exam
 * reports, recognised by their headings. A stale attestation or a consent order on file is drafted
 * for review, cited to its heading. Absence is shown as absence on the Payments page and the intake
 * checklist, never drafted: a finding must cite its evidence, and a missing document has none.
 * Presence, dates and headings only: never whether a programme is compliant.
 */
export const FINTECH_COMPLIANCE_EVIDENCE: PackRule = {
  id: 'fintech-compliance-evidence',
  version: '1',
  evidenceTypes: [PROCESSOR_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const asOf = fintechAnalysisDate(processorMonths(evidence));
    const found = complianceDocuments(pages);
    const stale = found
      .filter((document) => document.kind === 'PCI_ATTESTATION' && document.date && asOf && Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${document.date}T00:00:00Z`) > PCI_STALE_DAYS * 86_400_000)
      .map(
        (document): PackRuleProposal => ({
          key: `${document.documentId}:stale`,
          domain: 'REGULATORY',
          title: 'PCI attestation more than a year old',
          description: `The attestation on file is dated ${document.date ?? ''}, more than ${PCI_STALE_DAYS} days before the latest processor month ends (${asOf ?? ''}). Request the current one.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A gap in current evidence, requested before close; not a price adjustment.',
          evidenceIds: [],
          quotes: [document.quote],
        }),
      );
    const orders = found
      .filter((document) => document.consentOrder)
      .map(
        (document): PackRuleProposal => ({
          key: `${document.documentId}:consent-order`,
          domain: 'REGULATORY',
          title: 'Consent order on file',
          description: `A consent order is in the evidence (“${document.quote.quote}”). Pactlab records that it is on file; what it requires, and whether it is met, is for counsel. Review it before pricing.`,
          severity: 'HIGH',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A document for counsel to read; any price or term follows from their reading, recorded by a reviewer.',
          evidenceIds: [],
          quotes: [document.quote],
        }),
      );
    return [...stale, ...orders];
  },
};

/** The fintech key expenses the multi-year trend watches against revenue. */
export const FINTECH_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'fraud', label: 'Fraud losses', pattern: /\bfraud\b/i },
  { key: 'chargebacks', label: 'Chargeback losses', pattern: /\bchargeback/i },
  { key: 'credit', label: 'Credit losses', pattern: /\b(?:credit|loan) loss|\bprovision for (?:credit|loan)/i },
  { key: 'processing', label: 'Processing costs', pattern: /\b(?:interchange|network fees|processing cost|cost of processing)\b/i },
];

export const [FINTECH_PNL_TREND, FINTECH_PNL_MARGIN_DRIFT, FINTECH_PNL_EXPENSE_OUTPACING] = pnlTrendRules('fintech', FINTECH_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/**
 * Five years of history (T-184, ADR 0057): the P&L by year and the processor export's volume, take rate and
 * loss rates by calendar year. The export is a period series already, so more months is more history.
 */
export const FINTECH_DRIVERS = {
  tpv: { key: 'tpv', label: 'Processed volume (TPV)', unit: 'MONEY', evidenceType: PROCESSOR_MONTH, mode: 'SUM', numerator: ['gross_volume'], formula: 'Σ processed volume in the year, every processor' },
  takeRate: { key: 'take_rate', label: 'Effective take rate', unit: 'RATIO', evidenceType: PROCESSOR_MONTH, mode: 'RATIO', numerator: ['net_revenue'], denominator: ['gross_volume'], scale: 6, formula: 'Σ net revenue ÷ Σ processed volume in the year' },
  lossRate: {
    key: 'loss_rate',
    label: 'Loss rate (chargebacks and fraud)',
    unit: 'RATIO',
    evidenceType: PROCESSOR_MONTH,
    mode: 'RATIO',
    numerator: ['chargeback_amount', 'fraud_losses'],
    denominator: ['gross_volume'],
    scale: 6,
    formula: '(Σ chargeback amounts + Σ fraud losses) ÷ Σ processed volume in the year',
  },
} as const satisfies Record<string, DriverSpec>;

export const FINTECH_HISTORY: PackHistorySpec = {
  drivers: [FINTECH_DRIVERS.tpv, FINTECH_DRIVERS.takeRate, FINTECH_DRIVERS.lossRate],
  keyExpenses: FINTECH_KEY_EXPENSES,
  driverImport: 'FINTECH_PROCESSOR_VOLUME',
  driverLabel: 'Processor volume',
  driverWhat: 'processor volume history',
};

/** Take rate compressing every year by this much or more, first year to last (0.10 points). */
export const TAKE_RATE_COMPRESSION_POINTS = '0.001';
/** Loss rate climbing every year by this much or more, first year to last (0.05 points of volume). */
export const LOSS_RATE_CLIMB_POINTS = '0.0005';

export const FINTECH_TAKE_RATE_TREND = driverTrendRule(
  {
    id: 'fintech-take-rate-trend',
    driver: FINTECH_DRIVERS.takeRate,
    adverse: 'DOWN',
    threshold: TAKE_RATE_COMPRESSION_POINTS,
    domain: 'FINANCIAL',
    advice: 'Net revenue is growing slower than volume: check pricing concessions to large merchants and the mix by processor before projecting today\'s take rate forward.',
  },
  FINTECH_HISTORY,
);

export const FINTECH_LOSS_RATE_TREND = driverTrendRule(
  {
    id: 'fintech-loss-rate-trend',
    driver: FINTECH_DRIVERS.lossRate,
    adverse: 'UP',
    threshold: LOSS_RATE_CLIMB_POINTS,
    domain: 'REGULATORY',
    advice: 'Losses are claiming a growing share of volume: check underwriting of new merchants and the sponsor bank\'s monitoring thresholds.',
  },
  FINTECH_HISTORY,
);

export const FINTECH_RULES: readonly PackRule[] = [
  FINTECH_CREDIT_LOSS,
  FINTECH_AML_UNREVIEWED,
  FINTECH_PARTNER_BANK_COC,
  FINTECH_VOLUME_CLAIMS,
  FINTECH_REVENUE_RECONCILIATION,
  FINTECH_LICENCE_STATUS,
  FINTECH_LOSS_THRESHOLDS,
  FINTECH_COMPLIANCE_EVIDENCE,
  FINTECH_PNL_TREND,
  FINTECH_PNL_MARGIN_DRIFT,
  FINTECH_PNL_EXPENSE_OUTPACING,
  FINTECH_TAKE_RATE_TREND,
  FINTECH_LOSS_RATE_TREND,
];
