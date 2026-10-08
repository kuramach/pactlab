import { describe, expect, it } from 'vitest';
import { parseCsv } from '../evidence/csv';
import {
  applyMapping,
  BILLING_INVOICE_LINE,
  canonicalMappingJson,
  detectDateFormat,
  mappedEvidence,
  parseAmountValue,
  parseDateValue,
  suggestFields,
  type ImportMapping,
} from '.';

const amount = (raw: string, options: Partial<Parameters<typeof parseAmountValue>[1]> = {}) =>
  parseAmountValue(raw, { numberFormat: 'DOT_DECIMAL', unit: 'MAJOR', currency: 'USD', negate: false, ...options });

describe('value transforms', () => {
  it.each([
    ['2025-07-01', 'YYYY-MM-DD', '2025-07-01'],
    ['2025-07-01 00:00:00', 'YYYY-MM-DD', '2025-07-01'],
    ['7/1/2025', 'MM/DD/YYYY', '2025-07-01'],
    ['01/07/2025', 'DD/MM/YYYY', '2025-07-01'],
    ['01.07.2025', 'DD.MM.YYYY', '2025-07-01'],
    ['31.02.2025', 'DD.MM.YYYY', null],
    ['2025-13-01', 'YYYY-MM-DD', null],
    ['July 1', 'YYYY-MM-DD', null],
  ] as const)('reads %s as %s → %s', (raw, format, expected) => {
    expect(parseDateValue(raw, format)).toBe(expected);
  });

  it('normalizes amounts as decimal strings without floating point', () => {
    expect(amount('1,234.50')).toBe('1234.5');
    expect(amount('0.10')).toBe('0.1');
    expect(amount('(250.00)')).toBe('-250');
    expect(amount('1.234,56-', { numberFormat: 'COMMA_DECIMAL' })).toBe('-1234.56');
    expect(amount('1 234,56', { numberFormat: 'COMMA_DECIMAL' })).toBe('1234.56');
    expect(amount('99999999999999999.99')).toBe('99999999999999999.99');
    expect(amount('100', { negate: true })).toBe('-100');
    expect(amount('$100')).toBeNull();
    expect(amount('1,23.4')).toBeNull();
  });

  it('converts minor units using the currency exponent', () => {
    expect(amount('340000', { unit: 'MINOR' })).toBe('3400');
    expect(amount('5', { unit: 'MINOR' })).toBe('0.05');
    expect(amount('-1999', { unit: 'MINOR' })).toBe('-19.99');
    expect(amount('5000', { unit: 'MINOR', currency: 'JPY' })).toBe('5000');
    expect(amount('1500', { unit: 'MINOR', currency: 'KWD' })).toBe('1.5');
    expect(amount('12.5', { unit: 'MINOR' })).toBeNull();
    expect(amount('100', { unit: 'MINOR', currency: null })).toBeNull();
  });
});

const STANDARD = `line_id,customer_id,currency,amount,interval,period_start,period_end,invoice_status,created
il_1,cus_1,usd,"3,400.00",month,2025-07-01,2025-08-01,paid,2025-07-01
il_2,cus_2,USD,1200,Monthly,2025-07-01,2025-08-01,open,2025-07-02
`;

const standardMapping = (header: readonly string[]): ImportMapping => ({
  target: 'BILLING_INVOICE_LINE',
  fields: suggestFields(BILLING_INVOICE_LINE, header),
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
});

