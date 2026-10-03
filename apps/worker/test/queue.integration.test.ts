import { newId } from '@pactlab/domain';
import { createPrismaClient, type PrismaClient } from '@pactlab/db';
import { createSyntheticTenant, type SyntheticTenant } from '@pactlab/db/testing';
import { QueueEvents, type Queue, type Worker } from 'bullmq';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueue, createWorker, enqueueJob, redisConnection } from '../src/queue';

const redisUrl = process.env['REDIS_URL'];
const runtimeUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];

/** Proves the queue works end to end against real Redis and PostgreSQL. */
describe.runIf(redisUrl && runtimeUrl && ownerUrl)('BullMQ queue', () => {
  const queueName = `pactlab-it-${newId()}`;
  let prisma: PrismaClient;
  let owner: pg.Client;
  let queue: Queue;
  let deadLetter: Queue;
  let worker: Worker;
  let events: QueueEvents;
  let tenant: SyntheticTenant;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    tenant = await createSyntheticTenant(owner, `Queue${Date.now()}`);
    prisma = createPrismaClient({ connectionString: runtimeUrl ?? '' });
    const connection = redisConnection(redisUrl ?? '');
    queue = createQueue(connection, queueName);
    deadLetter = createQueue(connection, `${queueName}-dlq`);
    events = new QueueEvents(queueName, { connection });
    worker = createWorker(connection, { prisma }, { concurrency: 1, deadLetter, queueName });
    await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]);
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.obliterate({ force: true });
    await deadLetter?.obliterate({ force: true });
    await queue?.close();
    await deadLetter?.close();
    await prisma?.$disconnect();
    await owner?.end();
  });

  it('processes a no-op job and collapses duplicate submissions', async () => {
    const envelope = {
      jobId: newId(),
      organizationId: tenant.organizationId,
      dealId: tenant.dealId,
      type: 'system.noop',
      schemaVersion: 1,
      idempotencyKey: newId(),
      attempt: 0,
      requestedBy: tenant.userId,
      correlationId: 'it',
    };
    const job = await enqueueJob(queue, envelope);
    const duplicate = await enqueueJob(queue, { ...envelope, jobId: newId() });
    expect(duplicate.id).toBe(job.id);
    const result = (await job.waitUntilFinished(events, 15_000)) as { replayed: boolean };
    expect(result.replayed).toBe(false);
    const runs = await owner.query('SELECT status FROM job_runs WHERE idempotency_key = $1', [envelope.idempotencyKey]);
    expect(runs.rows).toEqual([{ status: 'SUCCEEDED' }]);
  });
});
