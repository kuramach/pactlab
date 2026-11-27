import { DEFAULT_JOB_QUEUE } from '@pactlab/contracts';
import { Queue } from 'bullmq';

/** What a queue still holds: jobs a hibernate would put to sleep mid-work (ADR 0063). */
export interface QueueState {
  readonly queue: string;
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  /** Delayed jobs that only exist because a job scheduler made them (e.g. the signing sweep): recreated on start. */
  readonly scheduled: number;
}

/** BullMQ names a scheduler's next job `repeat:<scheduler>:<time>`; the worker re-registers schedulers when it starts. */
export const isSchedulerJob = (id: string | undefined) => typeof id === 'string' && id.startsWith('repeat:');

/** Busy: anything waiting, running (stalled by the pause, so retried on wake) or delayed by a person's action. */
export function isBusy(state: QueueState): boolean {
  return state.waiting + state.active + state.delayed > 0;
}

/** Reads a queue's counts; delayed jobs made by a job scheduler are counted apart, since they are not anyone's work. */
export async function readQueueState(redisUrl: string, name = DEFAULT_JOB_QUEUE): Promise<QueueState> {
  const queue = new Queue(name, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'waiting-children');
    const delayed = await queue.getDelayed(0, 999);
    const scheduled = delayed.filter((job) => isSchedulerJob(job.id)).length;
    return {
      queue: name,
      waiting: (counts['waiting'] ?? 0) + (counts['prioritized'] ?? 0) + (counts['waiting-children'] ?? 0),
      active: counts['active'] ?? 0,
      delayed: Math.max(0, (counts['delayed'] ?? 0) - scheduled),
      scheduled,
    };
  } finally {
    await queue.close();
  }
}
