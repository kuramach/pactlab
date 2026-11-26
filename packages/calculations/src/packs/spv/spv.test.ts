import { describe, expect, it } from 'vitest';
import { D } from '../../metrics/decimal';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { roundStatement, sideLetters, spvDocuments, vehicleStatement } from './documents';
import { spvEconomics, spvReturns, SpvReturnsError } from './economics';
import { spvMetrics } from './metrics';
import { roundCheckOf, SPV_CAP_TABLE_MATH, SPV_FEE_CARRY, SPV_FORM_D, SPV_INSTRUMENT_TERMS, SPV_ROUND_CLAIMS, SPV_SIDE_LETTERS, spvAccreditationCheck } from './rules';

const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const cap = (id: string, fields: Record<string, string>): PackRuleEvidence => ({ id: `ev-${id}`, evidenceType: 'venture.cap_table_row', sourceRecordId: id, canonical: { security_id: id, ...fields } });
const invoice = (id: string, amount: string): PackRuleEvidence => ({ id: `inv-${id}`, evidenceType: 'billing.invoice_line', sourceRecordId: id, canonical: { created: '2026-09-15', amount, currency: 'USD', interval: 'month', interval_count: '1', customer_name: `C${id}` } });
const month = (m: string, cash: string, burn: string): PackRuleEvidence => ({ id: `fin-${m}`, evidenceType: 'venture.financials_month', sourceRecordId: m, canonical: { month: m, cash_balance: cash, net_burn: burn } });

const CAP_TABLE = [
  cap('CS-1', { holder_ref: 'F-1', holder_type: 'founder', instrument: 'common', shares: '6000000' }),
  cap('OPT-POOL', { holder_ref: 'POOL', holder_type: 'pool', instrument: 'pool_unallocated', shares: '2000000' }),
  cap('SAFE-1', { holder_ref: 'I-1', holder_type: 'investor', instrument: 'safe', principal: '300000', valuation_cap: '6000000', discount_pct: '20', mfn: 'no', pro_rata: 'yes' }),
];
const ROUND = page(
  'round',
  'ROUND SUMMARY — Seed round of Lumen Labs (synthetic). Pre-money valuation: USD 8,000,000. Round size: USD 3,000,000. Price per share: USD 1.00. New shares issued: 3,000,000. Fully diluted shares after the round: 11,000,000. ARR: USD 1,200,000. Runway: 18 months. Net revenue retention: 128%. Prior round: SAFE with a valuation cap of USD 6,000,000 and a 20% discount, with pro-rata rights.',
);
const SAFE = page('safe', 'SIMPLE AGREEMENT FOR FUTURE EQUITY (synthetic). Instrument: SAFE-1. Purchase Amount: USD 300,000. Valuation Cap: USD 6,000,000. Discount Rate: 20%. Most favoured nation: no. Pro rata rights: yes.');
const AGREEMENT = page(
  'oa',
  'OPERATING AGREEMENT OF LUMEN SEED SPV LLC (synthetic). Management Fee: 2% of capital commitments, charged once at closing. Carried Interest: 20% of net profits. Expenses: up to USD 25,000 of organizational expenses, borne by the Members. Organizer Commitment: USD 50,000 alongside the Members. This offering is made under Rule 506(c) of Regulation D.',
);
const SUMMARY = page('sum', 'SUMMARY OF TERMS for investors in Lumen Seed SPV LLC (synthetic). Management fee: 2% of commitments, charged once. Carry: 15%. Expenses: capped at USD 25,000. Side letters: none.');
const LETTER = page('sl', 'SIDE LETTER to the operating agreement of Lumen Seed SPV LLC (synthetic). Investor reference: INV-03. Management fee: waived for this investor. Information rights: quarterly reports.');
const FORM_D = page('fd', 'FORM D — Notice of Exempt Offering of Securities (synthetic). Issuer: Lumen Seed SPV LLC.');
const BILLING = Array.from({ length: 10 }, (_, index) => invoice(String(index), '10000'));
const FINANCIALS = [month('2026-07', '2000000', '100000'), month('2026-08', '1900000', '100000'), month('2026-09', '1800000', '100000')];
const ALL_PAGES = [ROUND, SAFE, AGREEMENT, SUMMARY, LETTER, FORM_D];

