import { CsvParseError, detectDelimiter, parseDelimited, type CsvTable, type Delimiter } from '@pactlab/domain';
import { Decimal } from 'decimal.js';
import { unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';

/**
 * Every file an import accepts becomes the same `CsvTable`, so mapping,
 * validation and evidence never depend on the file format:
 * - delimited text (comma, semicolon or tab), UTF-8 with or without BOM, or
 *   Windows-1252 when the bytes are not valid UTF-8;
 * - Excel workbooks (.xlsx): one sheet, cells as text, dates as ISO
 *   YYYY-MM-DD, numbers as exact decimal strings (never JavaScript floats).
 * Legacy .xls and macro-enabled workbooks are refused.
 */
export const TABLE_FORMATS = ['CSV', 'TSV', 'XLSX'] as const;
export type TableFormat = (typeof TABLE_FORMATS)[number];
export type TextEncoding = 'UTF-8' | 'WINDOWS-1252';

export type TableReadErrorCode = 'UNREADABLE' | 'NOT_TEXT' | 'LEGACY_EXCEL' | 'MACROS' | 'TOO_LARGE' | 'NO_DATA' | 'SHEET_NOT_FOUND';

export class TableReadError extends Error {
  constructor(readonly code: TableReadErrorCode) {
    super(`Table could not be read: ${code}`);
    this.name = 'TableReadError';
  }
}

export interface ReadTable {
  readonly table: CsvTable;
  readonly format: TableFormat;
  /** Text files only. */
  readonly encoding: TextEncoding | null;
  readonly delimiter: Delimiter | null;
  /** Workbooks only: the sheet read, and every sheet with data. */
  readonly sheet: string | null;
  readonly sheets: readonly string[];
}

/** Declared uncompressed size a workbook may expand to (a zip-bomb guard). */
export const MAX_WORKBOOK_EXPANDED_BYTES = 100 * 1024 * 1024;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((byte, index) => bytes[index] === byte);

/** Which reader a file needs, from its bytes first and its name second. */
export function tableFormatOf(bytes: Uint8Array, fileName: string): TableFormat {
  const name = fileName.toLowerCase();
  if (startsWith(bytes, OLE) || name.endsWith('.xls')) throw new TableReadError('LEGACY_EXCEL');
  if (name.endsWith('.xlsm') || name.endsWith('.xlsb')) throw new TableReadError('MACROS');
  if (startsWith(bytes, ZIP)) {
    if (!name.endsWith('.xlsx')) throw new TableReadError('UNREADABLE');
    return 'XLSX';
  }
  if (name.endsWith('.xlsx')) throw new TableReadError('UNREADABLE');
  return name.endsWith('.tsv') || name.endsWith('.tab') ? 'TSV' : 'CSV';
}

/** UTF-8 (BOM optional), else Windows-1252; binary content is refused. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  if (bytes.includes(0)) throw new TableReadError('NOT_TEXT');
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'WINDOWS-1252' };
  }
}

function parse(text: string, delimiter: Delimiter): CsvTable {
  try {
    return parseDelimited(text, delimiter);
  } catch (error) {
    if (error instanceof CsvParseError) throw new TableReadError('UNREADABLE');
    throw error;
  }
}

/** Refuse a workbook that would expand past the limit, or that carries macros, before reading it. */
function inspectWorkbook(bytes: Uint8Array): void {
  let expanded = 0;
  let macros = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        expanded += file.originalSize;
        if (/vbaProject\.bin$/i.test(file.name)) macros = true;
        return false; // sizes come from the central directory; nothing is inflated here
      },
    });
  } catch {
    throw new TableReadError('UNREADABLE');
  }
  if (macros) throw new TableReadError('MACROS');
  if (expanded > MAX_WORKBOOK_EXPANDED_BYTES) throw new TableReadError('TOO_LARGE');
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** Excel stores numbers as doubles; keep the 15 significant digits Excel shows, as a decimal string. */
function excelNumber(raw: string): string {
  const value = new Decimal(raw);
  return value.toSignificantDigits(15).toFixed();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoDate(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

/** A CSV line for a workbook row: the row's verbatim text for citation hashes. */
const csvLine = (cells: readonly string[]) => cells.map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',');

function sheetTable(rows: readonly (readonly unknown[])[]): CsvTable {
  const texts = rows.map((row) => row.map(cellText));
  // Drop fully empty rows (Excel keeps formatted blank rows).
  const filled = texts.filter((row) => row.some((cell) => cell !== ''));
  const [header, ...data] = filled;
  if (!header) throw new TableReadError('NO_DATA');
  // Trailing empty header cells are formatting, not columns.
  let width = header.length;
  while (width > 0 && header[width - 1] === '') width -= 1;
  const names = header.slice(0, width);
  if (names.length === 0 || names.some((name) => name === '') || new Set(names).size !== names.length) throw new TableReadError('UNREADABLE');
  return {
    header: names,
    rows: data.map((row) => {
      const cells = Array.from({ length: width }, (_, index) => row[index] ?? '');
      return { cells, text: csvLine(cells) };
    }),
  };
}

async function workbookSheets(bytes: Uint8Array): Promise<{ sheet: string; data: unknown[][] }[]> {
  inspectWorkbook(bytes);
  try {
    return (await readXlsxFile(Buffer.from(bytes), { parseNumber: excelNumber })) as { sheet: string; data: unknown[][] }[];
  } catch {
    throw new TableReadError('UNREADABLE');
  }
}

/**
 * Every sheet with data as rows of cell text (for a data-room workbook, whose
 * sheets become pages). Same guards and cell rules as `readTable`.
 */
export async function readWorkbookSheets(bytes: Uint8Array): Promise<{ sheet: string; rows: string[][] }[]> {
  if (!startsWith(bytes, ZIP)) throw new TableReadError('UNREADABLE');
  return (await workbookSheets(bytes))
    .map((entry) => ({ sheet: entry.sheet, rows: entry.data.map((row) => row.map(cellText)).filter((row) => row.some((cell) => cell !== '')) }))
    .filter((entry) => entry.rows.length > 0);
}

async function readWorkbook(bytes: Uint8Array, sheet: string | null): Promise<ReadTable> {
  const sheets = await workbookSheets(bytes);
  const withData = sheets.filter((entry) => entry.data.some((row) => row.some((cell) => cellText(cell) !== '')));
  if (withData.length === 0) throw new TableReadError('NO_DATA');
  const chosen = sheet === null ? withData[0] : withData.find((entry) => entry.sheet === sheet);
  if (!chosen) throw new TableReadError('SHEET_NOT_FOUND');
  return { table: sheetTable(chosen.data), format: 'XLSX', encoding: null, delimiter: null, sheet: chosen.sheet, sheets: withData.map((entry) => entry.sheet) };
}

/** Read an uploaded file as a table. `sheet` picks a workbook sheet (default: the first with data). */
export async function readTable(bytes: Uint8Array, input: { fileName: string; sheet?: string | null }): Promise<ReadTable> {
  if (bytes.byteLength === 0) throw new TableReadError('NO_DATA');
  const format = tableFormatOf(bytes, input.fileName);
  if (format === 'XLSX') return readWorkbook(bytes, input.sheet ?? null);
  const { text, encoding } = decodeText(bytes);
  const delimiter = format === 'TSV' ? '\t' : detectDelimiter(text);
  return { table: parse(text, delimiter), format: delimiter === '\t' ? 'TSV' : 'CSV', encoding, delimiter, sheet: null, sheets: [] };
}
