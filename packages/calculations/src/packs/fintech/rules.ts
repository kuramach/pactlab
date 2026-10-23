import { D, parseDecimal, sum } from '../../metrics/decimal';
import { findMatch, findSentence, MAX_CITED, sentences, type PackRule, type PackRuleEvidence } from '../rule-types';

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

export const FINTECH_RULES: readonly PackRule[] = [FINTECH_CREDIT_LOSS, FINTECH_AML_UNREVIEWED, FINTECH_PARTNER_BANK_COC];
