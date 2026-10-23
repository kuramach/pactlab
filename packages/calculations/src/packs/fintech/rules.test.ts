import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { FINTECH_AML_UNREVIEWED, FINTECH_CREDIT_LOSS, FINTECH_PARTNER_BANK_COC } from './rules';

const loan = (id: string, principal: string, balance: string, status: string, currency = 'USD'): PackRuleEvidence => ({
  id,
  evidenceType: 'fintech.loan',
  sourceRecordId: id,
  canonical: { loan_id: id, principal, balance, status, currency },
});
const page = (text: string, pageNumber = 1): PackRulePage => ({ documentId: '01900000-0000-7000-8000-0000000e0001', pageNumber, text });

// 100,000 originated; 10,000 charged off (10%); 60,000 outstanding; allowance 1,200 (2%).
const tape = [loan('L1', '40000.00', '30000.00', 'current'), loan('L2', '50000.00', '30000.00', 'delinquent'), loan('L3', '10000.00', '0.00', 'charged_off')];
const balanceSheet = page('Merchant loans receivable, gross: USD 60,000\nAllowance for credit losses: USD 1,200 (2.0% of gross loans)');

describe('fintech rules', () => {
  it('credit loss: prices the gap between observed losses and the allowance, citing the tape and the balance-sheet line', () => {
    const [finding, ...rest] = FINTECH_CREDIT_LOSS.detect({ evidence: tape, pages: [balanceSheet] });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ domain: 'FINANCIAL', direction: -1, severity: 'HIGH', evidenceIds: ['L3'] });
    // (10% − 2%) × 60,000 = 4,800; low end half.
    expect(finding?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency: 'USD', low: '2400.00', high: '4800.00' });
    expect(finding?.quotes).toEqual([{ documentId: balanceSheet.documentId, pageNumber: 1, quote: 'Allowance for credit losses: USD 1,200' }]);
    expect(finding?.description).toContain('10.0% of originated principal');
    expect(finding?.description).toContain('2.0% of the USD 60,000 outstanding');
  });

  it('credit loss: silent when the allowance covers losses, is missing, or is in another currency', () => {
    expect(FINTECH_CREDIT_LOSS.detect({ evidence: tape, pages: [page('Allowance for credit losses: USD 9,000')] })).toEqual([]);
    expect(FINTECH_CREDIT_LOSS.detect({ evidence: tape, pages: [page('No allowance here')] })).toEqual([]);
    expect(FINTECH_CREDIT_LOSS.detect({ evidence: tape, pages: [page('Allowance for credit losses: EUR 1,200')] })).toEqual([]);
    expect(FINTECH_CREDIT_LOSS.detect({ evidence: [...tape, loan('L4', '1.00', '1.00', 'current', 'EUR')], pages: [balanceSheet] })).toEqual([]);
  });

  it('AML: counts closed alerts without review evidence and cites the written procedure', () => {
    const alerts: PackRuleEvidence[] = Array.from({ length: 10 }, (_, index) => ({
      id: `A${index}`,
      evidenceType: 'fintech.aml_alert',
      sourceRecordId: `A${index}`,
      canonical: { status: index === 9 ? 'open' : 'closed', review_evidence: index < 3 ? 'no' : 'yes' },
    }));
    const procedure = page('Policy\nEvery alert must be reviewed by a compliance analyst before closure. The analyst records the evidence.');
    const [finding] = FINTECH_AML_UNREVIEWED.detect({ evidence: alerts, pages: [procedure] });
    expect(finding).toMatchObject({ domain: 'REGULATORY', direction: -1, pricedRisk: null, severity: 'HIGH', evidenceIds: ['A0', 'A1', 'A2'] });
    expect(finding?.description).toMatch(/^3 of 9 closed/);
    // Line breaks collapse (PDFs wrap text), so an unpunctuated heading joins the next sentence; the quote is still exactly on the page.
    expect(finding?.quotes?.[0]?.quote).toBe('Policy Every alert must be reviewed by a compliance analyst before closure.');
    expect(FINTECH_AML_UNREVIEWED.detect({ evidence: alerts.map((alert) => ({ ...alert, canonical: { ...alert.canonical, review_evidence: 'yes' } })), pages: [] })).toEqual([]);
  });

  it('matches a clause wrapped across PDF lines', () => {
    const wrapped = page('22.3 The Bank may terminate this agreement on ninety\ndays\u2019 notice if the Program Manager undergoes a change\nof control without consent.', 2);
    expect(FINTECH_PARTNER_BANK_COC.detect({ evidence: [], pages: [wrapped] })[0]?.quotes?.[0]?.quote).toBe('22.3 The Bank may terminate this agreement on ninety days\u2019 notice if the Program Manager undergoes a change of control without consent.');
  });

  it('partner bank: a change-of-control termination clause is a neutral closing condition', () => {
    const agreement = page('Program agreement\n22.3 The Bank may terminate this agreement on ninety days’ notice if the Program Manager undergoes a change of control without the Bank’s prior written consent.', 2);
    const [finding] = FINTECH_PARTNER_BANK_COC.detect({ evidence: [], pages: [agreement, page('Nothing relevant.')] });
    expect(finding).toMatchObject({ domain: 'LEGAL', direction: 0, evidenceIds: [], key: `${agreement.documentId}:2` });
    expect(finding?.directionRationale).toMatch(/closing condition/);
    expect(finding?.quotes?.[0]?.quote).toContain('22.3 The Bank may terminate this agreement');
    expect(FINTECH_PARTNER_BANK_COC.detect({ evidence: [], pages: [page('A change of control requires notice to the customer.')] })).toEqual([]);
  });
});
