import { COMPANY_TYPE_LABELS, COMPANY_TYPES } from '@pactlab/domain';
import { z } from 'zod';
import { comparableInputSchema, type ComparableEntry } from './comparables';

/** At most this many data rows in one batch (T-111). */
export const COMPARABLE_BATCH_MAX_ROWS = 500;

type Field = keyof ComparableEntry;

/** The template: one column per field of the single-entry form, in the form's order. */
export const COMPARABLE_TEMPLATE_COLUMNS: readonly { field: Field; header: string; required: boolean; example: string }[] = [
  { field: 'kind', header: 'Kind', required: true, example: 'Precedent transaction' },
  { field: 'name', header: 'Name', required: true, example: 'Acquirer / Target 2025 (example)' },
  { field: 'targetName', header: 'Target', required: true, example: 'Target Inc (example)' },
  { field: 'acquirerName', header: 'Acquirer', required: false, example: 'Acquirer Corp (example)' },
  { field: 'announcedOn', header: 'Date', required: false, example: '2025-03-31' },
  { field: 'companyType', header: 'Company type', required: true, example: COMPANY_TYPE_LABELS.SOFTWARE_SAAS },
  { field: 'region', header: 'Region', required: false, example: 'North America' },
  { field: 'enterpriseValue', header: 'EV', required: true, example: '25000000' },
  { field: 'arr', header: 'ARR', required: true, example: '5000000' },
  { field: 'arrBasis', header: 'Basis', required: false, example: 'ARR' },
  { field: 'currency', header: 'Currency', required: true, example: 'USD' },
  { field: 'arrGrowth', header: 'ARR growth %', required: false, example: '25' },
  { field: 'nrr', header: 'NRR %', required: false, example: '105' },
  { field: 'grr', header: 'GRR %', required: false, example: '90' },
  { field: 'sourceCitation', header: 'Source', required: true, example: 'Press release, 31 Mar 2025' },
  { field: 'sourceUrl', header: 'Source URL', required: false, example: 'https://example.com/press' },
];

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header spellings people use, mapped to fields. Matching ignores case, spaces and punctuation. */
const HEADER_ALIASES: Record<string, Field> = Object.fromEntries([
  ...COMPARABLE_TEMPLATE_COLUMNS.flatMap((column) => [
    [squash(column.header), column.field],
    [squash(column.field), column.field],
  ]),
  ...(
    [
      ['targetcompany', 'targetName'],
      ['acquirer', 'acquirerName'],
      ['buyer', 'acquirerName'],
      ['announced', 'announcedOn'],
      ['announceddate', 'announcedOn'],
      ['type', 'companyType'],
      ['enterprisevalue', 'enterpriseValue'],
      ['enterprisevalueev', 'enterpriseValue'],
      ['arrbasis', 'arrBasis'],
      ['growth', 'arrGrowth'],
      ['arrgrowthyoy', 'arrGrowth'],
      ['arrgrowthyoy%', 'arrGrowth'],
      ['citation', 'sourceCitation'],
      ['sourcelink', 'sourceUrl'],
      ['url', 'sourceUrl'],
    ] as const
  ).map(([alias, field]) => [squash(alias), field]),
]) as Record<string, Field>;

/**
 * A CSV file or rows pasted from a spreadsheet (tab-separated) as rows of
 * cells. Quoted cells may hold the delimiter, doubled quotes and line breaks.
 */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** A cell for a CSV file: quoted when it holds a comma, quote or line break. */
