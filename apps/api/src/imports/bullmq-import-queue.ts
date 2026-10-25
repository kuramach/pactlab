import { DEFAULT_JOB_QUEUE, jobEnvelopeSchema, queueJobId } from '@pactlab/contracts';
import { UPLOAD_IMPORT_JOB_TYPE, type ImportProgress, type UploadImportJob } from '@pactlab/db';
import { newId } from '@pactlab/domain';
import { Queue } from 'bullmq';
import type { ImportQueue } from './upload-store';

const idempotencyKey = (syncRunId: string) => `upload-import:${syncRunId}`;

/**
 * Large imports go to the worker through the shared job contract. The job id
 * comes from the run's idempotency key, so a double click enqueues once.
 * The payload carries ids and the column mapping only — never file contents.
 */
export class BullMqImportQueue implements ImportQueue {
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.queue = new Queue(DEFAULT_JOB_QUEUE, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: { age: 86_400, count: 1_000 }, removeOnFail: false },
    });
  }

  async enqueue(job: UploadImportJob, rows: number): Promise<void> {
    const envelope = jobEnvelopeSchema.parse({
      jobId: newId(),
      organizationId: job.organizationId,
      dealId: job.dealId,
      type: UPLOAD_IMPORT_JOB_TYPE,
      schemaVersion: 1,
      idempotencyKey: idempotencyKey(job.syncRunId),
      attempt: 0,
      requestedBy: job.requestedBy,
      correlationId: job.correlationId,
      payload: { uploadId: job.uploadId, syncRunId: job.syncRunId, connectionId: job.connectionId, mapping: job.mapping },
    });
    const jobId = queueJobId(envelope);
    // A job that failed every attempt is retried in place; any other existing job is already queued or done.
    const existing = await this.queue.getJob(jobId);
    if (existing && (await existing.isFailed())) {
      await existing.retry();
      return;
    }
    const added = await this.queue.add(envelope.type, envelope, { jobId });
    const progress: ImportProgress = { phase: 'QUEUED', processed: 0, total: rows };
    if (added.progress === 0) await added.updateProgress(progress);
  }

  async progress(run: { organizationId: string; dealId: string; syncRunId: string }): Promise<ImportProgress | null> {
    const job = await this.queue.getJob(queueJobId({ organizationId: run.organizationId, dealId: run.dealId, idempotencyKey: idempotencyKey(run.syncRunId) }));
    const progress = job?.progress;
    if (typeof progress !== 'object' || progress === null || !('phase' in progress)) return null;
    const { phase, processed, total } = progress as Partial<ImportProgress>;
    if (typeof phase !== 'string' || typeof processed !== 'number') return null;
    return { phase, processed, total: typeof total === 'number' ? total : null };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
