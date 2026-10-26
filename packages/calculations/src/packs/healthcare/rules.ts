import { D, parseDecimal } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, INVOICE_LINE, rowMonth, percent, revenueConcentrationRule } from '../common';
import { findSentence, MAX_CITED, type PackRule } from '../rule-types';

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

export const HEALTHCARE_RULES: readonly PackRule[] = [HEALTHCARE_GOVERNMENT_CONCENTRATION, HEALTHCARE_DIRECTOR_FEE, HEALTHCARE_PRIVACY_ASSESSMENT, HEALTHCARE_CREDENTIALS_EXPIRING];
export const HEALTHCARE_EVIDENCE = { PROVIDER, CLAIMS } as const;
