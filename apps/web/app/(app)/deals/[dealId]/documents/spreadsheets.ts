import { IMPORT_TARGETS, type ImportTarget } from '@pactlab/domain';
import type { DocumentListItem } from '../../../documents/_lib/view';

/** Spreadsheets: imported as data (their numbers feed the metrics), never read as contracts (Kumar, 2026-11-25). */
export const TABLE_TYPES: ReadonlySet<string> = new Set(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

/** What a filed spreadsheet can be imported as: its own import target, or a P&L for an income statement. */
export function importTargetOf(row: Pick<DocumentListItem, 'intake' | 'contentType' | 'status'>): ImportTarget | null {
  const category = row.intake?.state === 'FILED' ? row.intake.category : null;
  if (!category || row.status !== 'AVAILABLE' || !TABLE_TYPES.has(row.contentType)) return null;
  if (category === 'INCOME_STATEMENT') return 'FINANCIAL_PNL';
  return (IMPORT_TARGETS as readonly string[]).includes(category) ? (category as ImportTarget) : null;
}

