export interface CsvTable {
  readonly header: readonly string[];
  /** Data rows with their verbatim source text (for citation quote hashes). */
  readonly rows: readonly { readonly cells: readonly string[]; readonly text: string }[];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** Field separators Pactlab reads: comma, semicolon (common in European exports) and tab. */
export const DELIMITERS = [',', ';', '\t'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** RFC 4180 CSV: quoted fields, escaped quotes, embedded newlines, CRLF or LF. */
export function parseCsv(input: string): CsvTable {
  return parseDelimited(input, ',');
}

/**
 * The separator a delimited file uses, from its header line (outside quotes):
 * the most frequent of comma, semicolon and tab; comma on a tie or none.
 */
export function detectDelimiter(input: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of input.startsWith('\uFEFF') ? input.slice(1) : input) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && counts.has(char as Delimiter)) counts.set(char as Delimiter, (counts.get(char as Delimiter) ?? 0) + 1);
  }
  let best: Delimiter = ',';
  for (const delimiter of DELIMITERS) if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter;
  return best;
}

/** RFC 4180 rules with a chosen separator (comma, semicolon or tab). */
export function parseDelimited(input: string, delimiter: Delimiter): CsvTable {
  const records = parseDelimitedRecords(input, delimiter);
  const [header, ...rows] = records;
  if (!header) throw new CsvParseError('CSV has no header row');
  const names = header.cells.map((name) => name.trim());
  if (names.some((name) => name === '') || new Set(names).size !== names.length) {
    throw new CsvParseError('CSV header names must be non-empty and unique');
  }
  for (const [index, row] of rows.entries()) {
    if (row.cells.length !== names.length) {
      throw new CsvParseError(
        `Row ${index + 1} has ${row.cells.length} fields; expected ${names.length}`,
      );
    }
  }
  return { header: names, rows };
}

/** Every record of a delimited file, with its verbatim text; rows may differ in width (no header rules). */
export function parseDelimitedRecords(input: string, delimiter: Delimiter): { cells: string[]; text: string }[] {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const records: { cells: string[]; text: string }[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let start = 0;
  let i = 0;

  const endRecord = (end: number) => {
    cells.push(field);
    const raw = text.slice(start, end);
    if (!(cells.length === 1 && cells[0] === '' && raw === '')) records.push({ cells, text: raw });
    cells = [];
    field = '';
  };

  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      i += 1;
      continue;
    }
    if (char === '"') {
      if (field !== '') throw new CsvParseError(`Unexpected quote at offset ${i}`);
      quoted = true;
    } else if (char === delimiter) {
      cells.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      endRecord(i);
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      start = i + 1;
    } else {
      field += char;
    }
    i += 1;
  }
  if (quoted) throw new CsvParseError('Unterminated quoted field');
  if (field !== '' || cells.length > 0 || start < text.length) endRecord(text.length);
  return records;
}

/** Spreadsheet column letters for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * A table whose header is on a chosen row of a sheet (1-based among its non-empty rows), for files with
 * title rows above the header. Rows above it are left out; a blank header cell is named by its column
 * letter ("Column A"), a repeated name gets " (2)", and short rows are padded, so a real-world sheet reads.
 */
export function tableAtHeaderRow(records: readonly { readonly cells: readonly string[]; readonly text: string }[], headerRow: number): CsvTable {
  const filled = records.filter((record) => record.cells.some((cell) => cell.trim() !== ''));
  const header = filled[headerRow - 1];
  if (!header) throw new CsvParseError('The header row is past the end of the file');
  const data = filled.slice(headerRow);
  const lastFilled = (cells: readonly string[]) => {
    let width = cells.length;
    while (width > 0 && (cells[width - 1] ?? '').trim() === '') width -= 1;
    return width;
  };
  const width = Math.max(lastFilled(header.cells), ...data.map((row) => lastFilled(row.cells)));
  if (width === 0) throw new CsvParseError('The header row is empty');
  const seen = new Map<string, number>();
  const names = Array.from({ length: width }, (_, index) => {
    const base = (header.cells[index] ?? '').trim() || `Column ${columnLetter(index)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  return {
    header: names,
    rows: data.map((row) => ({ cells: Array.from({ length: width }, (_, index) => row.cells[index] ?? ''), text: row.text })),
  };
}