describe('SPV documents (T-141)', () => {
  it('recognises each document by its heading and reads what it states, with the sentence', () => {
    const documents = spvDocuments([...ALL_PAGES, page('other', 'Board minutes of 2026-01-01.')]);
    expect(documents.map((document) => document.kind).sort()).toEqual(['FORM_D', 'INSTRUMENT', 'INVESTOR_SUMMARY', 'OPERATING_AGREEMENT', 'ROUND_SUMMARY', 'SIDE_LETTER']);
    const round = roundStatement(documents);
    expect(round.postRoundShares?.value.toFixed()).toBe('11000000');
    expect(round.postRoundShares?.quote.quote).toBe('Fully diluted shares after the round: 11,000,000.');
    expect(round.priorRound?.value).toMatchObject({ proRata: true, mfn: null });
    const vehicle = vehicleStatement(documents);
    expect(vehicle.agreement?.carry?.value.toFixed()).toBe('0.2');
    expect(vehicle.summary?.carry?.value.toFixed()).toBe('0.15');
    expect(vehicle.agreement?.expenseCap?.value.amount.toFixed()).toBe('25000');
    expect(vehicle.exemption?.value).toBe('RULE_506C');
    expect(vehicle.sideLetterDisclosure?.value).toBe('NONE');
    expect(sideLetters(documents)[0]).toMatchObject({ investorRef: 'INV-03', effects: [{ kind: 'FEE_WAIVER', economic: true }, { kind: 'INFORMATION_RIGHTS', economic: false }] });
  });
});

describe('SPV round math (spv-round-check-1)', () => {
  it('converts the SAFE at its cap and finds the post-round count off by exactly that conversion', () => {
    const { check } = roundCheckOf(CAP_TABLE, [ROUND]);
    expect(check.conversions).toEqual([expect.objectContaining({ securityId: 'SAFE-1', basis: 'CAP', price: '0.750000', shares: '400000', proRata: true })]);
    expect(check.postRoundShares).toEqual({ stated: '11000000', recomputed: '11400000', difference: '400000', ties: false });
    expect(check.explainedBy).toEqual(['SAFE-1']);
    expect(check.roundSize.ties).toBe(true);
    expect(check.preMoney.ties).toBe(true);
    expect(check.proRata).toEqual([{ securityId: 'SAFE-1', holderRef: 'I-1', instrument: 'safe' }]);
  });

  it('drafts the cap-table drag with a contradicted claim, and verifies the pre-money', () => {
    const proposals = SPV_CAP_TABLE_MATH.detect({ evidence: CAP_TABLE, pages: [ROUND] });
    const drag = proposals.find((proposal) => proposal.title === 'Cap table does not add up after the round');
    expect(drag).toMatchObject({ direction: -1, claim: { status: 'CONTRADICTED' } });
    expect(drag?.description).toContain('exactly what SAFE-1 converts into');
    expect(proposals.find((proposal) => proposal.title === 'Stated pre-money ties to the cap table')).toMatchObject({ direction: 1, claim: { status: 'VERIFIED' } });
    // A summary that counts the conversion ties, and proposes no drag.
    const fixed = page('round', ROUND.text.replace('11,000,000', '11,400,000'));
    expect(SPV_CAP_TABLE_MATH.detect({ evidence: CAP_TABLE, pages: [fixed] }).filter((proposal) => proposal.direction === -1)).toEqual([]);
  });

  it('checks the signed SAFE against the summary and the cap table import', () => {
    expect(SPV_INSTRUMENT_TERMS.detect({ evidence: CAP_TABLE, pages: [ROUND, SAFE] })).toEqual([expect.objectContaining({ direction: 1, claim: expect.objectContaining({ status: 'VERIFIED' }) })]);
    const better = page('safe', SAFE.text.replace('Valuation Cap: USD 6,000,000', 'Valuation Cap: USD 5,000,000'));
    const contradicted = SPV_INSTRUMENT_TERMS.detect({ evidence: CAP_TABLE, pages: [ROUND, better] });
    expect(contradicted.map((proposal) => proposal.title)).toEqual(['Signed instrument terms differ from the round summary', 'Cap table differs from the signed SAFE-1']);
    expect(contradicted[0]?.claim?.status).toBe('CONTRADICTED');
    expect(SPV_INSTRUMENT_TERMS.detect({ evidence: CAP_TABLE, pages: [ROUND] })[0]?.claim?.status).toBe('UNVERIFIED');
  });
});

describe('SPV round claims register', () => {
  it('verifies ARR and runway against the evidence and leaves retention unverified', () => {
    const proposals = SPV_ROUND_CLAIMS.detect({ evidence: [...BILLING, ...FINANCIALS], pages: [ROUND] });
    expect(proposals.map((proposal) => [proposal.title, proposal.claim?.status])).toEqual([
      ['Round claim verified: ARR', 'VERIFIED'],
      ['Round claim verified: Runway', 'VERIFIED'],
      ['Round claim not verified: Net revenue retention', 'UNVERIFIED'],
    ]);
    const short = SPV_ROUND_CLAIMS.detect({ evidence: [...BILLING.slice(0, 5), month('2026-07', '900000', '100000'), month('2026-08', '800000', '100000'), month('2026-09', '700000', '100000')], pages: [ROUND] });
    expect(short.filter((proposal) => proposal.direction === -1).map((proposal) => proposal.title)).toEqual(['Round claim contradicted: ARR', 'Round claim contradicted: Runway']);
    // No billing at all: the ARR claim is a gap, never a guess.
    expect(SPV_ROUND_CLAIMS.detect({ evidence: FINANCIALS, pages: [ROUND] })[0]).toMatchObject({ direction: 0, claim: { status: 'UNVERIFIED' } });
  });
});

