import { describe, expect, it } from 'vitest';
import { balanceSheetItemInputSchema, reviseBalanceSheetItemSchema } from './balance-sheet';

const valid = {
  kind: 'DEBT',
  category: 'TERM_LOAN',
  label: 'Term loan',
  amount: '120,000',
  currency: 'USD',
  asOf: '2026-09-30',
  documentId: '0190f000-0000-7000-8000-0000000000aa',
  pageNumber: '1',
  quote: 'Term loan outstanding 120,000',
  note: '',
};

describe('balance-sheet contracts', () => {
  it('parses an item with its cited source', () => {
    expect(balanceSheetItemInputSchema.parse(valid)).toMatchObject({ amount: '120000', pageNumber: 1, note: null });
  });
  it('requires the category to match the kind and a real quote', () => {
    expect(balanceSheetItemInputSchema.safeParse({ ...valid, category: 'DEFERRED_REVENUE' }).success).toBe(false);
    expect(balanceSheetItemInputSchema.safeParse({ ...valid, quote: 'short' }).success).toBe(false);
    expect(balanceSheetItemInputSchema.safeParse({ ...valid, amount: '-5' }).success).toBe(false);
  });
  it('needs a version and a reason to revise', () => {
    const { kind: _kind, ...rest } = valid;
    expect(reviseBalanceSheetItemSchema.safeParse(rest).success).toBe(false);
    expect(reviseBalanceSheetItemSchema.parse({ ...rest, expectedVersion: '2', reason: 'Accrued interest' })).toMatchObject({ expectedVersion: 2 });
  });
});
