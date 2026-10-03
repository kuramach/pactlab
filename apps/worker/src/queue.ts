import { jobEnvelopeSchema, NOOP_JOB_TYPE, type JobEnvelopeInput } from '@pactlab/contracts';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { processNoopJob, type JobDependencies, type JobOutcome } from './jobs/noop';

export const DEFAULT_QUEUE = 'pactlab-default';
export const DEAD_LETTER_QUEUE = 'pactlab-dead-letter';

type Handler = (deps: JobDependencies, data: unknown) => Promise<JobOutcome>;

export const HANDLERS: Readonly<Record<string, Handler>> = {
  [NOOP_JOB_TYPE]: processNoopJob,
};

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
  const bullJobId = `${envelope.organizationId}:${envelope.dealId}:${envelope.idempotencyKey}`.replaceAll(':', '_');
  return queue.add(envelope.type, envelope, { jobId: bullJobId });
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
      return handler(deps, { ...job.data, attempt: job.attemptsMade });
    },
    { connection, concurrency: options.concurrency },
  );
  // Exhausted jobs move to the dead-letter queue with their envelope intact.
  worker.on('failed', (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void options.deadLetter.add(job.name, { envelope: job.data, errorName: error.name }, { jobId: job.id });
    }
  });
  return worker;
}
