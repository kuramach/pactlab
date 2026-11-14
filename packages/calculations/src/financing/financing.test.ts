import { describe, expect, it } from 'vitest';
import { coverage, financingPosture, needsDocument, type FinancingInput, type FinancingTranche } from './index';

const t = (kind: FinancingTranche['kind'], amount: string, status: FinancingTranche['status']): FinancingTranche => ({ kind, amount, currency: 'USD', status, documented: false });
const base = (over: Partial<FinancingInput>): FinancingInput => ({ tranches: [], escrow: null, commitmentExpectedBy: null, price: { amount: '8000000.00', currency: 'USD', agreed: true }, today: '2026-11-14', ...over });

describe('buyer financing (T-117)', () => {
  it('sums the plan in decimal against the agreed price and flags under-coverage', () => {
    expect(coverage(base({ tranches: [t('CASH', '2000000.10', 'PRE_QUALIFIED'), t('SBA_7A', '5000000.00', 'APPLICATION_SUBMITTED')] }))).toEqual({
      total: '7000000.10',
      firm: '2000000.10',
      currency: 'USD',
      against: { price: '8000000.00', agreed: true, state: 'UNDER', gap: '999999.90' },
      otherCurrencies: [],
    });
    const posture = financingPosture(base({ tranches: [t('CASH', '2000000.10', 'PRE_QUALIFIED'), t('SBA_7A', '5000000.00', 'APPLICATION_SUBMITTED')] }));
    expect(posture.level).toBe('IN_PROGRESS');
    expect(posture.blockers).toEqual(['Financing covers USD 7,000,000.10 of the agreed price of USD 8,000,000.00.']);
  });

  it('says plainly where the buyer stands', () => {
    expect(financingPosture(base({})).headline).toBe('No financing shared yet');
    expect(financingPosture(base({ tranches: [t('SBA_7A', '8000000.00', 'EXPLORING')] })).headline).toBe('No lender engaged yet');
    expect(financingPosture(base({ tranches: [t('CASH', '3000000.00', 'PRE_QUALIFIED'), t('CONVENTIONAL_DEBT', '5000000.00', 'COMMITMENT_ISSUED')] })).headline).toBe('Commitment issued — USD 8,000,000.00 of USD 8,000,000.00 covered');
    expect(financingPosture(base({ tranches: [t('CASH', '8000000.00', 'CLEARED_TO_CLOSE')] })).level).toBe('CLEARED');
  });

  it('blocks on a passed commitment date and an unpaid earnest deposit', () => {
    const posture = financingPosture(
      base({
        tranches: [t('SBA_7A', '8000000.00', 'APPLICATION_SUBMITTED')],
        commitmentExpectedBy: '2026-11-01',
        escrow: { amount: '250000.00', currency: 'USD', status: 'COMMITTED', depositDueOn: '2026-11-10', hardOn: '2026-12-01', confirmed: false },
      }),
    );
    expect(posture.blockers).toEqual(['A lender commitment was expected by 2026-11-01 and has not been issued.', 'The earnest deposit of USD 250,000.00 was due by 2026-11-10 and is not recorded.']);
    expect(posture.escrow).toBe('Earnest USD 250,000.00 committed, due by 2026-11-10');
    expect(financingPosture(base({ escrow: { amount: '250000.00', currency: 'USD', status: 'DEPOSITED', depositDueOn: null, hardOn: '2026-12-01', confirmed: true } })).escrow).toBe('Earnest USD 250,000.00 deposited, hard after 2026-12-01');
  });

  it('asks for a document from pre-qualification up', () => {
    expect(needsDocument('EXPLORING')).toBe(false);
    expect(needsDocument('PRE_QUALIFIED')).toBe(true);
  });
});
