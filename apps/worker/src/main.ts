import { loadConfig, workerEnvSchema } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createQueue, createWorker, DEAD_LETTER_QUEUE, redisConnection } from './queue';

const config = loadConfig(workerEnvSchema);
const logger = createLogger('worker', { level: config.LOG_LEVEL });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL, maxConnections: config.WORKER_CONCURRENCY });
await assertRuntimeRoleIsolation(prisma);

const connection = redisConnection(config.REDIS_URL);
const deadLetter = createQueue(connection, DEAD_LETTER_QUEUE);
const worker = createWorker(connection, { prisma }, { concurrency: config.WORKER_CONCURRENCY, deadLetter });

worker.on('completed', (job) => logger.info({ jobId: job.id, type: job.name }, 'job completed'));
worker.on('failed', (job, error) => logger.warn({ jobId: job?.id, type: job?.name, errorName: error.name }, 'job failed'));
logger.info({ env: config.APP_ENV, concurrency: config.WORKER_CONCURRENCY }, 'worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  await deadLetter.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
