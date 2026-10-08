import type { CsvTable } from '../evidence/csv';
import type { EvidencePull, NormalizedEvidence, SourceIssue } from '../evidence/types';
import { IMPORT_TARGET_DEFINITIONS, type ImportTarget, type TargetDefinition } from './targets';
import {
  parseAmountValue,
  parseCurrencyValue,
  parseDateValue,
  parseDecimalValue,
  type AmountUnit,
  type DateFormat,
  type NumberFormat,
} from './transforms';

/** Bump when transform semantics change; part of every import's idempotency key. */
export const MAPPING_VERSION = 'billing-mapping-1';

export type FieldSource =
  | { readonly kind: 'column'; readonly column: string }
  /** The same value for every row, e.g. `interval = month` for an ERP export that has none. */
  | { readonly kind: 'constant'; readonly value: string }
  | { readonly kind: 'none' };

export interface ImportMapping {
  readonly target: ImportTarget;
  readonly fields: Readonly<Record<string, FieldSource>>;
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormat;
  readonly amountUnit: AmountUnit;
  /** Flip every amount's sign, for exports of credit memos. */
  readonly negateAmounts: boolean;
}

export interface MappedRow {
  /** 1-based data row number in the uploaded file. */
  readonly row: number;
  readonly canonical: Readonly<Record<string, string | null>>;
}

export interface MappingResult {
  readonly rows: readonly MappedRow[];
  readonly issues: readonly SourceIssue[];
}

/** Stable JSON of a mapping (sorted keys), for hashing into idempotency keys. */
export function canonicalMappingJson(mapping: ImportMapping): string {
  const sort = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, inner]) => [key, sort(inner)]),
        )
      : value;
  return JSON.stringify(sort({ version: MAPPING_VERSION, ...mapping }));
}

const INTERVAL_SYNONYMS: Readonly<Record<string, string>> = {
  monthly: 'month',
  months: 'month',
  annual: 'year',
  annually: 'year',
  yearly: 'year',
  years: 'year',
};

/** Problems with the mapping itself, before any row is read. */
export function mappingProblems(definition: TargetDefinition, header: readonly string[], mapping: ImportMapping): string[] {
  const problems: string[] = [];
  for (const field of definition.fields) {
    const source = mapping.fields[field.name] ?? { kind: 'none' };
    if (source.kind === 'column' && !header.includes(source.column))
      problems.push(`${field.label}: column "${source.column}" is not in the file`);
    if (field.required && source.kind === 'none') problems.push(`${field.label} is required`);
    if (field.name === definition.recordIdField && source.kind !== 'column')
      problems.push(`${field.label} must come from a column`);
  }
  for (const name of Object.keys(mapping.fields)) {
    if (!definition.fields.some((field) => field.name === name)) problems.push(`Unknown field "${name}"`);
  }
  return problems;
}

/**
 * Map an uploaded table onto the target's canonical fields. Values are
 * normalized deterministically; anything that does not parse is reported
 * with its row number and left out — never guessed.
 */
export function applyMapping(table: CsvTable, mapping: ImportMapping, dataset: string): MappingResult {
  const definition = IMPORT_TARGET_DEFINITIONS[mapping.target];
  const problems = mappingProblems(definition, table.header, mapping);
  if (problems.length > 0) {
    return {
      rows: [],
      issues: problems.map((detail) => ({ dataset, row: null, code: 'MISSING_COLUMN' as const, detail })),
    };
  }
  const columnIndex = new Map(table.header.map((name, index) => [name, index]));
  const issues: SourceIssue[] = [];
  const rows: MappedRow[] = [];
  const seen = new Set<string>();

  table.rows.forEach((source, index) => {
    const row = index + 1;
    const raw = (name: string): string | null => {
      const from = mapping.fields[name] ?? { kind: 'none' };
      const value =
        from.kind === 'column' ? (source.cells[columnIndex.get(from.column) ?? -1] ?? '') : from.kind === 'constant' ? from.value : '';
      return value.trim() === '' ? null : value.trim();
    };
    const currencyRaw = raw('currency');
    const currency = currencyRaw === null ? null : parseCurrencyValue(currencyRaw);
    const canonical: Record<string, string | null> = {};
    const rowIssues: SourceIssue[] = [];

    for (const field of definition.fields) {
      const value = raw(field.name);
      if (value === null) {
        canonical[field.name] = null;
        if (field.required)
          rowIssues.push({ dataset, row, code: field.name === definition.recordIdField ? 'MISSING_RECORD_ID' : 'MISSING_FIELD', detail: `Empty "${field.label}"` });
        continue;
      }
      let parsed: string | null;
      switch (field.kind) {
        case 'date':
          parsed = parseDateValue(value, mapping.dateFormat);
          break;
        case 'money':
          parsed = parseAmountValue(value, {
            numberFormat: mapping.numberFormat,
            unit: mapping.amountUnit,
            currency,
            negate: mapping.negateAmounts,
          });
          break;
        case 'decimal':
          parsed = parseDecimalValue(value, mapping.numberFormat);
          break;
        case 'currency':
          parsed = currency;
          break;
        case 'code': {
          const lower = value.toLowerCase();
          parsed = INTERVAL_SYNONYMS[lower] && field.name === 'interval' ? INTERVAL_SYNONYMS[lower] : lower;
          break;
        }
        default:
          parsed = value;
      }
      if (parsed === null) {
        rowIssues.push({
          dataset,
          row,
          code: field.kind === 'date' ? 'INVALID_DATE' : 'INVALID_VALUE',
          detail: `"${field.label}" could not be read as ${field.kind}`,
        });
      }
      canonical[field.name] = parsed;
    }

    const recordId = canonical[definition.recordIdField];
    if (recordId && seen.has(recordId)) {
      issues.push({ dataset, row, code: 'DUPLICATE_RECORD_ID', detail: 'Line id repeated' });
      return;
    }
    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      return;
    }
    if (recordId) seen.add(recordId);
    rows.push({ row, canonical });
  });
  return { rows, issues };
}

/**
 * Evidence from an uploaded, mapped export. The citation quote is the
 * canonical record, so unmapped columns never reach evidence.
 */
export function mappedEvidence(
  result: MappingResult,
  options: { target: ImportTarget; sourceSystem: string; dataset: string },
): EvidencePull {
  const definition = IMPORT_TARGET_DEFINITIONS[options.target];
  const records: NormalizedEvidence[] = result.rows.map(({ row, canonical }) => {
    const observed = definition.observedAtFields.map((field) => canonical[field]).find((value) => value);
    return {
      evidenceType: definition.evidenceType,
      sourceSystem: options.sourceSystem,
      sourceRecordId: canonical[definition.recordIdField] ?? '',
      observedAt: observed ? `${observed}T00:00:00.000Z` : null,
      canonical,
      locator: { kind: 'csv_row', dataset: options.dataset, row },
      quote: JSON.stringify(canonical),
    };
  });
  return { records, issues: result.issues };
}
