import { createHash } from 'node:crypto';
import { readTable } from '@pactlab/connectors';
import {
  applyMapping,
  canonicalMappingJson,
  IMPORT_TARGET_DEFINITIONS,
  mappedEvidence,
  MAPPING_VERSION,
  type CsvTable,
  type ImportMapping,
  type TenantContext,
} from '@pactlab/domain';
import { appendAuditEvent } from './audit';
import type { PrismaClient } from './client';
import { syncRuns, type SyncRunRecord } from './evidence';
import type { TenantObjectStore } from './object-store';
import { executeSyncRun } from './sync';
import { resolveJobContext, withTenant } from './tenant';
import { BILLING_UPLOAD_PROVIDER, PACK_UPLOAD_PROVIDER, sourceUploads, type SourceUploadRecord } from './uploads';

/**
 * One upload import, run the same way inline by the API (small files) and by
 * the worker (`upload.import` jobs, large files): read the stored original,
 * map every row, write evidence through the sync engine, then mark the
 * upload imported. Progress goes to the caller's hook, never the database.
 */
export const UPLOAD_IMPORT_JOB_TYPE = 'upload.import';
export const UPLOAD_CONNECTOR_VERSION = `billing-upload-1+${MAPPING_VERSION}`;
/** Uploads with more rows than this import in the background. */
export const BACKGROUND_IMPORT_ROWS = 5_000;
/** The write transaction for 200,000 rows stays well inside this. */
const IMPORT_TIMEOUT_MS = 20 * 60_000;

export type ImportPhase = 'QUEUED' | 'READING' | 'VALIDATING' | 'WRITING' | 'DONE';

export interface UploadImportJob {
  organizationId: string;
  dealId: string;
  requestedBy: string;
  correlationId: string;
  uploadId: string;
  syncRunId: string;
  connectionId: string;
  mapping: ImportMapping;
}

export class UploadImportError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'PURGED' | 'TAMPERED' | 'STORE_UNAVAILABLE') {
    super(`Upload import failed: ${code}`);
    this.name = 'UploadImportError';
  }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const isBilling = (row: SourceUploadRecord) => row.target === 'BILLING_INVOICE_LINE';
export const uploadDataset = (row: Pick<SourceUploadRecord, 'id' | 'fileName'>) => `uploads/${row.id}/${row.fileName}`;

/** How far a run has got (counts only). Reported by the caller's hook: the worker stores it on its job. */
export interface ImportProgress {
  phase: ImportPhase;
  processed: number;
  total: number | null;
}

/** The stored original, verified against its upload hash, read as a table. */
export async function readUploadTable(store: TenantObjectStore, row: SourceUploadRecord): Promise<CsvTable> {
  if (!row.objectKey) throw new UploadImportError('PURGED');
  let bytes: Uint8Array;
  try {
    bytes = await store.get(row.objectKey);
  } catch {
    throw new UploadImportError('STORE_UNAVAILABLE');
  }
  if (sha256(bytes) !== row.sha256) throw new UploadImportError('TAMPERED');
  return (await readTable(bytes, { fileName: row.fileName, sheet: row.sheet })).table;
}

/**
 * Run a requested import to completion. Replay-safe: a run that already
 * succeeded is not written again, and records are matched by content hash.
 */
export async function runUploadImport(
  prisma: PrismaClient,
  store: TenantObjectStore,
  job: UploadImportJob,
  options: { preread?: { row: SourceUploadRecord; table: CsvTable }; onProgress?: (progress: ImportProgress) => Promise<void> } = {},
): Promise<SyncRunRecord> {
  const { preread } = options;
  const tenant = await resolveJobContext(prisma, job);
  const row = preread?.row ?? (await withTenant(prisma, tenant, (tx) => sourceUploads.get(tx, job.dealId, job.uploadId)));
  if (!row) throw new UploadImportError('NOT_FOUND');
  // Progress never touches the database: it must not wait on the run's own transaction.
  const progress = async (phase: ImportPhase, processed: number, total: number | null) => {
    try {
      await options.onProgress?.({ phase, processed, total });
    } catch {
      // Progress is best-effort; the run's outcome is what counts.
    }
  };

  await progress('READING', 0, row.rowCount);
  let table: CsvTable;
  try {
    table = preread?.table ?? (await readUploadTable(store, row));
  } catch (error) {
    // The original cannot be read (purged, changed, store down): the run fails visibly instead of waiting forever.
    const errorClass = error instanceof UploadImportError ? `UploadImportError:${error.code}` : error instanceof Error ? error.name : 'Unknown';
    await withTenant(prisma, tenant, (tx) =>
      tx.syncRun.updateMany({ where: { id: job.syncRunId, status: { not: 'SUCCEEDED' } }, data: { status: 'FAILED', errorClass, completedAt: new Date() } }),
    );
    return finish(prisma, tenant, job, row);
  }
  const definition = IMPORT_TARGET_DEFINITIONS[row.target];
  const dataset = uploadDataset(row);
  await progress('VALIDATING', 0, table.rows.length);
  try {
    await executeSyncRun(
      prisma,
      { organizationId: job.organizationId, dealId: job.dealId, requestedBy: job.requestedBy, syncRunId: job.syncRunId },
      {
        provider: isBilling(row) ? BILLING_UPLOAD_PROVIDER : PACK_UPLOAD_PROVIDER,
        version: UPLOAD_CONNECTOR_VERSION,
        pull: async () => {
          const mapped = applyMapping(table, job.mapping, dataset, definition);
          const evidence = mappedEvidence(
            mapped,
            {
              target: row.target,
              sourceSystem: isBilling(row) ? `${BILLING_UPLOAD_PROVIDER}:${row.system}` : `${PACK_UPLOAD_PROVIDER}:${row.target.toLowerCase()}`,
              dataset,
            },
            definition,
          );
          await progress('WRITING', 0, evidence.records.length);
          return evidence;
        },
      },
      { onProgress: (written, total) => progress('WRITING', written, total), timeoutMs: IMPORT_TIMEOUT_MS },
    );
  } catch {
    // The engine records FAILED with an error class; the run reports it.
  }

  const run = await finish(prisma, tenant, job, row);
  await progress('DONE', run.recordsSeen, run.recordsSeen);
  return run;
}

/** Record the outcome: mark the upload imported when the run succeeded, audit either way, close progress. */
async function finish(prisma: PrismaClient, tenant: TenantContext, job: UploadImportJob, row: SourceUploadRecord): Promise<SyncRunRecord> {
  return withTenant(prisma, tenant, async (tx) => {
    const run = await syncRuns.get(tx, job.dealId, job.syncRunId);
    if (!run) throw new UploadImportError('NOT_FOUND');
    const current = await sourceUploads.get(tx, job.dealId, row.id);
    if (run.status === 'SUCCEEDED' && current && current.status !== 'IMPORTED') {
      await sourceUploads.markImported(tx, row.id, {
        connectionId: job.connectionId,
        syncRunId: run.id,
        mapping: JSON.parse(canonicalMappingJson(job.mapping)) as object,
        mappingVersion: MAPPING_VERSION,
      });
    }
    await appendAuditEvent(tx, {
      organizationId: job.organizationId,
      dealId: job.dealId,
      actorUserId: job.requestedBy,
      action: 'source_upload.imported',
      targetType: 'source_upload',
      targetId: row.id,
      outcome: run.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      requestId: job.correlationId,
    });
    return run;
  });
}