describe('applyMapping', () => {
  it('maps a standard export onto the canonical invoice line', () => {
    const table = parseCsv(STANDARD);
    const result = applyMapping(table, standardMapping(table.header), 'uploads/u/file.csv');
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toEqual({
      row: 1,
      canonical: expect.objectContaining({ line_id: 'il_1', currency: 'USD', amount: '3400', interval: 'month', invoice_id: null }),
    });
    expect(result.rows[1]!.canonical['interval']).toBe('month');
  });

  it('reads a SAP-style export with European formats, trailing minus and a fixed interval', () => {
    const sap = `Billing Document;Item;Sold-To Party;Net Value;Document Currency;Billing Date;Service Start;Service End
`.replaceAll(';', ',');
    const rows = [
      ['90000001-10', '9000', 'C100', '"1.234,56"', 'EUR', '01.07.2025', '01.07.2025', '01.08.2025'],
      ['90000002-10', '9000', 'C100', '"100,00-"', 'EUR', '02.07.2025', '01.07.2025', '01.08.2025'],
    ];
    const table = parseCsv(sap + rows.map((row) => row.join(',')).join('\n'));
    const mapping: ImportMapping = {
      target: 'BILLING_INVOICE_LINE',
      fields: {
        ...suggestFields(BILLING_INVOICE_LINE, table.header),
        line_id: { kind: 'column', column: 'Billing Document' },
        interval: { kind: 'constant', value: 'month' },
        invoice_status: { kind: 'constant', value: 'paid' },
      },
      dateFormat: detectDateFormat(table, 'Billing Date') ?? 'YYYY-MM-DD',
      numberFormat: 'COMMA_DECIMAL',
      amountUnit: 'MAJOR',
      negateAmounts: false,
    };
    const result = applyMapping(table, mapping, 'uploads/u/sap.csv');
    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => [row.canonical['amount'], row.canonical['period_start'], row.canonical['customer_id']])).toEqual([
      ['1234.56', '2025-07-01', 'C100'],
      ['-100', '2025-07-01', 'C100'],
    ]);
    expect(result.rows[0]!.canonical['interval']).toBe('month');
  });

  it('reports unreadable, missing and duplicate rows with row numbers and imports the rest', () => {
    const table = parseCsv(`line_id,currency,amount,created
il_1,USD,10,2025-07-01
,USD,10,2025-07-01
il_3,USD,ten,2025-07-01
il_4,USD,10,07/01/2025
il_1,USD,10,2025-07-01
il_6,,10,2025-07-01
`);
    const result = applyMapping(table, standardMapping(table.header), 'd');
    expect(result.rows.map((row) => row.row)).toEqual([1]);
    expect(result.issues.map((issue) => [issue.row, issue.code])).toEqual([
      [2, 'MISSING_RECORD_ID'],
      [3, 'INVALID_VALUE'],
      [4, 'INVALID_DATE'],
      [5, 'DUPLICATE_RECORD_ID'],
      [6, 'MISSING_FIELD'],
    ]);
  });

  it('refuses a mapping that points at missing columns or leaves required fields empty', () => {
    const table = parseCsv('id,total\n1,2\n');
    const mapping: ImportMapping = {
      ...standardMapping(table.header),
      fields: { line_id: { kind: 'column', column: 'nope' }, currency: { kind: 'none' }, amount: { kind: 'column', column: 'total' } },
    };
    const result = applyMapping(table, mapping, 'd');
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.detail)).toEqual([
      'Line id: column "nope" is not in the file',
      'Currency is required',
    ]);
  });

  it('produces cited evidence whose quote is the canonical record, not the raw row', () => {
    const table = parseCsv('line_id,currency,amount,secret_note\nil_1,USD,10,do not keep\n');
    const result = applyMapping(table, standardMapping(table.header), 'uploads/u/f.csv');
    const pull = mappedEvidence(result, { target: 'BILLING_INVOICE_LINE', sourceSystem: 'billing_upload', dataset: 'uploads/u/f.csv' });
    expect(pull.records[0]).toMatchObject({
      evidenceType: 'billing.invoice_line',
      sourceRecordId: 'il_1',
      locator: { kind: 'csv_row', dataset: 'uploads/u/f.csv', row: 1 },
    });
    expect(pull.records[0]!.quote).not.toContain('do not keep');
    expect(JSON.stringify(pull.records[0]!.canonical)).not.toContain('do not keep');
  });

  it('hashes mappings independently of key order', () => {
    const table = parseCsv(STANDARD);
    const mapping = standardMapping(table.header);
    const reordered = { ...mapping, fields: Object.fromEntries(Object.entries(mapping.fields).reverse()) };
    expect(canonicalMappingJson(reordered)).toBe(canonicalMappingJson(mapping));
  });
});
