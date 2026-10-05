import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createApp } from './app';
import { createAuth0Verifier } from './auth/identity';
import { FileSystemObjectStore } from './documents/storage-adapters';
import { SignatureMalwareScanner } from './documents/upload-policy';

// Fail closed: invalid configuration or an RLS-bypassing role stops startup.
const config = loadConfig(apiEnvSchema);
const logger = createLogger('api', { level: config.LOG_LEVEL });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
await assertRuntimeRoleIsolation(prisma);

// Local runs keep originals on disk and use the signature scanner. Deployed
// environments have no managed bucket or scanner wired yet, so document
// uploads fail closed there; no model provider is wired anywhere yet.
const localDocuments =
  config.APP_ENV === 'local' && config.DOCUMENT_STORE_DIR
    ? {
        objectStore: new FileSystemObjectStore(config.DOCUMENT_STORE_DIR),
        malwareScanner: new SignatureMalwareScanner(),
      }
    : undefined;

const app = await createApp(
  {
    prisma,
    logger,
    identityVerifier: createAuth0Verifier(config.AUTH0_DOMAIN, config.AUTH0_AUDIENCE),
    ...(localDocuments ? { documents: localDocuments } : {}),
  },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
logger.info({ port: config.API_PORT, env: config.APP_ENV }, 'api listening');
