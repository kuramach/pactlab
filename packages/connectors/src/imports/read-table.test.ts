import { describe, expect, it } from 'vitest';
import { MAX_WORKBOOK_EXPANDED_BYTES, readTable, TableReadError } from './read-table';
import { syntheticXlsx } from './xlsx-fixture';

const bytes = (text: string) => new TextEncoder().encode(text);
const code = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error instanceof TableReadError ? error.code : 'other';
  }
  return 'none';
};

describe('readTable: delimited text', () => {
  it('reads comma CSV in UTF-8 with or without a BOM', async () => {
    for (const text of ['id,amount\nA,1.50\n', '﻿id,amount\r\nA,1.50\r\n']) {
      const read = await readTable(bytes(text), { fileName: 'lines.csv' });
      expect(read).toMatchObject({ format: 'CSV', encoding: 'UTF-8', delimiter: ',' });
      expect(read.table.header).toEqual(['id', 'amount']);
      expect(read.table.rows.map((row) => row.cells)).toEqual([['A', '1.50']]);
    }
  });

  it('detects semicolons (European exports) and keeps quoted separators', async () => {
    const read = await readTable(bytes('id;name;amount\nA;"Müller; GmbH";1.234,56\n'), { fileName: 'export.csv' });
    expect(read.delimiter).toBe(';');
    expect(read.table.rows[0]?.cells).toEqual(['A', 'Müller; GmbH', '1.234,56']);
  });

  it('reads tab-separated files as TSV', async () => {
    const read = await readTable(bytes('id\tamount\nA\t2\n'), { fileName: 'lines.tsv' });
    expect(read).toMatchObject({ format: 'TSV', delimiter: '\t' });
    const sniffed = await readTable(bytes('id\tamount\nA\t2\n'), { fileName: 'lines.txt' });
    expect(sniffed.format).toBe('TSV');
  });

  it('falls back to Windows-1252 when the bytes are not UTF-8', async () => {
    const latin = new Uint8Array([...bytes('id,name\nA,Caf'), 0xe9, 0x0a]);
    const read = await readTable(latin, { fileName: 'legacy.csv' });
    expect(read.encoding).toBe('WINDOWS-1252');
    expect(read.table.rows[0]?.cells).toEqual(['A', 'Café']);
  });

  it('refuses binary content and malformed CSV', async () => {
    expect(await code(readTable(new Uint8Array([0x69, 0x64, 0x00, 0x0a]), { fileName: 'x.csv' }))).toBe('NOT_TEXT');
    expect(await code(readTable(bytes('a,b\n1,2,3\n'), { fileName: 'x.csv' }))).toBe('UNREADABLE');
    expect(await code(readTable(new Uint8Array(), { fileName: 'x.csv' }))).toBe('NO_DATA');
  });
});

describe('readTable: Excel workbooks', () => {
  const workbook = syntheticXlsx([
    { name: 'Notes', rows: [] },
    {
      name: 'Loans',
      rows: [
        ['loan_id', 'originated', 'principal', 'status'],
        ['LN-1', { date: '2026-04-15' }, 20000, 'current'],
        [null, null, null, null],
        ['LN-2', { date: '2024-11-15' }, 0.1 + 0.2, 'late'],
      ],
    },
    { name: 'Second', rows: [['a'], ['b']] },
  ]);

  it('reads the first sheet with data: ISO dates, exact decimal strings, blank rows dropped', async () => {
    const read = await readTable(workbook, { fileName: 'loan-tape.xlsx' });
    expect(read).toMatchObject({ format: 'XLSX', encoding: null, delimiter: null, sheet: 'Loans', sheets: ['Loans', 'Second'] });
    expect(read.table.header).toEqual(['loan_id', 'originated', 'principal', 'status']);
    expect(read.table.rows.map((row) => row.cells)).toEqual([
      ['LN-1', '2026-04-15', '20000', 'current'],
      ['LN-2', '2024-11-15', '0.3', 'late'],
    ]);
    expect(read.table.rows[0]?.text).toBe('LN-1,2026-04-15,20000,current');
  });

  it('reads a chosen sheet, and refuses one that does not exist', async () => {
    const read = await readTable(workbook, { fileName: 'loan-tape.xlsx', sheet: 'Second' });
    expect(read.table.header).toEqual(['a']);
    expect(await code(readTable(workbook, { fileName: 'loan-tape.xlsx', sheet: 'Missing' }))).toBe('SHEET_NOT_FOUND');
  });

  it('refuses legacy .xls, macro-enabled workbooks and a zip that is not a workbook', async () => {
    expect(await code(readTable(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), { fileName: 'old.xls' }))).toBe('LEGACY_EXCEL');
    expect(await code(readTable(workbook, { fileName: 'book.xlsm' }))).toBe('MACROS');
    const withMacros = syntheticXlsx([{ name: 'S', rows: [['a'], ['1']] }], { 'xl/vbaProject.bin': 'synthetic' });
    expect(await code(readTable(withMacros, { fileName: 'book.xlsx' }))).toBe('MACROS');
    expect(await code(readTable(workbook, { fileName: 'book.csv' }))).toBe('UNREADABLE');
    expect(await code(readTable(bytes('id\n1\n'), { fileName: 'fake.xlsx' }))).toBe('UNREADABLE');
  });

  it('refuses a workbook that would expand past the limit (zip bomb)', async () => {
    const huge = syntheticXlsx([{ name: 'S', rows: [['a'], ['1']] }], { 'xl/padding.xml': ' '.repeat(MAX_WORKBOOK_EXPANDED_BYTES + 1) });
    expect(await code(readTable(huge, { fileName: 'bomb.xlsx' }))).toBe('TOO_LARGE');
  });
});
