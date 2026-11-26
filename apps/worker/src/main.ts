import { applyDatabaseUrls, loadConfig, workerEnvSchema } from '@pactlab/config';
import { BoldSignSigningProvider, type SigningProvider, type SigningProviderName } from '@pactlab/connectors';
import { S3Client } from '@aws-sdk/client-s3';
import { assertRuntimeRoleIsolation, createPrismaClient, FileSystemObjectStore, S3ObjectStore } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createQueue, createWorker, scheduleSigningPollSweep, DEAD_LETTER_QUEUE, redisConnection } from './queue';

applyDatabaseUrls();
const config = loadConfig(workerEnvSchema);
const logger = createLogger('worker', { level: config.LOG_LEVEL });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL, maxConnections: config.WORKER_CONCURRENCY });
await assertRuntimeRoleIsolation(prisma);

const connection = redisConnection(config.REDIS_URL);
const deadLetter = createQueue(connection, DEAD_LETTER_QUEUE);
// Uploaded originals: the environment's bucket when deployed, the API's local folder on a laptop; otherwise imports fail closed.
const objectStore =
  config.DOCUMENT_STORE === 's3' && config.DOCUMENT_BUCKET && config.DOCUMENT_KMS_KEY_ID
    ? new S3ObjectStore(new S3Client({ region: config.AWS_REGION }), config.DOCUMENT_BUCKET, config.DOCUMENT_KMS_KEY_ID)
    : config.APP_ENV === 'local' && config.DOCUMENT_STORE_DIR
      ? new FileSystemObjectStore(config.DOCUMENT_STORE_DIR)
      : undefined;
// The sweep polls through the same adapters the API sends with; an organization's own DocuSign needs its token, so the page-load poll keeps that one.
const signingProviders: Partial<Record<SigningProviderName, SigningProvider>> = config.BOLDSIGN_API_KEY ? { BOLDSIGN: new BoldSignSigningProvider({ apiKey: config.BOLDSIGN_API_KEY, baseUrl: config.BOLDSIGN_API_BASE_URL }) } : {};
const queue = createQueue(connection);
await scheduleSigningPollSweep(queue);
const worker = createWorker(connection, { prisma, signingProviders, ...(objectStore ? { objectStore } : {}) }, { concurrency: config.WORKER_CONCURRENCY, deadLetter });

worker.on('completed', (job) => logger.info({ jobId: job.id, type: job.name }, 'job completed'));
worker.on('failed', (job, error) => logger.warn({ jobId: job?.id, type: job?.name, errorName: error.name }, 'job failed'));
logger.info({ env: config.APP_ENV, concurrency: config.WORKER_CONCURRENCY }, 'worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  await queue.close();
  await deadLetter.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
