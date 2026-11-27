/**
 * `tsx src/ops/queue-check.ts`: the hibernate's queue check (ADR 0063), run as a one-off task on the migrate task
 * definition (it has the environment's REDIS_URL) by scripts/hibernate-environment.sh after the services are at zero.
 * Prints one line, `QUEUE_CHECK {...}`, with counts only (never job data), and exits 0 when nothing is waiting,
 * running or delayed, 3 when something is, 2 when it cannot tell. A busy queue stops the hibernate before anything
 * is deleted.
 */
import { isBusy, readQueueState } from './queue-state';

const redisUrl = process.env['REDIS_URL'];
if (!redisUrl) {
  process.stderr.write('queue-check: REDIS_URL is required\n');
  process.exit(2);
}
try {
  const state = await readQueueState(redisUrl);
  process.stdout.write(`QUEUE_CHECK ${JSON.stringify(state)}\n`);
  process.exit(isBusy(state) ? 3 : 0);
} catch (error) {
  process.stderr.write(`queue-check: could not read the queue (${error instanceof Error ? error.name : 'unknown'})\n`);
  process.exit(2);
}
