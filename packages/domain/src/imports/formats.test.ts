import { describe, expect, it } from 'vitest';
import { PERIOD_COLUMN, VALUE_COLUMN } from './ai-mapping';
import { applySavedFormat, formatSignatureText } from './formats';
import type { ImportMapping } from './mapping';
import { FINANCIAL_PNL } from './targets';

const months = (labels: string[]) => labels.map((column) => ({ column, period: column === 'Jan 2026' ? '2026-01' : column === 'Feb 2026' ? '2026-02' : column === 'Mar 2026' ? '2026-03' : '2026-04' }));
const saved: ImportMapping = {
  target: 'FINANCIAL_PNL',
  fields: { account: { kind: 'column', column: 'Column A' }, month: { kind: 'column', column: PERIOD_COLUMN }, amount: { kind: 'column', column: VALUE_COLUMN } },
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MINOR',
  negateAmounts: false,
  layout: { kind: 'PERIOD_COLUMNS', periods: months(['Jan 2026', 'Feb 2026']) },
  lineKinds: { Rent: 'REVENUE', Insurance: 'OPEX' },
};
const table = (header: string[], rows: string[][]) => ({ header, rows: rows.map((cells) => ({ cells, text: cells.join(',') })) });

describe('saved import formats (ADR 0042)', () => {
  it('one layout, one signature: new month columns still match; another column, months or years, or another target do not', () => {
    const jan = formatSignatureText('FINANCIAL_PNL', saved.layout, ['Column A', 'Jan 2026', 'Feb 2026']);
    expect(formatSignatureText('FINANCIAL_PNL', { kind: 'PERIOD_COLUMNS', periods: months(['Mar 2026', 'Apr 2026']) }, ['Column A', 'Mar 2026', 'Apr 2026'])).toBe(jan);
    expect(formatSignatureText('FINANCIAL_PNL', saved.layout, ['Line', 'Jan 2026', 'Feb 2026'])).not.toBe(jan);
    expect(formatSignatureText('FINANCIAL_PNL', { kind: 'PERIOD_COLUMNS', periods: [{ column: '2025', period: '2025' }] }, ['Column A', '2025'])).not.toBe(jan);
    expect(formatSignatureText('MULTIFAMILY_T12', saved.layout, ['Column A', 'Jan 2026', 'Feb 2026'])).not.toBe(jan);
  });

  it('applies the confirmed mapping: periods from the new header, settings kept, line kinds carried by name, new lines left for the person', () => {
    const applied = applySavedFormat(FINANCIAL_PNL, table(['Column A', 'Mar 2026', 'Apr 2026'], [['Rent', '10', '11'], ['Insurance', '2', '2'], ['Office supplies', '1', '1']]), saved);
    expect(applied?.mapping.layout).toEqual({ kind: 'PERIOD_COLUMNS', periods: months(['Mar 2026', 'Apr 2026']) });
    expect(applied?.mapping).toMatchObject({ dateFormat: 'DD/MM/YYYY', amountUnit: 'MINOR', fields: saved.fields, lineKinds: saved.lineKinds, acceptTieOutGaps: false });
    expect(applied?.newLines).toEqual(['Office supplies']);
  });

  it('does not apply when the file no longer fits (the line-name column is gone, or there are no periods)', () => {
    expect(applySavedFormat(FINANCIAL_PNL, table(['Line', 'Mar 2026'], [['Rent', '10']]), saved)).toBeNull();
    expect(applySavedFormat(FINANCIAL_PNL, table(['Column A', 'Total'], [['Rent', '10']]), saved)).toBeNull();
  });
});
