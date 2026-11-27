import { D, parseDecimal } from '../../metrics/decimal';
import { pnlForPeriod, pnlPeriods } from '../../pnl/pnl';
import { pnlLinesFromRecords, type KeyExpense } from '../../pnl/trend';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, monthName, rowMonth, percent, revenueConcentrationRule } from '../common';
import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import {
  CLINICIAN_MONTH,
  clinicianMonths,
  clinicianShares,
  CODING_AUDIT_STALE_DAYS,
  collectionYears,
  classGroupShare,
  covenantFor,
  CREDENTIAL,
  CREDENTIAL_NEAR_EXPIRY_DAYS,
  credentialRows,
  credentialStatuses,
  healthcareAnalysisDate,
  healthcareComplianceDocuments,
  PAYER_CLASS_LABELS,
  PAYER_CONTRACT,
  payerContracts,
  payerContractStatuses,
  practiceClaims,
  REMITTANCE,
  remittanceMonths,
  unlicensedRoster,
  type CollectionsPeriod,
  type CredentialStatus,
  type PracticeClaim,
  type RemittanceMonth,
} from './practice';

/**
 * Healthcare services and healthtech pack rules (T-061, spec §19). Patient
 * data is never accepted; providers appear only as pseudonymous references.
 */
const PROVIDER = 'healthcare.provider';
const CLAIMS = 'healthcare.claims_month';

