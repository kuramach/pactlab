import type { CsvTable } from '../evidence/csv';
import type { EvidencePull, NormalizedEvidence, SourceIssue } from '../evidence/types';
import { isPnlLine, layoutProblems, missingLineKinds, pnlTieOut, reshapeTable, type ImportLayout, type PnlKind, type TieOutGap } from './ai-mapping';
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
  /** How the file is laid out; absent means one record per row (the standard template). */
  readonly layout?: ImportLayout;
  /** A line-by-line statement: what each account is, confirmed by a person. */
  readonly lineKinds?: Readonly<Record<string, PnlKind>>;
  /** A person accepted the subtotal gaps the preview showed (the file's own totals do not tie). */
  readonly acceptTieOutGaps?: boolean;
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

/**
 * Problems with the mapping itself, before any row is read. `header` is the file's header; a layout
 * that reshapes it is checked against it, and the fields against the reshaped header.
 */
export function mappingProblems(
  definition: TargetDefinition,
  fileHeader: readonly string[],
  mapping: ImportMapping,
  /** The file's rows: months across take their column names from the row labels. */
  rows: CsvTable['rows'] = [],
): string[] {
  const layout = layoutProblems(definition, fileHeader, mapping.layout);
  if (layout.length > 0) return layout;
  const header = reshapeTable({ header: fileHeader, rows }, mapping.layout).header;
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
export function applyMapping(
  fileTable: CsvTable,
  mapping: ImportMapping,
  dataset: string,
  definition: TargetDefinition = IMPORT_TARGET_DEFINITIONS[mapping.target],
): MappingResult {
  const problems = mappingProblems(definition, fileTable.header, mapping, fileTable.rows);
  if (problems.length > 0) {
    return {
      rows: [],
      issues: problems.map((detail) => ({ dataset, row: null, code: 'MISSING_COLUMN' as const, detail })),
    };
  }
  const table = reshapeTable(fileTable, mapping.layout);
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

    if (definition.lineItems) {
      const kind = canonical['account'] ? mapping.lineKinds?.[canonical['account']] : undefined;
      // Subtotals are checked against the lines (`statementCheck`), never imported as lines.
      if (kind && !isPnlLine(kind)) return;
      if (!kind && canonical['account']) {
        issues.push({ dataset, row, code: 'INVALID_VALUE', detail: `"${canonical['account']}" has no line kind` });
        return;
      }
      canonical['line_kind'] = kind ?? null;
    }
    const recordId = recordIdOf(definition, canonical);
    if (recordId && seen.has(recordId)) {
      issues.push({ dataset, row, code: 'DUPLICATE_RECORD_ID', detail: `${definition.fields.find((field) => field.name === definition.recordIdField)?.label ?? 'Record id'} repeated` });
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

/** A record's id: its id column, or several columns joined when one is not unique (e.g. month|payer). */
export function recordIdOf(definition: TargetDefinition, canonical: Readonly<Record<string, string | null>>): string | null {
  if (!definition.recordIdFields) return canonical[definition.recordIdField] ?? null;
  const parts = definition.recordIdFields.map((field) => canonical[field]);
  return parts.every((part) => part) ? parts.join('|') : null;
}

/**
 * Evidence from an uploaded, mapped export. The citation quote is the
 * canonical record, so unmapped columns never reach evidence.
 */
export function mappedEvidence(
  result: MappingResult,
  options: { target: ImportTarget; sourceSystem: string; dataset: string },
  definition: TargetDefinition = IMPORT_TARGET_DEFINITIONS[options.target],
): EvidencePull {
  const records: NormalizedEvidence[] = result.rows.map(({ row, canonical }) => {
    const observed = definition.observedAtFields.map((field) => canonical[field]).find((value) => value);
    return {
      evidenceType: definition.evidenceType,
      sourceSystem: options.sourceSystem,
      sourceRecordId: recordIdOf(definition, canonical) ?? '',
      observedAt: observed ? `${observed}T00:00:00.000Z` : null,
      canonical,
      locator: { kind: 'csv_row', dataset: options.dataset, row },
      quote: JSON.stringify(canonical),
    };
  });
  return { records, issues: result.issues };
}

/**
 * A line-by-line statement before import: accounts still without a kind, and subtotals that do not
 * equal their lines. Both block the import until fixed, or (gaps only) a person accepts them.
 */
export function statementCheck(fileTable: CsvTable, mapping: ImportMapping, definition: TargetDefinition = IMPORT_TARGET_DEFINITIONS[mapping.target]): { unclassified: string[]; gaps: TieOutGap[] } {
  if (!definition.lineItems || mappingProblems(definition, fileTable.header, mapping, fileTable.rows).length > 0) return { unclassified: [], gaps: [] };
  const table = reshapeTable(fileTable, mapping.layout);
  const at = (field: string) => {
    const source = mapping.fields[field];
    return source?.kind === 'column' ? table.header.indexOf(source.column) : -1;
  };
  const [account, month, amount] = [at('account'), at('month'), at('amount')];
  const accounts = table.rows.map((row) => (row.cells[account] ?? '').trim()).filter(Boolean);
  const unclassified = missingLineKinds(accounts, mapping.lineKinds);
  const lines = table.rows.flatMap((row) => {
    const name = (row.cells[account] ?? '').trim();
    const kind = mapping.lineKinds?.[name];
    const value = parseAmountValue(row.cells[amount] ?? '', { numberFormat: mapping.numberFormat, unit: mapping.amountUnit, currency: null, negate: mapping.negateAmounts });
    const period = (row.cells[month] ?? '').trim();
    return kind && value !== null && period ? [{ account: name, month: period, amount: value, kind }] : [];
  });
  return { unclassified, gaps: pnlTieOut(lines) };
}