export function csvCell(value: string): string {
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The downloadable template: headers plus one clearly labelled example row. */
export function comparableTemplateCsv(): string {
  return [COMPARABLE_TEMPLATE_COLUMNS.map((column) => column.header), COMPARABLE_TEMPLATE_COLUMNS.map((column) => column.example)]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n')
    .concat('\r\n');
}

const KIND_WORDS: Record<string, ComparableEntry['kind']> = {
  precedenttransaction: 'PRECEDENT_TRANSACTION',
  precedent: 'PRECEDENT_TRANSACTION',
  transaction: 'PRECEDENT_TRANSACTION',
  publicpeer: 'PUBLIC_PEER',
  peer: 'PUBLIC_PEER',
  public: 'PUBLIC_PEER',
};
const COMPANY_TYPE_WORDS: Record<string, string> = Object.fromEntries(
  COMPANY_TYPES.flatMap((type) => [
    [squash(type), type],
    [squash(COMPANY_TYPE_LABELS[type]), type],
  ]),
);

/** Spreadsheet wording to the form's values; anything unknown passes through for the schema to reject. */
function normalise(field: Field, value: string): string {
  const trimmed = value.trim();
  if (field === 'kind') return KIND_WORDS[squash(trimmed)] ?? trimmed;
  if (field === 'companyType') return COMPANY_TYPE_WORDS[squash(trimmed)] ?? trimmed;
  if (field === 'arrBasis') return trimmed === '' ? '' : /^rev/i.test(trimmed) ? 'REVENUE' : /^arr$/i.test(trimmed) ? 'ARR' : trimmed;
  if (field === 'currency') return trimmed.toUpperCase();
  if (field === 'enterpriseValue' || field === 'arr') return trimmed.replace(/^[$€£]\s*/, '');
  return trimmed;
}

export interface BatchRowProblem {
  /** The column's header as the file spelled it, or the template header when the column is missing. */
  column: string;
  message: string;
}

export interface ParsedBatchRow {
  /** 1-based line in the file, the header being line 1. */
  line: number;
  /** The cells as the file had them, keyed by the file's headers. */
  cells: Record<string, string>;
  entry: ComparableEntry | null;
  problems: BatchRowProblem[];
}

export interface ParsedBatch {
  headers: string[];
  unknownColumns: string[];
  missingColumns: string[];
  rows: ParsedBatchRow[];
}

/**
 * Read a batch: map the headers, then check every row with the same schema as
 * a single entry. Rows are never fixed up beyond spreadsheet wording.
 */
export function parseComparableBatch(text: string): ParsedBatch {
  const [headerCells = [], ...data] = parseDelimited(text);
  const headers = headerCells.map((header) => header.trim());
  const fieldOf = headers.map((header) => HEADER_ALIASES[squash(header)] ?? null);
  const unknownColumns = headers.filter((header, index) => header !== '' && fieldOf[index] === null);
  const present = new Set(fieldOf.filter((field): field is Field => field !== null));
  const missing = COMPARABLE_TEMPLATE_COLUMNS.filter((column) => column.required && !present.has(column.field));
  const headerFor = (field: Field) => headers[fieldOf.indexOf(field)] ?? COMPARABLE_TEMPLATE_COLUMNS.find((column) => column.field === field)?.header ?? field;

  const rows = data.map((cells, index): ParsedBatchRow => {
    const raw: Record<string, string> = {};
    const values: Partial<Record<Field, string>> = {};
    headers.forEach((header, column) => {
      const value = cells[column] ?? '';
      raw[header || `Column ${column + 1}`] = value;
      const field = fieldOf[column];
      if (field && values[field] === undefined) values[field] = normalise(field, value);
    });
    const parsed = comparableInputSchema.safeParse(Object.fromEntries(COMPARABLE_TEMPLATE_COLUMNS.map((column) => [column.field, values[column.field] ?? ''])));
    const problems = parsed.success
      ? []
      : parsed.error.issues.map((issue) => {
          const field = issue.path[0] as Field | undefined;
          return { column: field ? headerFor(field) : 'Row', message: rowMessage(field, issue.message) };
        });
    return { line: index + 2, cells: raw, entry: parsed.success ? parsed.data : null, problems };
  });
  return { headers, unknownColumns, missingColumns: missing.map((column) => column.header), rows };
}

function rowMessage(field: Field | undefined, message: string): string {
  if (field === 'kind') return 'Precedent transaction or Public peer';
  if (field === 'companyType') return `Unknown company type; use one of: ${COMPANY_TYPES.map((type) => COMPANY_TYPE_LABELS[type]).join(', ')}`;
  if (field === 'announcedOn') return 'A date such as 2025-03-31';
  if (field === 'currency') return 'A three-letter currency code such as USD';
  if (field === 'sourceUrl') return 'A link starting with https://';
  if (field === 'arrBasis') return 'ARR or Revenue';
  if ((field === 'name' || field === 'targetName') && /expected string|>=1|at least/i.test(message)) return 'Required';
  return message;
}

/** The same name, target and date as another comparable (case and spacing ignored). */
export function comparableDuplicateKey(entry: { name: string; targetName: string; announcedOn: string | null }): string {
  const tidy = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${tidy(entry.name)}|${tidy(entry.targetName)}|${entry.announcedOn ?? ''}`;
}

export const comparableBatchInputSchema = z.strictObject({
  /** The CSV file's text or the pasted rows; parsed on the server. */
  text: z.string().min(1).max(900_000),
  /** Lines of rows flagged as duplicates that the person chose to keep. */
  keepDuplicates: z.array(z.number().int().min(2)).max(COMPARABLE_BATCH_MAX_ROWS).default([]),
});
export type ComparableBatchInput = z.infer<typeof comparableBatchInputSchema>;

export interface ComparableBatchRowView {
  line: number;
  status: 'OK' | 'PROBLEM' | 'DUPLICATE';
  cells: Record<string, string>;
  problems: BatchRowProblem[];
  /** For OK and duplicate rows: what will be saved, for the preview. */
  summary: { name: string; targetName: string; announcedOn: string | null; enterpriseValue: string; arr: string; currency: string; multiple: string } | null;
  /** Duplicate rows: whether it is like a comparable already on record or an earlier row of this batch. */
  duplicateOf: 'EXISTING' | 'BATCH' | null;
}

export interface ComparableBatchPreviewView {
  headers: string[];
  unknownColumns: string[];
  missingColumns: string[];
  rows: ComparableBatchRowView[];
  counts: { total: number; ok: number; problems: number; duplicates: number };
}

export interface ComparableBatchResultView extends ComparableBatchPreviewView {
  imported: number;
}
