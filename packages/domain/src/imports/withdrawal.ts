import { permissionsForDealRole, type DealRole } from '../roles';

/**
 * Withdrawing an import (T-154, ADR 0039). Nothing is erased: a withdrawn
 * import keeps its record, file reference, mapping and row counts; what it
 * produced is voided (kept, but excluded from every read path); artefacts that
 * already consumed it are flagged, never rewritten. A re-import is a new
 * import that supersedes the withdrawn one.
 */
export const IMPORT_STATUSES = ['UPLOADED', 'IMPORTED', 'REJECTED', 'PURGED', 'WITHDRAWN'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const WITHDRAWAL_REASON_MIN = 3;
export const WITHDRAWAL_REASON_MAX = 500;

/** Withdrawing and re-importing are managing the pact's data: the deal team's write right, never a counterparty's. */
export function canManageImports(role: DealRole): boolean {
  return permissionsForDealRole(role).has('DEAL_WRITE');
}

export type WithdrawalProblem = 'NOT_IMPORTED' | 'ALREADY_WITHDRAWN' | 'REASON_REQUIRED';

/** Why an import cannot be withdrawn, or null. Only an imported upload produced data; one never imported is cancelled instead. */
export function withdrawalProblem(status: ImportStatus, reason: string): WithdrawalProblem | null {
  if (status === 'WITHDRAWN') return 'ALREADY_WITHDRAWN';
  if (status !== 'IMPORTED') return 'NOT_IMPORTED';
  if (reason.trim().length < WITHDRAWAL_REASON_MIN) return 'REASON_REQUIRED';
  return null;
}

export type ReimportProblem = 'NOT_WITHDRAWN' | 'ALREADY_SUPERSEDED' | 'OTHER_TARGET';

/** Why a new upload cannot supersede an earlier one, or null: only a withdrawn import, once, as the same kind of data. */
export function reimportProblem(
  previous: { status: ImportStatus; target: string; supersededByUploadId: string | null },
  target: string,
): ReimportProblem | null {
  if (previous.status !== 'WITHDRAWN') return 'NOT_WITHDRAWN';
  if (previous.supersededByUploadId !== null) return 'ALREADY_SUPERSEDED';
  if (previous.target !== target) return 'OTHER_TARGET';
  return null;
}

/** What the confirmation says, word for word, before anyone withdraws (web and API share it). */
export const WITHDRAWAL_CONSEQUENCES = [
  'Its rows stop counting everywhere: metrics, quality of earnings, valuation, checks and exports.',
  'Findings and valuation runs that already used them are flagged "source withdrawn". They are not changed.',
  'The import, its file, its mapping and this reason stay in the import history.',
] as const;

/** The withdrawal on an import record, as shown in its history. */
export interface ImportWithdrawalView {
  withdrawnAt: string;
  withdrawnBy: string;
  /** The person's display name where the reader may see it; null otherwise. */
  withdrawnByName: string | null;
  reason: string;
}

/** What every import view adds for withdrawal and lineage. */
export interface ImportRecordFields {
  status: ImportStatus;
  withdrawal: ImportWithdrawalView | null;
  supersedesUploadId: string | null;
  supersededByUploadId: string | null;
  /**
   * Whether the reader may delete (withdraw) this import and import it again (Kumar, 2026-11-25): the person who
   * imported it, or the deal lead or an analyst for anyone's. Rights only; its status says whether it can be now.
   */
  canDelete: boolean;
}

/** What a withdrawal did, as the confirmation reports it. */
export interface WithdrawalResultView {
  voidedRecords: number;
  flaggedFindings: number;
  flaggedValuationRuns: number;
}

/** One link in an import's chain: v1 withdrawn (reason) → v2 active. */
export interface ImportLineageEntry {
  uploadId: string;
  version: number;
  fileName: string;
  status: ImportStatus;
  createdAt: string;
  importedAt: string | null;
  rowCount: number;
  withdrawal: ImportWithdrawalView | null;
  /** Records this import's withdrawal voided (still held by none). */
  voidedRecords: number;
}

/** An artefact built on data whose import was later withdrawn. */
export interface SourceWithdrawnFlag {
  uploadId: string;
  fileName: string;
  withdrawnAt: string;
  reason: string;
}

/**
 * Order a chain of imports from its first version, following supersedes
 * links. Rows outside the chain, or a broken link, are left out; cycles stop.
 */
export function lineageOrder<T extends { id: string; supersedesUploadId: string | null }>(rows: readonly T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const successor = new Map<string, T>();
  for (const row of rows) if (row.supersedesUploadId && byId.has(row.supersedesUploadId)) successor.set(row.supersedesUploadId, row);
  const first = rows.find((row) => !row.supersedesUploadId || !byId.has(row.supersedesUploadId));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (let row = first; row && !seen.has(row.id); row = successor.get(row.id)) {
    seen.add(row.id);
    ordered.push(row);
  }
  return ordered;
}
