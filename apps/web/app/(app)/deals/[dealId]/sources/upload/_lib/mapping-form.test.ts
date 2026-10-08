import type { ImportMapping } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { choiceOf, cleanMapping, sourceFromChoice, unmappedRequired } from './mapping-form';

const mapping = (fields: ImportMapping['fields']): ImportMapping => ({
  target: 'BILLING_INVOICE_LINE',
  fields,
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
});

describe('mapping form helpers', () => {
  it('round-trips field sources through select values', () => {
    expect(choiceOf({ kind: 'column', column: 'Net Value' })).toBe('column:Net Value');
    expect(sourceFromChoice('column:Net Value', undefined)).toEqual({ kind: 'column', column: 'Net Value' });
    expect(choiceOf(undefined)).toBe('none');
    expect(sourceFromChoice('constant', { kind: 'constant', value: 'month' })).toEqual({ kind: 'constant', value: 'month' });
    expect(sourceFromChoice('constant', { kind: 'column', column: 'x' })).toEqual({ kind: 'constant', value: '' });
  });

  it('lists required fields that are still unmapped', () => {
    expect(unmappedRequired(mapping({ line_id: { kind: 'column', column: 'id' }, currency: { kind: 'constant', value: ' ' } }))).toEqual([
      'Currency',
      'Amount',
    ]);
  });

  it('turns blank constants into explicit none', () => {
    expect(cleanMapping(mapping({ interval: { kind: 'constant', value: '' } })).fields).toEqual({ interval: { kind: 'none' } });
  });
});