export const HEALTHCARE_GOVERNMENT_CONCENTRATION = revenueConcentrationRule({
  id: 'healthcare-government-concentration',
  title: 'Revenue concentrated in government programmes',
  domain: 'COMMERCIAL',
  threshold: '0.5',
  group: { match: /^Government programme/i, label: 'Government programmes' },
  direction: 0,
  directionRationale: 'A payer-mix and reimbursement-rate sensitivity in the valuation, not a price term.',
  consequence: 'Reimbursement policy changes move most of the revenue at once.',
});

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', eight: '8', ten: '10', twelve: '12' };
const hoursIn = (sentence: string) => {
  const match = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|eight|ten|twelve) hours? per month/i.exec(sentence);
  return match ? parseDecimal(NUMBER_WORDS[(match[1] ?? '').toLowerCase()] ?? match[1] ?? '') : null;
};
const FEE = /\bfee\b[^.]*?\b([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*per month/i;

/** A fixed fee for more hours than the time records document: the excess is a fair-market-value exposure. */
export const HEALTHCARE_DIRECTOR_FEE: PackRule = {
  id: 'healthcare-director-fee',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const duties = findSentence(pages, (sentence) => /\bduties\b/i.test(sentence) && hoursIn(sentence) !== null);
    const fee = findSentence(pages, (sentence) => FEE.test(sentence));
    const records = findSentence(pages, (sentence) => /time records/i.test(sentence) && hoursIn(sentence) !== null);
    if (!duties || !fee || !records) return [];
    const agreed = hoursIn(duties.quote);
    const documented = hoursIn(records.quote);
    const match = FEE.exec(fee.quote);
    const monthly = match ? parseDecimal((match[2] ?? '').replaceAll(',', '')) : null;
    if (!agreed || !documented || !monthly || !agreed.gt(documented)) return [];
    const unsupported = new D(1).minus(documented.div(agreed));
    const yearly = monthly.times(unsupported).times(12);
    const currency = match?.[1] ?? '';
    return [
      {
        key: `${fee.page.documentId}`,
        domain: 'REGULATORY',
        title: 'Medical-director fee above documented duties',
        description:
          `The agreement pays a fixed ${currency} ${grouped(monthly)} a month for ${agreed.toString()} hours of duties; time records document ${documented.toString()} hours a month. ` +
          `${percent(unsupported)} of the fee (${currency} ${grouped(yearly)} a year) is not supported by documented work — a fair-market-value exposure.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: { type: 'INDEMNITY', currency, low: yearly.toFixed(2), high: yearly.times(3).toFixed(2), basis: 'Unsupported share of the fixed fee, one year (low) to a three-year look-back (high).' },
        evidenceIds: [],
        quotes: [duties, fee, records].map((hit) => ({ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote })),
      },
    ];
  },
};

export const HEALTHCARE_PRIVACY_ASSESSMENT = documentClauseRule({
  id: 'healthcare-privacy-assessment',
  title: 'Privacy risk assessment out of date',
  domain: 'REGULATORY',
  severity: 'MEDIUM',
  direction: 0,
  directionRationale: 'A pre-closing remediation covenant (a current risk assessment), not a price term.',
  sentences: [(sentence) => /assessment date/i.test(sentence), (sentence) => /next review due/i.test(sentence)],
  description: ([assessed, due]) => `The most recent privacy and security risk assessment is overdue: “${assessed}” “${due}”`,
});

/** Provider credentials expiring before the end of the year the latest billed month falls in. */
export const HEALTHCARE_CREDENTIALS_EXPIRING: PackRule = {
  id: 'healthcare-credentials-expiring',
  version: '1',
  evidenceTypes: [PROVIDER, INVOICE_LINE, CLAIMS],
  detect: ({ evidence }) => {
    // The latest billed month: invoice lines, or the claims summary when billing is not in yet.
    const latest = evidence
      .map((row) => (row.evidenceType === INVOICE_LINE ? rowMonth(row) : row.evidenceType === CLAIMS ? rowMonth(row, ['month']) : null))
      .filter((month): month is string => month !== null)
      .sort()
      .at(-1);
    if (!latest) return [];
    const yearEnd = `${latest.slice(0, 4)}-12-31`;
    const expiring = evidence.filter((row) => row.evidenceType === PROVIDER && (row.canonical['credential_expiry'] ?? '9999') <= yearEnd);
    if (expiring.length === 0) return [];
    const fte = expiring.reduce((sum, row) => sum.plus(amountOf(row, 'fte')), new D(0));
    return [
      {
        key: yearEnd,
        domain: 'OPERATIONAL',
        title: 'Provider credentials expiring',
        description: `${expiring.length} providers (${fte.toString()} FTE: ${expiring.map((row) => row.canonical['provider_ref']).join(', ')}) have credentials expiring by ${yearEnd}. Without renewal they cannot bill.`,
        severity: expiring.length > 2 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A renewal plan as a closing deliverable, not a price term.',
        evidenceIds: expiring.slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};


// ---------------------------------------------------------------- provider services (T-160, ADR 0051)

type Decimal = InstanceType<typeof D>;
const cite = (rows: readonly { id: string }[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;
const pct1 = (value: Decimal | null) => (value === null ? 'n/a' : percent(value));
const daysText = (value: Decimal | null) => (value === null ? 'n/a' : `${value.toFixed(1)} days`);
const yearOf = (claim: PracticeClaim) => claim.year;

/** Tolerances for the claims register: percentage points for rates and shares, days for days in AR. */
export const PRACTICE_CLAIM_TOLERANCE = {
  DENIAL_RATE: { verified: '0.5', contradicted: '1.5' },
  PAYER_SHARE: { verified: '1', contradicted: '3' },
  DAYS_IN_AR: { verified: '2', contradicted: '5' },
} as const;

function practiceClaim(claim: PracticeClaim, status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED', basis: string, detail: string, rows: readonly RemittanceMonth[]): PackRuleProposal {
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
      quotes: [claim.quote],
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
      valueConfirmation: { valueDriver: `${claim.label} verified against the remittance export`, impliedValue: null, basis },
      evidenceIds: cite(rows),
      quotes: [claim.quote],
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
    directionRationale: 'The price was set on a figure the remittance export does not support; price the gap as a haircut on the collections the scenarios assume.',
    evidenceIds: cite(rows),
    quotes: [claim.quote],
    claim: record,
  };
}

/**
 * The claims register for a practice (the T-083/T-159 pattern): the denial rate, a payer class's share
 * of collections and days in accounts receivable as the deck states them, each set against the
 * remittance export by calendar year — VERIFIED, CONTRADICTED or UNVERIFIED — and recorded in the
 * claims register with its finding.
 */
export const HEALTHCARE_PRACTICE_CLAIMS: PackRule = {
  id: 'healthcare-practice-claims',
  version: '1',
  evidenceTypes: [REMITTANCE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const { years } = collectionYears(remittanceMonths(evidence));
    const byYear = (year: string | null) => (year ? years.find((period) => period.label === year) : years.at(-1)) ?? null;
    return practiceClaims(pages).flatMap((claim): PackRuleProposal[] => {
      if (years.length === 0) return [practiceClaim(claim, 'UNVERIFIED', 'No remittance export with a complete calendar year is in the evidence to check it against.', '', [])];
      const period = byYear(yearOf(claim));
      if (!period) return [practiceClaim(claim, 'UNVERIFIED', `The remittance export does not hold every month of ${claim.year ?? 'the year it names'}.`, '', [])];
      if (claim.key === 'DENIAL_RATE') {
        if (!period.denialRate) return [practiceClaim(claim, 'UNVERIFIED', `The export records no adjudicated claims in ${period.label}.`, '', [])];
        const actual = period.denialRate.times(100);
        const earlier = claim.from?.year ? years.find((entry) => entry.label === claim.from?.year) : years[0];
        const moved = earlier?.denialRate && earlier.label !== period.label ? (period.denialRate.gt(earlier.denialRate) ? 'UP' : period.denialRate.lt(earlier.denialRate) ? 'DOWN' : null) : null;
        const off = claim.value.minus(actual).abs();
        const history = years.map((entry) => `${entry.label} ${pct1(entry.denialRate)}`).join(', ');
        const basis = `The remittance export records ${period.denied.toFixed(0)} denied of ${period.claims.toFixed(0)} adjudicated claims in ${period.label}, a denial rate of ${actual.toFixed(1)}% (by year: ${history}).`;
        const wrongWay = claim.movement !== null && moved !== null && claim.movement !== moved;
        if (wrongWay || off.gt(PRACTICE_CLAIM_TOLERANCE.DENIAL_RATE.contradicted))
          return [practiceClaim(claim, 'CONTRADICTED', basis, `${wrongWay ? `The denial rate ${moved === 'UP' ? 'rose' : 'fell'}, not ${claim.movement === 'DOWN' ? 'fell' : 'rose'}, from ${earlier?.label ?? ''} to ${period.label}; ` : ''}the claimed ${claim.value.toFixed(1)}% is ${off.toFixed(1)} points off. ${basis}`, period.rows)];
        if (off.lte(PRACTICE_CLAIM_TOLERANCE.DENIAL_RATE.verified)) return [practiceClaim(claim, 'VERIFIED', basis, `agrees with the export. ${basis}`, period.rows)];
        return [];
      }
      if (claim.key === 'PAYER_SHARE') {
        const share = classGroupShare(period, claim.classes);
        if (!share) return [practiceClaim(claim, 'UNVERIFIED', `The export records no collections in ${period.label}.`, '', [])];
        const actual = share.times(100);
        const off = claim.value.minus(actual).abs();
        const mix = period.byClass.map((entry) => `${PAYER_CLASS_LABELS[entry.payerClass]} ${pct1(entry.share)}`).join(', ');
        const basis = `${claim.classes.map((payerClass) => PAYER_CLASS_LABELS[payerClass]).join(' and ')} payers remitted ${grouped(share.times(period.collected))} of the ${grouped(period.collected)} collected in ${period.label}, ${actual.toFixed(1)}% (the mix: ${mix}).`;
        if (off.lte(PRACTICE_CLAIM_TOLERANCE.PAYER_SHARE.verified)) return [practiceClaim(claim, 'VERIFIED', basis, `agrees with the export. ${basis}`, period.rows)];
        if (off.gt(PRACTICE_CLAIM_TOLERANCE.PAYER_SHARE.contradicted)) return [practiceClaim(claim, 'CONTRADICTED', basis, `is ${off.toFixed(1)} points off the export. ${basis}`, period.rows)];
        return [];
      }
      if (!period.daysInAr) return [practiceClaim(claim, 'UNVERIFIED', `The export does not carry receivables for every payer at the end of ${period.label}.`, '', [])];
      const off = claim.value.minus(period.daysInAr).abs();
      const basis = `Receivables of ${grouped(period.arAtEnd ?? new D(0))} at the end of ${period.label} against ${grouped(period.billed)} of charges billed in the year (${grouped(period.billed.div(365))} a day) are ${period.daysInAr.toFixed(1)} days.`;
      if (off.lte(PRACTICE_CLAIM_TOLERANCE.DAYS_IN_AR.verified)) return [practiceClaim(claim, 'VERIFIED', basis, `agrees with the export. ${basis}`, period.rows.filter((row) => row.month === period.to))];
      if (off.gt(PRACTICE_CLAIM_TOLERANCE.DAYS_IN_AR.contradicted)) return [practiceClaim(claim, 'CONTRADICTED', basis, `is ${off.toFixed(1)} days off the export. ${basis}`, period.rows.filter((row) => row.month === period.to))];
      return [];
    });
  },
};

/** Lines of the imported P&L read as patient-service revenue, to reconcile to the remittance export. */
export const PATIENT_REVENUE_LINE = /\b(?:patient|clinical|service|services|fee-for-service)\b/i;
/** A year's collections and the P&L's patient-service revenue differing by more than this share is a finding. */
export const COLLECTIONS_RECONCILIATION_TOLERANCE = '0.02';

/** The remittance export's collections for each calendar year it covers in full, against the P&L's patient-service revenue lines. */
export function collectionsReconciliation(evidence: readonly PackRuleEvidence[]) {
  const { years } = collectionYears(remittanceMonths(evidence));
  const periods = pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE)));
  return years.flatMap((year) => {
    const read = pnlForPeriod(periods, year.label);
    if (!read) return [];
    const lines = read.sources.filter((row) => row.kind === 'REVENUE' && PATIENT_REVENUE_LINE.test(row.account));
    if (lines.length === 0) return [];
    const pnl = lines.reduce((total, row) => total.plus(row.amount), new D(0));
    const difference = pnl.minus(year.collected);
    return [{ year: year.label, collected: year.collected, pnl, difference, relative: year.collected.gt(0) ? difference.div(year.collected) : null, accounts: [...new Set(lines.map((row) => row.account))], rows: year.rows, pnlIds: lines.map((row) => row.evidenceId) }];
  });
}

/** The P&L's patient-service revenue against the cash the remittance export records, year by year. */
export const HEALTHCARE_COLLECTIONS_RECONCILIATION: PackRule = {
  id: 'healthcare-collections-reconciliation',
  version: '1',
  evidenceTypes: [REMITTANCE, PNL_LINE],
  detect: ({ evidence }) =>
    collectionsReconciliation(evidence).flatMap((year): PackRuleProposal[] => {
      if (!year.relative || year.relative.abs().lte(COLLECTIONS_RECONCILIATION_TOLERANCE)) return [];
      return [
        {
          key: `${year.year}`,
          domain: 'FINANCIAL',
          title: `P&L patient revenue does not reconcile to collections, ${year.year}`,
          description:
            `The imported P&L books ${grouped(year.pnl)} of patient-service revenue for ${year.year} (${year.accounts.join(', ')}); the remittance export records ${grouped(year.collected)} collected in the same twelve months, ` +
            `${grouped(year.difference.abs())} (${percent(year.relative.abs())}) ${year.difference.gt(0) ? 'more in the P&L' : 'less in the P&L'}. Ask the seller to reconcile the two before relying on the revenue line.`,
          severity: year.relative.abs().gt('0.05') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: [...year.pnlIds, ...cite(year.rows)].slice(0, MAX_CITED),
        },
      ];
    }),
};

/** A denial rate that rose every year by at least this much in total (a fraction) is a finding. */
export const DENIAL_RISE_POINTS = '0.01';
/** Days in AR that rose every year by at least this many days in total is a finding. */
export const DAYS_IN_AR_RISE = '5';

/**
 * Denials and days in AR as trends across every complete calendar year of the remittance export: a
 * denial rate rising every year, or receivables taking longer to collect every year, each a drag on the
 * collections the scenarios assume. One year reads as one year: nothing is drafted until there are two.
 */
export const HEALTHCARE_COLLECTIONS_TREND: PackRule = {
  id: 'healthcare-collections-trend',
  version: '1',
  evidenceTypes: [REMITTANCE],
  detect: ({ evidence }) => {
    const { years } = collectionYears(remittanceMonths(evidence));
    if (years.length < 2) return [];
    const first = years[0] as CollectionsPeriod;
    const last = years.at(-1) as CollectionsPeriod;
    const span = `${first.label}–${last.label}`;
    const rising = (values: readonly (Decimal | null)[]) => values.every((value) => value !== null) && values.every((value, index) => index === 0 || (value as Decimal).gt(values[index - 1] as Decimal));
    const out: PackRuleProposal[] = [];
    const denials = years.map((year) => year.denialRate);
    if (rising(denials) && (last.denialRate as Decimal).minus(first.denialRate as Decimal).gte(DENIAL_RISE_POINTS)) {
      const change = (last.denialRate as Decimal).minus(first.denialRate as Decimal);
      out.push({
        key: `${span}:denials`,
        domain: 'FINANCIAL',
        title: `Denial rate rising, ${span}`,
        description:
          `Denied ÷ adjudicated claims rose every year in the remittance export: ${years.map((year) => `${year.label} ${pct1(year.denialRate)} (${year.denied.toFixed(0)} of ${year.claims.toFixed(0)})`).join(', ')}, up ${points(change)}. ` +
          `A single year shows ${pct1(last.denialRate)}, which reads as one figure on its own. Denied claims are reworked or written off; price it as a haircut on the collections the scenarios assume.`,
        severity: change.gte('0.03') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(years.flatMap((year) => year.rows.filter((row) => row.month === year.to))),
      });
    }
    const ar = years.map((year) => year.daysInAr);
    if (rising(ar) && (last.daysInAr as Decimal).minus(first.daysInAr as Decimal).gte(DAYS_IN_AR_RISE)) {
      out.push({
        key: `${span}:ar`,
        domain: 'FINANCIAL',
        title: `Days in accounts receivable rising, ${span}`,
        description:
          `Receivables at each year end ÷ charges billed per day rose every year: ${years.map((year) => `${year.label} ${daysText(year.daysInAr)}`).join(', ')}. ` +
          'Collections are slowing; price it as working capital the business needs, or a haircut on the collections the scenarios assume.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite(years.flatMap((year) => year.rows.filter((row) => row.month === year.to))),
      });
    }
    return out;
  },
};

/** A shift in claims toward the lowest-paying payer class of at least this many points (a fraction) is a finding. */
export const PAYER_MIX_SHIFT_POINTS = '0.03';

/**
 * The payer mix across every complete calendar year: when the payer class that pays least per claim
 * (in the latest year) takes a growing share of claims, revenue per visit falls even if volume holds.
 * The cost is stated as arithmetic: the latest year's claims at the first year's mix and the latest
 * year's yields, against what was collected.
 */
export const HEALTHCARE_PAYER_MIX_SHIFT: PackRule = {
  id: 'healthcare-payer-mix-shift',
  version: '1',
  evidenceTypes: [REMITTANCE],
  detect: ({ evidence }) => {
    const { years } = collectionYears(remittanceMonths(evidence));
    if (years.length < 2) return [];
    const first = years[0] as CollectionsPeriod;
    const last = years.at(-1) as CollectionsPeriod;
    const priced = last.byClass.filter((entry) => entry.yieldPerClaim && entry.claims.gt(0));
    const lowest = [...priced].sort((a, b) => (a.yieldPerClaim as Decimal).comparedTo(b.yieldPerClaim as Decimal))[0];
    if (!lowest || priced.length < 2) return [];
    const before = first.byClass.find((entry) => entry.payerClass === lowest.payerClass)?.claimShare ?? new D(0);
    const after = lowest.claimShare ?? new D(0);
    const shift = after.minus(before);
    if (shift.lt(PAYER_MIX_SHIFT_POINTS)) return [];
    // The latest year's claims at the first year's mix, each class at its latest-year yield.
    const atFirstMix = priced.reduce((total, entry) => total.plus(last.claims.times(first.byClass.find((old) => old.payerClass === entry.payerClass)?.claimShare ?? new D(0)).times(entry.yieldPerClaim as Decimal)), new D(0));
    const cost = atFirstMix.minus(last.collected);
    const label = PAYER_CLASS_LABELS[lowest.payerClass];
    const span = `${first.label}–${last.label}`;
    const yields = priced.map((entry) => `${PAYER_CLASS_LABELS[entry.payerClass]} ${grouped(entry.yieldPerClaim as Decimal)}`).join(', ');
    return [
      {
        key: `${span}:${lowest.payerClass}`,
        domain: 'COMMERCIAL',
        title: `Payer mix shifted toward ${label}, the lowest-paying payer class, ${span}`,
        description:
          `${label} claims went from ${pct1(before)} of all claims in ${first.label} to ${pct1(after)} in ${last.label} (${years.map((year) => `${year.label} ${pct1(year.byClass.find((entry) => entry.payerClass === lowest.payerClass)?.claimShare ?? null)}`).join(', ')}). ` +
          `${label} pays least per claim in ${last.label} (collected per claim: ${yields}). ` +
          (cost.gt(0) ? `At ${first.label}'s mix and ${last.label}'s yields, ${last.label} collections would have been ${grouped(cost)} higher (${percent(cost.div(last.collected))}). ` : '') +
          'From the remittance export; price it as a haircut on the revenue per visit the scenarios assume.',
        severity: shift.gte('0.06') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        pricedRisk: null,
        evidenceIds: cite([...last.rows.filter((row) => row.payerClass === lowest.payerClass), ...first.rows.filter((row) => row.payerClass === lowest.payerClass)]),
      },
    ];
  },
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  state_licence: 'licence',
  controlled_substance: 'controlled-substance registration',
  board_certification: 'board certification',
  payer_enrollment: 'payer enrolment',
};
const credentialName = (status: CredentialStatus) => `${status.row.jurisdiction} ${KIND_LABEL[status.row.kind] ?? 'credential'}`;
const monthsAgo = (dayCount: number) => Math.round(dayCount / 30.44);

/**
 * Every clinician on the roster against their licences and credentials at the analysis date (the end
 * of the latest remittance month). The verification documents govern the dates where they state them,
 * so the check waits until documents have been read. A clinician whose state licence had expired but
 * who still collected in later months is practising on an expired licence: a high-severity drag. An
 * expired credential with no later collections, one expiring within 90 days, and a rostered clinician
 * with no licence on file are closing conditions and requests. Dates only: whether the work was lawful,
 * and what payers may recoup, is for counsel.
 */
export const HEALTHCARE_CREDENTIALING: PackRule = {
  id: 'healthcare-credentialing',
  version: '1',
  evidenceTypes: [CREDENTIAL, CLINICIAN_MONTH, REMITTANCE, PROVIDER],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // The verification documents govern the dates: until any has been read, wait for them.
    if (pages.length === 0) return [];
    const asOf = healthcareAnalysisDate(remittanceMonths(evidence));
    const rows = credentialRows(evidence);
    const collections = clinicianMonths(evidence);
    const statuses = credentialStatuses(rows, pages, asOf, collections);
    const found = statuses.flatMap((status): PackRuleProposal[] => {
      const quotes: PackRuleQuote[] = status.document ? [status.document.quote] : [];
      const source = status.document ? 'the verification document states' : 'the register records';
      const register = status.registerDiffers ? ` The register gives ${status.row.expiresOn ?? 'no date'} (status ${status.row.status}); the verification document governs.` : '';
      const ref = status.row.providerRef;
      const name = credentialName(status);
      if (status.state === 'EXPIRED') {
        const when =
          status.expiresOn && status.daysPastExpiry !== null && status.daysPastExpiry > 0
            ? `${source} it expired on ${status.expiresOn}, ${monthsAgo(status.daysPastExpiry)} month${monthsAgo(status.daysPastExpiry) === 1 ? '' : 's'} before the latest remittance month ends (${asOf ?? ''})`
            : `the register records it as ${status.row.status}`;
        if (status.row.kind === 'state_licence' && status.collectedAfter) {
          const after = status.collectedAfter;
          return [
            {
              key: `${ref}:${status.row.credentialRef}:practising`,
              domain: 'REGULATORY',
              title: `Practising on an expired licence: ${ref}`,
              description:
                `${ref}'s ${name}, issued by ${status.row.issuer}: ${when}.${register} ` +
                `The collections export still records ${grouped(after.collected)} collected on ${ref}'s claims in ${after.months.length} later month${after.months.length === 1 ? '' : 's'} (${after.months[0] ?? ''} to ${after.months.at(-1) ?? ''})${after.visits ? `, ${after.visits.toFixed(0)} visits` : ''}. ` +
                'Pactlab reports dates and arithmetic only; whether the work was lawful, and what payers may recoup, is for counsel. Price it (an escrow or a special indemnity) and make reinstatement a closing condition.',
              severity: 'HIGH',
              confidence: 'HIGH',
              direction: -1,
              pricedRisk: null,
              evidenceIds: [status.row.id, ...cite(after.rows)].slice(0, MAX_CITED),
              quotes,
            },
          ];
        }
        return [
          {
            key: `${ref}:${status.row.credentialRef}:lapsed`,
            domain: 'REGULATORY',
            title: `Expired ${KIND_LABEL[status.row.kind] ?? 'credential'}: ${ref}`,
            description: `${ref}'s ${name}, issued by ${status.row.issuer}: ${when}.${register} No collections are recorded for ${ref} after that date. Make renewal, or removal from the roster, a closing condition.`,
            severity: 'MEDIUM',
            confidence: 'HIGH',
            direction: 0,
            directionRationale: 'An expired credential with no collections after its expiry: a closing condition, not a price adjustment.',
            evidenceIds: [status.row.id],
            quotes,
          },
        ];
      }
      if (status.state === 'NEAR_EXPIRY' && status.expiresOn)
        return [
          {
            key: `${ref}:${status.row.credentialRef}:${status.expiresOn}:near-expiry`,
            domain: 'REGULATORY',
            title: `${KIND_LABEL[status.row.kind] ?? 'Credential'} expires within ${CREDENTIAL_NEAR_EXPIRY_DAYS} days: ${ref}`.replace(/^./, (letter) => letter.toUpperCase()),
            description: `${ref}'s ${name}, issued by ${status.row.issuer}: ${source} it expires on ${status.expiresOn}, ${-(status.daysPastExpiry ?? 0)} days after the latest remittance month ends.${register} Make its renewal a closing condition.`,
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
    const missing = unlicensedRoster(evidence, rows, pages).map(
      (row): PackRuleProposal => ({
        key: `${row.canonical['provider_ref'] ?? ''}:no-licence`,
        domain: 'REGULATORY',
        title: `No licence on file: ${row.canonical['provider_ref'] ?? ''}`,
        description: `${row.canonical['provider_ref'] ?? ''} is on the provider roster, but neither the credentialing register nor a verification document records a state licence for them. Request the primary-source verification before relying on their collections.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'Evidence to request, not a defect to price.',
        evidenceIds: [row.id],
      }),
    );
    return [...found, ...missing];
  },
};

/** One clinician's share of trailing collections at or above this is a concentration to check for a non-compete or retention agreement. */
export const CLINICIAN_CONCENTRATION_THRESHOLD = '0.2';

/**
 * Clinician concentration from the collections export: a clinician carrying a fifth or more of the
 * trailing twelve months' collections, with no document in the evidence that names them with a
 * non-compete, non-solicitation or retention agreement, is a key-person drag. Clinicians appear only as
 * pseudonymous references; this is a retention risk, never a ranking or a performance measure. The
 * check waits until documents have been read, since a document may cover it.
 */
export const HEALTHCARE_CLINICIAN_CONCENTRATION: PackRule = {
  id: 'healthcare-clinician-concentration',
  version: '1',
  evidenceTypes: [CLINICIAN_MONTH],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    if (pages.length === 0) return [];
    const shares = clinicianShares(clinicianMonths(evidence));
    if (!shares || shares.missing.length || !shares.total.gt(0)) return [];
    return shares.clinicians
      .filter((clinician) => clinician.share && clinician.share.gte(CLINICIAN_CONCENTRATION_THRESHOLD) && !covenantFor(pages, clinician.providerRef))
      .map(
        (clinician): PackRuleProposal => ({
          key: `${clinician.providerRef}:${shares.to}`,
          domain: 'PEOPLE',
          title: `${percent(clinician.share as Decimal)} of collections from one clinician, no non-compete on file: ${clinician.providerRef}`,
          description:
            `${clinician.providerRef} collected ${grouped(clinician.collected)} of the ${grouped(shares.total)} the collections export records for ${monthName(shares.from)} to ${monthName(shares.to)}, ${percent(clinician.share as Decimal)}. ` +
            `No document in the evidence names ${clinician.providerRef} with a non-compete, non-solicitation or retention agreement. A retention risk, not a ranking: price it (a retention holdback or an earn-out tied to the clinician staying) or make a signed agreement a closing condition.`,
          severity: (clinician.share as Decimal).gte('0.3') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: cite(clinician.rows),
        }),
      );
  },
};

/**
 * Every payer that remitted in the trailing twelve months against the payer contract register at the
 * analysis date: a payer still remitting after its contract expired is a drag on the rates the scenarios
 * assume; a contract ending within a year without automatic renewal is a renegotiation inside the hold;
 * a payer with no contract on the register is evidence to request. Self-pay aside.
 */
export const HEALTHCARE_PAYER_CONTRACTS: PackRule = {
  id: 'healthcare-payer-contracts',
  version: '1',
  evidenceTypes: [PAYER_CONTRACT, REMITTANCE],
  detect: ({ evidence }) => {
    const contracts = payerContracts(evidence);
    if (contracts.length === 0) return [];
    const rows = remittanceMonths(evidence);
    return payerContractStatuses(rows, contracts, healthcareAnalysisDate(rows)).flatMap((status): PackRuleProposal[] => {
      const share = `${grouped(status.collected)} collected in the trailing twelve months (${pct1(status.share)} of collections)`;
      const contract = status.contract;
      if (status.state === 'MISSING')
        return [
          {
            key: `${status.payer}:no-contract`,
            domain: 'COMMERCIAL',
            title: `No payer contract on file: ${status.payer}`,
            description: `${status.payer} remitted ${share}, but the payer contract register holds no contract or enrolment for it. Request it before relying on its rates.`,
            severity: status.share && status.share.gte('0.1') ? 'MEDIUM' : 'LOW',
            confidence: 'HIGH',
            direction: 0,
            directionRationale: 'Evidence to request, not a defect to price.',
            evidenceIds: cite(status.rows),
          },
        ];
      if (!contract) return [];
      if (status.state === 'EXPIRED')
        return [
          {
            key: `${contract.contractId}:expired`,
            domain: 'COMMERCIAL',
            title: `Payer contract expired: ${status.payer}`,
            description: `The register gives ${contract.contractId} with ${status.payer} an expiry of ${contract.expiresOn ?? ''}, ${-(status.daysToExpiry ?? 0)} days before the latest remittance month ends, with no automatic renewal; the payer still remitted ${share}. Confirm the terms it pays on now; price any rate change as a haircut on the collections the scenarios assume.`,
            severity: 'HIGH',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            evidenceIds: [contract.id, ...cite(status.rows)].slice(0, MAX_CITED),
          },
        ];
      if (status.state === 'EXPIRING')
        return [
          {
            key: `${contract.contractId}:${contract.expiresOn ?? ''}:expiring`,
            domain: 'COMMERCIAL',
            title: `Payer contract ends within a year: ${status.payer}`,
            description: `The register gives ${contract.contractId} with ${status.payer} an expiry of ${contract.expiresOn ?? ''}, ${status.daysToExpiry ?? 0} days after the latest remittance month ends, with no automatic renewal. The payer remitted ${share}. A renegotiation inside the hold: run the rate sensitivity and make the renewal plan a closing deliverable.`,
            severity: status.share && status.share.gte('0.1') ? 'MEDIUM' : 'LOW',
            confidence: 'HIGH',
            direction: 0,
            directionRationale: 'A renegotiation inside the hold: a scenario sensitivity and a closing deliverable, not a price adjustment.',
            evidenceIds: [contract.id, ...cite(status.rows)].slice(0, MAX_CITED),
          },
        ];
      return [];
    });
  },
};

/**
 * Compliance evidence on file: the HIPAA risk assessment, coding and billing audits, licence
 * verifications and the non-compete and retention schedule, recognised by their headings. A coding or
 * billing audit more than a year old at the analysis date is drafted for review, cited to its heading
 * (the HIPAA assessment's age is the T-061 privacy rule's). Absence is shown as absence on the Practice
 * page and the intake checklist, never drafted: a finding must cite its evidence. Presence and dates
 * only: never whether coding or billing is compliant.
 */
export const HEALTHCARE_COMPLIANCE_EVIDENCE: PackRule = {
  id: 'healthcare-compliance-evidence',
  version: '1',
  evidenceTypes: [REMITTANCE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const asOf = healthcareAnalysisDate(remittanceMonths(evidence));
    if (!asOf) return [];
    return healthcareComplianceDocuments(pages)
      .filter((document) => document.kind === 'CODING_AUDIT' && document.date && Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${document.date}T00:00:00Z`) > CODING_AUDIT_STALE_DAYS * 86_400_000)
      .map(
        (document): PackRuleProposal => ({
          key: `${document.documentId}:stale`,
          domain: 'REGULATORY',
          title: 'Coding or billing audit more than a year old',
          description: `The audit on file is dated ${document.date ?? ''}, more than ${CODING_AUDIT_STALE_DAYS} days before the latest remittance month ends (${asOf}). Request a current one; Pactlab records its date, not whether the coding is compliant.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A gap in current evidence, requested before close; not a price adjustment.',
          evidenceIds: [],
          quotes: [document.quote],
        }),
      );
  },
};

/** The healthcare key expenses the multi-year trend watches against revenue. */
export const HEALTHCARE_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'denials', label: 'Denial write-offs and bad debt', pattern: /\b(?:denial|write-?offs?|bad debt)\b/i },
  { key: 'clinical', label: 'Clinical staff costs', pattern: /\bclinical (?:staff|labou?r)\b|\bclinician (?:costs?|pay)\b/i },
  { key: 'supplies', label: 'Medical supplies', pattern: /\bmedical suppl/i },
  { key: 'billing', label: 'Billing and collection costs', pattern: /\b(?:billing|revenue cycle|collection costs?)\b/i },
];

export const [HEALTHCARE_PNL_TREND, HEALTHCARE_PNL_MARGIN_DRIFT, HEALTHCARE_PNL_EXPENSE_OUTPACING] = pnlTrendRules('healthcare', HEALTHCARE_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/**
 * Five years of history (T-184b, ADR 0057): the P&L by year, visits from the collections export and the
 * commercial share and denial rate from the remittances, by calendar year. Small clinics read the same
 * drivers with their own key expenses. The denial rate rising every year is healthcare-collections-trend's;
 * visits falling every year is the driver trend below.
 */
export const HEALTHCARE_DRIVERS = {
  visits: { key: 'visits', label: 'Visits', unit: 'COUNT', evidenceType: CLINICIAN_MONTH, mode: 'SUM', numerator: ['visits'], formula: 'Σ visits in the year, every clinician' },
  commercialShare: {
    key: 'commercial_share',
    label: 'Commercial share of collections',
    unit: 'RATIO',
    evidenceType: REMITTANCE,
    mode: 'RATIO',
    numerator: ['collected'],
    numeratorWhere: { field: 'payer_class', values: ['commercial'] },
    denominator: ['collected'],
    formula: 'Σ collected from commercial payers ÷ Σ collected in the year',
  },
  denialRate: { key: 'denial_rate', label: 'Denial rate', unit: 'RATIO', evidenceType: REMITTANCE, mode: 'RATIO', numerator: ['denied_claims'], denominator: ['claims'], formula: 'Σ denied ÷ Σ adjudicated claims in the year' },
} as const satisfies Record<string, DriverSpec>;

export const HEALTHCARE_HISTORY: PackHistorySpec = {
  drivers: [HEALTHCARE_DRIVERS.visits, HEALTHCARE_DRIVERS.commercialShare, HEALTHCARE_DRIVERS.denialRate],
  keyExpenses: HEALTHCARE_KEY_EXPENSES,
  driverImport: ['HEALTHCARE_REMITTANCES', 'HEALTHCARE_CLINICIAN_COLLECTIONS'],
  driverLabel: 'Remittances and collections',
  driverWhat: 'remittance and collections history',
};

/** Visits falling every year by this share or more, first year to last (5%). */
export const VISITS_DECLINE_SHARE = '0.05';

export const HEALTHCARE_VISITS_TREND = driverTrendRule(
  {
    id: 'healthcare-visits-trend',
    driver: HEALTHCARE_DRIVERS.visits,
    adverse: 'DOWN',
    threshold: VISITS_DECLINE_SHARE,
    domain: 'COMMERCIAL',
    advice: 'Fewer patients are seen each year: growth in collections is coming from price and mix, not volume. Check referrals, clinician capacity and the payer contracts before projecting volume forward.',
  },
  HEALTHCARE_HISTORY,
);

export const HEALTHCARE_RULES: readonly PackRule[] = [
  HEALTHCARE_GOVERNMENT_CONCENTRATION,
  HEALTHCARE_DIRECTOR_FEE,
  HEALTHCARE_PRIVACY_ASSESSMENT,
  HEALTHCARE_CREDENTIALS_EXPIRING,
  HEALTHCARE_PRACTICE_CLAIMS,
  HEALTHCARE_COLLECTIONS_RECONCILIATION,
  HEALTHCARE_COLLECTIONS_TREND,
  HEALTHCARE_PAYER_MIX_SHIFT,
  HEALTHCARE_CREDENTIALING,
  HEALTHCARE_CLINICIAN_CONCENTRATION,
  HEALTHCARE_PAYER_CONTRACTS,
  HEALTHCARE_COMPLIANCE_EVIDENCE,
  HEALTHCARE_PNL_TREND,
  HEALTHCARE_PNL_MARGIN_DRIFT,
  HEALTHCARE_PNL_EXPENSE_OUTPACING,
  HEALTHCARE_VISITS_TREND,
  // The recent run against the long run (T-185): quiet until ten years or more are read.
  recentRunRule('healthcare', HEALTHCARE_HISTORY),
];
export const HEALTHCARE_EVIDENCE = { PROVIDER, CLAIMS, REMITTANCE, CLINICIAN_MONTH, CREDENTIAL, PAYER_CONTRACT } as const;
