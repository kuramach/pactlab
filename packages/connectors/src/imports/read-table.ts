import { CsvParseError, detectDelimiter, detectHeaderRow, parseDelimited, parseDelimitedRecords, tableAtHeaderRow, type CsvTable, type Delimiter } from '@pactlab/domain';
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
  /**
   * The header's row among the sheet's non-empty rows (1-based), when the file was read with one: title
   * rows above it are left out. Null for a strict read (header on the first row, the standard template).
   */
  readonly headerRow: number | null;
  /** The sheet's first non-empty rows as cell text, before any header is chosen (what the mapping assistant sees). */
  readonly preview: readonly (readonly string[])[];
}

/** Rows kept in `ReadTable.preview`. */
export const PREVIEW_ROWS = 30;
/** A header chosen by `headerRow`: a row number, or 'detect' to find it below title rows. */
export type HeaderChoice = number | 'detect' | null;

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

type SheetRecords = { cells: string[]; text: string }[];

const previewOf = (records: SheetRecords) => records.filter((record) => record.cells.some((cell) => cell.trim() !== '')).slice(0, PREVIEW_ROWS).map((record) => record.cells.map((cell) => cell.trim()));

/** The table under a chosen header row (lenient: blank or repeated header names are named, short rows padded). */
function atHeader(records: SheetRecords, choice: number | 'detect'): { table: CsvTable; headerRow: number } {
  const headerRow = choice === 'detect' ? detectHeaderRow(previewOf(records)) : choice;
  try {
    return { table: tableAtHeaderRow(records, headerRow), headerRow };
  } catch (error) {
    if (error instanceof CsvParseError) throw new TableReadError('UNREADABLE');
    throw error;
  }
}

async function readWorkbook(bytes: Uint8Array, sheet: string | null, header: HeaderChoice): Promise<ReadTable> {
  const sheets = await workbookSheets(bytes);
  const withData = sheets.filter((entry) => entry.data.some((row) => row.some((cell) => cellText(cell) !== '')));
  if (withData.length === 0) throw new TableReadError('NO_DATA');
  const chosen = sheet === null ? withData[0] : withData.find((entry) => entry.sheet === sheet);
  if (!chosen) throw new TableReadError('SHEET_NOT_FOUND');
  const records: SheetRecords = chosen.data.map((row) => {
    const cells = row.map(cellText);
    return { cells, text: csvLine(cells) };
  });
  const base = { format: 'XLSX' as const, encoding: null, delimiter: null, sheet: chosen.sheet, sheets: withData.map((entry) => entry.sheet), preview: previewOf(records) };
  if (header === null) return { ...base, table: sheetTable(chosen.data), headerRow: null };
  return { ...base, ...atHeader(records, header) };
}

/**
 * Read an uploaded file as a table. `sheet` picks a workbook sheet (default: the first with data).
 * `headerRow` reads a real-world file whose header is not on the first row; without it the read is
 * strict (the standard template's shape).
 */
export async function readTable(bytes: Uint8Array, input: { fileName: string; sheet?: string | null; headerRow?: HeaderChoice }): Promise<ReadTable> {
  if (bytes.byteLength === 0) throw new TableReadError('NO_DATA');
  const format = tableFormatOf(bytes, input.fileName);
  const header = input.headerRow ?? null;
  if (format === 'XLSX') return readWorkbook(bytes, input.sheet ?? null, header);
  const { text, encoding } = decodeText(bytes);
  const delimiter = format === 'TSV' ? '\t' : detectDelimiter(text);
  let records: SheetRecords;
  try {
    records = parseDelimitedRecords(text, delimiter);
  } catch (error) {
    if (error instanceof CsvParseError) throw new TableReadError('UNREADABLE');
    throw error;
  }
  const base = { format: delimiter === '\t' ? ('TSV' as const) : ('CSV' as const), encoding, delimiter, sheet: null, sheets: [], preview: previewOf(records) };
  if (header === null) return { ...base, table: parse(text, delimiter), headerRow: null };
  return { ...base, ...atHeader(records, header) };
}
