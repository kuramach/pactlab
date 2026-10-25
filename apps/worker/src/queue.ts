import { DEFAULT_JOB_QUEUE, jobEnvelopeSchema, NOOP_JOB_TYPE, queueJobId, type JobEnvelopeInput } from '@pactlab/contracts';
import { operatorOps, prismaExecutor, UPLOAD_IMPORT_JOB_TYPE } from '@pactlab/db';
import { bugFingerprint, scrubContext } from '@pactlab/domain';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { processNoopJob, type JobDependencies, type JobOutcome } from './jobs/noop';
import { processUploadImportJob } from './jobs/upload-import';

export const DEFAULT_QUEUE = DEFAULT_JOB_QUEUE;
export const DEAD_LETTER_QUEUE = 'pactlab-dead-letter';

/** `report` stores counts-only progress on the BullMQ job, where the API reads it. */
type Handler = (deps: JobDependencies, data: unknown, report: (progress: object) => Promise<void>) => Promise<JobOutcome>;

export const HANDLERS: Readonly<Record<string, Handler>> = {
  [NOOP_JOB_TYPE]: processNoopJob,
  [UPLOAD_IMPORT_JOB_TYPE]: processUploadImportJob,
};

/**
 * A job that failed every attempt becomes a bug report (T-072, spec §28),
 * deduplicated by fingerprint. Only the job summary is kept — type, attempts,
 * idempotency key — never the payload. Never throws.
 */
export async function fileJobExhausted(deps: JobDependencies, job: Job, error: Error): Promise<void> {
  const envelope = (job.data ?? {}) as { organizationId?: string; dealId?: string; type?: string; idempotencyKey?: string };
  if (!envelope.organizationId) return;
  try {
    await operatorOps.fileBug(prismaExecutor(deps.prisma), {
      organizationId: envelope.organizationId,
      dealId: null,
      reporterUserId: null,
      trigger: 'JOB_EXHAUSTED',
      fingerprint: bugFingerprint({ errorName: error.name, stack: error.stack ?? null, route: `job:${job.name}` }),
      title: `Background job failed after retries: ${job.name}`.slice(0, 200),
      whatHappened: null,
      expected: null,
      severity: 'HIGH',
      context: scrubContext({ jobType: job.name, attempts: job.attemptsMade, idempotencyKey: envelope.idempotencyKey ?? null, errorName: error.name, stack: error.stack ?? null }) as Record<string, unknown>,
      screenshot: null,
      screenshotType: null,
    });
  } catch {
    // Filing must never fail the worker.
  }
}

export function redisConnection(url: string): ConnectionOptions {
  // BullMQ workers require maxRetriesPerRequest: null for blocking commands.
  return { url, maxRetriesPerRequest: null };
}

export function createQueue(connection: ConnectionOptions, name = DEFAULT_QUEUE): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: false,
    },
  });
}

/**
 * Enqueue with the full job contract. The BullMQ job id is derived from the
 * tenant-scoped idempotency key, so duplicate submissions collapse.
 */
export async function enqueueJob(queue: Queue, input: JobEnvelopeInput): Promise<Job> {
  const envelope = jobEnvelopeSchema.parse(input);
  return queue.add(envelope.type, envelope, { jobId: queueJobId(envelope) });
}

export function createWorker(
  connection: ConnectionOptions,
  deps: JobDependencies,
  options: { concurrency: number; deadLetter: Queue; queueName?: string },
): Worker {
  const worker = new Worker(
    options.queueName ?? DEFAULT_QUEUE,
    async (job: Job) => {
      const handler = HANDLERS[job.name];
      if (!handler) throw new Error('Unknown job type');
      return handler(deps, { ...job.data, attempt: job.attemptsMade }, (progress) => job.updateProgress(progress));
    },
    { connection, concurrency: options.concurrency },
  );
  // Exhausted jobs move to the dead-letter queue with their envelope intact.
  worker.on('failed', (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void options.deadLetter.add(job.name, { envelope: job.data, errorName: error.name }, { jobId: job.id });
      void fileJobExhausted(deps, job, error);
    }
  });
  return worker;
}
