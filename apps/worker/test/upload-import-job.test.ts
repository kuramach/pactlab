import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileSystemObjectStore,
  sourceUploads,
  syncRuns,
  UPLOAD_CONNECTOR_VERSION,
  UPLOAD_IMPORT_JOB_TYPE,
  withTenant,
} from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processUploadImportJob } from '../src/jobs/upload-import';

const CSV = 'line_id,customer_id,currency,amount,interval,period_start,period_end,created\nw_1,c1,USD,10.00,month,2026-09-01,2026-10-01,2026-09-01\nw_2,c2,USD,20.00,month,2026-09-01,2026-10-01,2026-09-01\n';
const MAPPING = {
  target: 'BILLING_INVOICE_LINE',
  fields: Object.fromEntries(['line_id', 'customer_id', 'currency', 'amount', 'interval', 'period_start', 'period_end', 'created'].map((name) => [name, { kind: 'column', column: name }])),
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
};

describe('upload.import job (background imports)', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let dir: string;
  let store: FileSystemObjectStore;

  /** An uploaded file with a requested (queued) run, as the API leaves it before enqueueing. */
  async function queuedImport(tenant: SyntheticTenant) {
    const id = newId();
    const bytes = new TextEncoder().encode(CSV);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectKey = `${tenant.organizationId}/${tenant.dealId}/uploads/${id}/original`;
    await store.put(objectKey, bytes);
    return withTenant(db.prisma, tenant.context, async (tx) => {
      await sourceUploads.create(tx, {
        id,
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        target: 'BILLING_INVOICE_LINE',
        system: 'pactlab_standard',
        fileName: 'lines.csv',
        sha256,
        sizeBytes: bytes.byteLength,
        rowCount: 2,
        header: CSV.split('\n')[0]?.split(',') ?? [],
        objectKey,
        visibility: 'BUYER_ONLY',
        uploadedBy: tenant.userId,
      });
      const connection = await sourceUploads.connectionFor(tx, {
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        system: 'pactlab_standard',
        systemLabel: 'Pactlab standard template',
        visibility: 'BUYER_ONLY',
        createdBy: tenant.userId,
      });
      const { run } = await syncRuns.request(tx, {
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        connectionId: connection.id,
        connectorVersion: UPLOAD_CONNECTOR_VERSION,
        idempotencyKey: `upload:${connection.id}:${sha256}:${id}`,
        requestedBy: tenant.userId,
        correlationId: 'test',
      });
      return { uploadId: id, objectKey, syncRunId: run.id, connectionId: connection.id };
    });
  }

  const envelope = (tenant: SyntheticTenant, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    jobId: newId(),
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    type: UPLOAD_IMPORT_JOB_TYPE,
    schemaVersion: 1,
    idempotencyKey: `upload-import:${String(payload['syncRunId'])}`,
    attempt: 0,
    requestedBy: tenant.userId,
    correlationId: 'test',
    payload,
    ...overrides,
  });

  const evidenceCount = async (dealId: string) =>
    (await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1`, [dealId])).rows[0]?.n;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    dir = await mkdtemp(join(tmpdir(), 'pactlab-worker-imports-'));
    store = new FileSystemObjectStore(dir);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('imports the upload, reports progress, and a retried job writes nothing twice', async () => {
    const { objectKey: _key, ...queued } = await queuedImport(a);
    const reported: object[] = [];
    const job = envelope(a, { ...queued, mapping: MAPPING });
    await processUploadImportJob({ prisma: db.prisma, objectStore: store }, job, async (progress) => void reported.push(progress));
    expect(reported.at(0)).toEqual({ phase: 'READING', processed: 0, total: 2 });
    expect(reported.at(-1)).toEqual({ phase: 'DONE', processed: 2, total: 2 });
    expect(await evidenceCount(a.dealId)).toBe(2);
    const upload = await db.owner.query<{ status: string }>(`SELECT status FROM source_uploads WHERE id = $1`, [queued.uploadId]);
    expect(upload.rows).toEqual([{ status: 'IMPORTED' }]);

    await processUploadImportJob({ prisma: db.prisma, objectStore: store }, { ...job, jobId: newId(), attempt: 1 });
    expect(await evidenceCount(a.dealId)).toBe(2);
  });

  it('fails the job (so BullMQ retries) when the original cannot be read, and records why', async () => {
    const queued = await queuedImport(a);
    const { objectKey, ...payload } = queued;
    await store.delete(objectKey);
    await expect(processUploadImportJob({ prisma: db.prisma, objectStore: store }, envelope(a, { ...payload, mapping: MAPPING }))).rejects.toThrow(/failed/);
    const run = await db.owner.query<{ status: string; error_class: string }>(`SELECT status, error_class FROM sync_runs WHERE id = $1`, [queued.syncRunId]);
    expect(run.rows).toEqual([{ status: 'FAILED', error_class: 'UploadImportError:STORE_UNAVAILABLE' }]);
  });

  it('refuses a job for another tenant’s deal and a malformed payload', async () => {
    const { objectKey: _key, ...payload } = await queuedImport(a);
    await expect(processUploadImportJob({ prisma: db.prisma, objectStore: store }, envelope(a, { ...payload, mapping: MAPPING }, { requestedBy: b.userId }))).rejects.toThrow();
    await expect(processUploadImportJob({ prisma: db.prisma, objectStore: store }, envelope(a, { ...payload, mapping: { target: 'NOPE' } }))).rejects.toThrow();
    expect(await evidenceCount(b.dealId)).toBe(0);
  });
});
