import { CsvParseError, parseCsv } from './csv';
import type { EvidencePull, EvidenceSource, NormalizedEvidence, SourceIssue } from './types';

/** How one CSV dataset maps onto normalized evidence. */
export interface CsvDatasetMapping {
  /** Stable dataset path inside the source, e.g. `HealthyCo/customers.csv`. */
  readonly dataset: string;
  readonly evidenceType: string;
  /** Column holding the source system's own record id. Never inferred from names. */
  readonly recordIdColumn: string;
  /** Optional ISO-8601 date or timestamp column for the observation date. */
  readonly observedAtColumn?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

function toObservedAt(value: string): string | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Normalize one CSV dataset. Empty cells become explicit nulls; rows without a
 * record id and repeated record ids are reported as issues, never guessed.
 */
export function normalizeCsv(
  sourceSystem: string,
  mapping: CsvDatasetMapping,
  text: string,
): EvidencePull {
  const issues: SourceIssue[] = [];
  let table;
  try {
    table = parseCsv(text);
  } catch (error) {
    const detail = error instanceof CsvParseError ? error.message : 'Unreadable CSV';
    return {
      records: [],
      issues: [{ dataset: mapping.dataset, row: null, code: 'MALFORMED_CSV', detail }],
    };
  }
  for (const column of [mapping.recordIdColumn, mapping.observedAtColumn]) {
    if (column && !table.header.includes(column)) {
      return {
        records: [],
        issues: [
          {
            dataset: mapping.dataset,
            row: null,
            code: 'MISSING_COLUMN',
            detail: `Column "${column}" is missing`,
          },
        ],
      };
    }
  }

  const seen = new Set<string>();
  const records: NormalizedEvidence[] = [];
  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const canonical: Record<string, string | null> = {};
    table.header.forEach((name, column) => {
      const value = (row.cells[column] ?? '').trim();
      canonical[name] = value === '' ? null : value;
    });
    const recordId = canonical[mapping.recordIdColumn];
    if (!recordId) {
      issues.push({
        dataset: mapping.dataset,
        row: rowNumber,
        code: 'MISSING_RECORD_ID',
        detail: `Empty "${mapping.recordIdColumn}"`,
      });
      return;
    }
    if (seen.has(recordId)) {
      issues.push({
        dataset: mapping.dataset,
        row: rowNumber,
        code: 'DUPLICATE_RECORD_ID',
        detail: `Record id repeated`,
      });
      return;
    }
    seen.add(recordId);

    let observedAt: string | null = null;
    const rawObserved = mapping.observedAtColumn ? canonical[mapping.observedAtColumn] : null;
    if (rawObserved) {
      observedAt = toObservedAt(rawObserved);
      if (!observedAt) {
        issues.push({
          dataset: mapping.dataset,
          row: rowNumber,
          code: 'INVALID_DATE',
          detail: `Unparseable "${mapping.observedAtColumn}"`,
        });
      }
    }
    records.push({
      evidenceType: mapping.evidenceType,
      sourceSystem,
      sourceRecordId: recordId,
      observedAt,
      canonical,
      locator: { kind: 'csv_row', dataset: mapping.dataset, row: rowNumber },
      quote: row.text,
    });
  });
  return { records, issues };
}

/**
 * CSV evidence source over any text loader (fixture files today, uploaded
 * files later). Mode-agnostic: only the loader differs between fixture and live.
 */
export function createCsvEvidenceSource(options: {
  provider: string;
  version: string;
  datasets: readonly CsvDatasetMapping[];
  load: (dataset: string) => Promise<string>;
}): EvidenceSource {
  return {
    provider: options.provider,
    version: options.version,
    async pull() {
      const records: NormalizedEvidence[] = [];
      const issues: SourceIssue[] = [];
      for (const mapping of options.datasets) {
        const result = normalizeCsv(options.provider, mapping, await options.load(mapping.dataset));
        records.push(...result.records);
        issues.push(...result.issues);
      }
      return { records, issues };
    },
  };
}
