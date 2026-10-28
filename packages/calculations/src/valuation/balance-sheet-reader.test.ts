import { describe, expect, it } from 'vitest';
import { balanceSheetDate, proposeBalanceSheetItems } from './balance-sheet-reader';

describe('balance-sheet reader (T-094 B9)', () => {
  it('proposes cash, debt and debt-like lines from the SaaS demo balance sheet, quoting each line', () => {
    const pages = [
      { pageNumber: 1, text: 'Brightwave Software Inc. — balance sheet at 30 September 2026 (synthetic, unaudited)\n\nCash and cash equivalents: USD 310,000\nTrade receivables: USD 118,000' },
      { pageNumber: 2, text: 'Term loan with Lakeshore Commercial Bank, outstanding principal: USD 450,000\nDeferred revenue on annual subscriptions billed in advance: USD 96,000' },
    ];
    expect(proposeBalanceSheetItems(pages)).toEqual([
      { kind: 'CASH', category: 'CASH', label: 'Cash and cash equivalents', amount: '310000', currency: 'USD', pageNumber: 1, quote: 'Cash and cash equivalents: USD 310,000', lender: null },
      {
        kind: 'DEBT',
        category: 'TERM_LOAN',
        label: 'Term loan with Lakeshore Commercial Bank',
        amount: '450000',
        currency: 'USD',
        pageNumber: 2,
        quote: 'Term loan with Lakeshore Commercial Bank, outstanding principal: USD 450,000',
        lender: 'Lakeshore Commercial Bank',
      },
      {
        kind: 'DEBT_LIKE',
        category: 'DEFERRED_REVENUE',
        label: 'Deferred revenue on annual subscriptions billed in advance',
        amount: '96000',
        currency: 'USD',
        pageNumber: 2,
        quote: 'Deferred revenue on annual subscriptions billed in advance: USD 96,000',
        lender: null,
      },
    ]);
  });

  it('never proposes assets or contra lines, even when they mention loans', () => {
    const text = 'Merchant loans receivable, gross: USD 778,350\nAllowance for credit losses: USD 15,567 (2.0% of gross loans)\nTrade receivables: USD 1,000';
    expect(proposeBalanceSheetItems([{ pageNumber: 1, text }])).toEqual([]);
  });

  it('reads dotted and spaced layouts and plain amounts', () => {
    const text = 'Revolving credit facility ........ 1,250,000.50\nIncome tax payable    42000\nLease liabilities\t300,000';
    expect(proposeBalanceSheetItems([{ pageNumber: 3, text }]).map((p) => [p.category, p.amount])).toEqual([
      ['REVOLVER', '1250000.50'],
      ['UNPAID_TAX', '42000'],
      ['LEASE', '300000'],
    ]);
  });

  it('finds the balance sheet date', () => {
    expect(balanceSheetDate('balance sheet at 30 September 2026 (synthetic)')).toBe('2026-09-30');
    expect(balanceSheetDate('no date here')).toBeNull();
  });
});
