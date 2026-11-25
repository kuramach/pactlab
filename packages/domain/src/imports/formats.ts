import type { CsvTable } from '../evidence/csv';
import { isYearPeriod, periodOfHeader, type AssistedMapping, type ImportLayout } from './ai-mapping';
import { mappingProblems, type ImportMapping } from './mapping';
import type { TargetDefinition } from './targets';

/**
 * Saved import formats (ADR 0042): a confirmed mapping, reused on the next file laid out the same way, with no
 * assistant. Deterministic: the same layout gives the same mapping, and the values are read from the cells as always.
 */

const squash = (text: string) => text.toLowerCase().replaceAll(/\s+/g, ' ').trim();

/**
 * What identifies a layout: the target, the layout kind, months or years, and the header cells that are not
 * periods (so next month's file, with new month columns, still matches). The API hashes it.
 */
export function formatSignatureText(target: string, layout: ImportLayout | undefined, header: readonly string[]): string {
  const kind = layout?.kind ?? 'ROWS';
  const periods = kind === 'ROWS' ? [] : (layout as Exclude<ImportLayout, { kind: 'ROWS' }>).periods;
  const granularity = kind === 'ROWS' ? '-' : periods.every((entry) => isYearPeriod(entry.period)) ? 'YEAR' : 'MONTH';
  const cells = header.filter((cell) => kind === 'ROWS' || periodOfHeader(cell) === null).map(squash);
  return ['import-format-1', target, kind, granularity, ...cells].join('\u001f');
}

/** A saved format as applied to a new file: the mapping, and the lines it has not seen before. */
export interface AppliedFormat {
  readonly mapping: ImportMapping;
  readonly newLines: readonly string[];
}

/**
 * Apply a saved mapping to a file whose signature matched: its periods re-read from this file's header, its line
 * kinds carried over by line name. Null when the result does not fit the file (then the assistant reads it).
 */
export function applySavedFormat(definition: TargetDefinition, table: CsvTable, saved: ImportMapping): AppliedFormat | null {
  if (saved.target !== definition.target) return null;
  const old = saved.layout;
  let layout: ImportLayout | undefined = old;
  if (old && old.kind !== 'ROWS') {
    const periods = table.header.flatMap((column) => {
      const period = periodOfHeader(column);
      return period ? [{ column, period }] : [];
    });
    if (periods.length === 0) return null;
    layout = old.kind === 'PERIOD_COLUMNS' ? { kind: 'PERIOD_COLUMNS', periods } : { kind: 'MONTHS_ACROSS', labelColumn: old.labelColumn, periods };
  }
  const mapping: ImportMapping = { ...saved, ...(layout ? { layout } : {}), acceptTieOutGaps: false };
  if (mappingProblems(definition, table.header, mapping, table.rows).length > 0) return null;
  // Lines this file has that the format has not classified: left for the person, never guessed.
  const newLines: string[] = [];
  if (definition.lineItems && layout?.kind === 'PERIOD_COLUMNS') {
    const source = mapping.fields['account'];
    const at = source?.kind === 'column' ? table.header.indexOf(source.column) : -1;
    if (at >= 0) {
      for (const row of table.rows) {
        const name = (row.cells[at] ?? '').trim();
        if (name && !mapping.lineKinds?.[name] && !newLines.includes(name)) newLines.push(name);
      }
    }
  }
  return { mapping, newLines };
}

/** The assisted-mapping record for a file read by a saved format: no assistant, said on screen. */
export function formatAssist(applied: AppliedFormat, headerRow: number, from: { fileName: string; confirmedAt: string }): AssistedMapping {
  const picks: Record<string, AssistedMapping['picks'][string]> = {};
  for (const [field, source] of Object.entries(applied.mapping.fields)) {
    if (source.kind !== 'none') picks[field] = { by: 'FORMAT', confidence: null, reason: `As in ${from.fileName}` };
  }
  return {
    source: 'FORMAT',
    headerRow,
    layout: applied.mapping.layout ?? { kind: 'ROWS' },
    fields: applied.mapping.fields,
    picks,
    lineKinds: applied.mapping.lineKinds ?? {},
    unsureLines: [...applied.newLines],
    questions: [],
    note: null,
    format: from,
    settings: { dateFormat: applied.mapping.dateFormat, numberFormat: applied.mapping.numberFormat, amountUnit: applied.mapping.amountUnit, negateAmounts: applied.mapping.negateAmounts },
  };
}
