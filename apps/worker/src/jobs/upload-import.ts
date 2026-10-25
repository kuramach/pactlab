import { importMappingSchema, jobEnvelopeSchema } from '@pactlab/contracts';
import { runUploadImport, UnavailableTenantObjectStore, UPLOAD_IMPORT_JOB_TYPE } from '@pactlab/db';
import type { ImportMapping } from '@pactlab/domain';
import { z } from 'zod';
import type { JobDependencies, JobOutcome } from './noop';

const payloadSchema = z.strictObject({
  uploadId: z.uuid(),
  syncRunId: z.uuid(),
  connectionId: z.uuid(),
  mapping: importMappingSchema,
});

/**
 * A large upload import (T-075), requested by the API. Replay-safe: the sync
 * engine skips a run that already succeeded and matches records by content
 * hash, so a retried job never duplicates evidence.
 */
export async function processUploadImportJob(
  deps: JobDependencies,
  input: unknown,
  report: (progress: object) => Promise<void> = async () => {},
): Promise<JobOutcome> {
  const envelope = jobEnvelopeSchema.parse(input);
  if (envelope.type !== UPLOAD_IMPORT_JOB_TYPE) throw new Error('Unexpected job type for upload import handler');
  const payload = payloadSchema.parse(envelope.payload);
  const run = await runUploadImport(deps.prisma, deps.objectStore ?? new UnavailableTenantObjectStore(), {
    organizationId: envelope.organizationId,
    dealId: envelope.dealId,
    requestedBy: envelope.requestedBy,
    correlationId: envelope.correlationId,
    uploadId: payload.uploadId,
    syncRunId: payload.syncRunId,
    connectionId: payload.connectionId,
    mapping: payload.mapping as ImportMapping,
  }, { onProgress: (progress) => report(progress) });
  // A failed run fails the job, so BullMQ retries it with backoff (a store outage, say) and then keeps it for review.
  if (run.status === 'FAILED') throw new Error(`Upload import run failed: ${run.errorClass ?? 'unknown'}`);
  return { jobRunId: run.id, replayed: false };
}
