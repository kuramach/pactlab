import { describe, expect, it } from 'vitest';
import { itemError, normalizeAmount } from './balance-sheet-form-state';

describe('balance-sheet item form', () => {
  it('accepts amounts the way people type them', () => {
    expect(normalizeAmount('450,000')).toBe('450000');
    expect(normalizeAmount(' 1,234,567.50 ')).toBe('1234567.50');
    expect(normalizeAmount('1 234 567')).toBe('1234567');
    expect(normalizeAmount('450000')).toBe('450000');
    expect(normalizeAmount('45,00')).toBe('45,00'); // ambiguous: left for the schema to refuse
  });

  it('keeps what was typed and names the field to fix — never a silent refusal', () => {
    const values = { amount: 'abc', quote: 'Term loan' };
    expect(itemError(values, { field: 'amount' })).toEqual({ values, error: { field: 'amount', message: expect.stringContaining('amount as a number') } });
    expect(itemError(values, { code: 'QUOTE_NOT_FOUND' }).error).toMatchObject({ field: 'quote', message: expect.stringContaining('Show page text') });
    expect(itemError(values, { code: 'PEOPLE_DATA' }).error?.field).toBe('documentId');
    expect(itemError(values, { result: 'forbidden' }).error).toMatchObject({ field: null, message: expect.stringContaining('role') });
    // Every outcome has a message: an unknown field or code still explains itself.
    for (const refusal of [{ field: 'mystery' }, { code: 'NEW_CODE' }, { result: 'error' }]) expect(itemError(values, refusal).error?.message).toBeTruthy();
  });
});
