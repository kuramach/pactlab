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

/** RFC 4180 CSV: quoted fields, escaped quotes, embedded newlines, CRLF or LF. */
export function parseCsv(input: string): CsvTable {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
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
    } else if (char === ',') {
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
