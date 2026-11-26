import { pnlPeriods, type PnlLineInput, type PnlLineKindInput, type PnlPeriod } from '@pactlab/calculations';
import { ACTIVE_EVIDENCE, type TransactionClient } from '@pactlab/db';
import { PNL_LINE_EVIDENCE_TYPE, PNL_LINE_KINDS } from '@pactlab/domain';

/** Largest P&L read for one QoE or valuation view: far above any real statement (lines × months). */
export const MAX_PNL_LINES = 20_000;

export class TooManyPnlLinesError extends Error {
  override name = 'TooManyPnlLinesError';
}

/** The import a P&L figure came from, for "shown with its source". */
export interface PnlSourceFile {
  uploadId: string;
  fileName: string;
  importedAt: string | null;
}

export interface ImportedPnl {
  periods: PnlPeriod[];
  /** Per evidence item: the import that read it (the file a person can open on Sources). */
  fileOf: Map<string, PnlSourceFile>;
}

const LINE_KINDS = new Set<string>(PNL_LINE_KINDS);

/**
 * The pact's imported P&L (T-149): the active `finance.pnl_line` records, newest version of each
 * line, read under RLS. When two imports cover the same period, the period is read from the newer
 * one only, so a re-sent statement never doubles a month. Withdrawn imports stop counting (T-154).
 */
export async function loadImportedPnl(tx: TransactionClient, dealId: string): Promise<ImportedPnl> {
  const rows = await tx.evidenceItem.findMany({
    where: { dealId, evidenceType: PNL_LINE_EVIDENCE_TYPE, ...ACTIVE_EVIDENCE },
    select: { id: true, connectionId: true, sourceRecordId: true, lastSyncRunId: true, canonical: true },
    orderBy: { id: 'asc' },
    take: MAX_PNL_LINES + 1,
  });
  if (rows.length > MAX_PNL_LINES) throw new TooManyPnlLinesError();
  // Ids are UUIDv7: a later version of a source record sorts after the earlier one.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(`${row.connectionId}|${row.sourceRecordId}`, row);

  const lines: (PnlLineInput & { connectionId: string; lastSyncRunId: string })[] = [];
  for (const row of latest.values()) {
    const canonical = (row.canonical ?? {}) as Record<string, string | null>;
    const kind = canonical['line_kind'];
    const period = canonical['month'];
    const amount = canonical['amount'];
    if (!kind || !LINE_KINDS.has(kind) || !period || !amount) continue;
    lines.push({ evidenceId: row.id, account: canonical['account'] ?? '', period, amount, kind: kind as PnlLineKindInput, connectionId: row.connectionId, lastSyncRunId: row.lastSyncRunId });
  }
  // Per period, the import with the newest line wins; the other's lines for that period are left out.
  const newest = new Map<string, { connectionId: string; id: string }>();
  for (const line of lines) {
    const seen = newest.get(line.period);
    if (!seen || seen.id < line.evidenceId) newest.set(line.period, { connectionId: line.connectionId, id: line.evidenceId });
  }
  const kept = lines.filter((line) => newest.get(line.period)?.connectionId === line.connectionId);

  const runIds = [...new Set(kept.map((line) => line.lastSyncRunId))];
  // bounded: one upload per import run that read these lines
  const uploads = runIds.length ? await tx.sourceUpload.findMany({ where: { dealId, syncRunId: { in: runIds } }, select: { id: true, fileName: true, importedAt: true, syncRunId: true } }) : [];
  const byRun = new Map(uploads.map((upload) => [upload.syncRunId, { uploadId: upload.id, fileName: upload.fileName, importedAt: upload.importedAt?.toISOString() ?? null }]));
  const fileOf = new Map<string, PnlSourceFile>();
  for (const line of kept) {
    const file = byRun.get(line.lastSyncRunId);
    if (file) fileOf.set(line.evidenceId, file);
  }
  return { periods: pnlPeriods(kept), fileOf };
}

/** The distinct files a set of P&L rows came from. */
export function filesOf(imported: ImportedPnl, evidenceIds: readonly string[]): PnlSourceFile[] {
  const files = new Map<string, PnlSourceFile>();
  for (const id of evidenceIds) {
    const file = imported.fileOf.get(id);
    if (file) files.set(file.uploadId, file);
  }
  return [...files.values()];
}