describe('SPV vehicle checks', () => {
  it('finds carry 20% in the agreement against 15% in the summary', () => {
    const proposals = SPV_FEE_CARRY.detect({ evidence: [], pages: [AGREEMENT, SUMMARY] });
    expect(proposals).toEqual([expect.objectContaining({ title: 'Carried interest in the operating agreement differs from the investor summary', direction: -1 })]);
    expect(proposals[0]?.quotes).toHaveLength(2);
  });

  it('flags an undisclosed fee waiver, and nothing once the summary discloses side letters', () => {
    expect(SPV_SIDE_LETTERS.detect({ evidence: [], pages: [SUMMARY, LETTER] })).toEqual([expect.objectContaining({ direction: 0, title: 'Side letter grants preferential terms the summary does not disclose' })]);
    const disclosed = page('sum', SUMMARY.text.replace('Side letters: none.', 'Side letters: one investor has a management fee waiver.'));
    expect(SPV_SIDE_LETTERS.detect({ evidence: [], pages: [disclosed, LETTER] })).toEqual([]);
  });

  it('asks for the Form D when no filing is in the evidence', () => {
    expect(SPV_FORM_D.detect({ evidence: [], pages: [AGREEMENT, FORM_D] })).toEqual([]);
    expect(SPV_FORM_D.detect({ evidence: [], pages: [AGREEMENT] })).toEqual([expect.objectContaining({ title: 'No Form D filing evidence for the offering', direction: 0 })]);
    expect(SPV_FORM_D.detect({ evidence: [], pages: [ROUND] })).toEqual([]);
  });

  it('flags a 506(c) investor not verified by a third party, by reference only', () => {
    const seats = [
      { reference: 'INV-01', status: 'ACTIVE', accreditation: 'THIRD_PARTY_VERIFIED' },
      { reference: 'INV-04', status: 'ACTIVE', accreditation: 'SELF_CERTIFIED' },
      { reference: 'INV-05', status: 'WITHDRAWN', accreditation: 'NOT_STARTED' },
    ];
    const [gap] = spvAccreditationCheck([AGREEMENT], seats);
    expect(gap).toMatchObject({ title: 'Accreditation gap in a 506(c) vehicle', direction: 0 });
    expect(gap?.description).toContain('INV-04 (self certified)');
    expect(gap?.description).not.toContain('INV-05');
    expect(spvAccreditationCheck([page('oa', AGREEMENT.text.replace('506(c)', '506(b)'))], seats)).toEqual([]);
  });
});

describe('SPV economics and returns (spv-economics-1)', () => {
  const vehicle = vehicleStatement(spvDocuments([AGREEMENT, SUMMARY]));
  const economics = spvEconomics(vehicle, new D('2000000'), 'USD');

  it('recomputes the fee load from the operating agreement', () => {
    expect(economics).toMatchObject({ feeAmount: '40000.00', expenseAmount: '25000.00', invested: '1935000.00', feeLoad: '0.0325', carryRate: '0.2', organizerCommitment: '50000.00' });
    expect(economics.comparisons.find((comparison) => comparison.term === 'CARRY')).toMatchObject({ agreement: '20%', summary: '15%', matches: false });
  });

  it('labels every net-of-fees scenario as computed from stated assumptions', () => {
    const scenarios = spvReturns(economics, { pricePerShare: '1', postRoundShares: '11400000' }, { DOWNSIDE: new D('0.5'), BASE: new D('3'), UPSIDE: new D('10') });
    expect(scenarios.map((scenario) => [scenario.scenario, scenario.vehicleShares, scenario.netMultiple])).toEqual([
      ['DOWNSIDE', '1935000', '0.48'],
      ['BASE', '1935000', '2.52'],
      ['UPSIDE', '1935000', '7.94'],
    ]);
    expect(scenarios[0]?.carry).toBe('0.00');
    expect(scenarios.every((scenario) => scenario.label.startsWith('Scenario computed from stated assumptions'))).toBe(true);
    expect(() => spvReturns({ ...economics, invested: null }, { pricePerShare: '1', postRoundShares: '1' }, {})).toThrow(SpvReturnsError);
  });

  it('the round calculator reports the stack, billed ARR and runway', () => {
    const report = spvMetrics({ evidence: [...CAP_TABLE, ...BILLING, ...FINANCIALS], currency: 'USD' } as never);
    const value = (key: string) => report.metrics.find((metric) => metric.key === key)?.value;
    expect([value('pre_round_shares'), value('converting_principal'), value('billed_arr'), value('runway_months')]).toEqual(['8000000', '300000.00', '1200000.00', '18.0']);
  });
});
