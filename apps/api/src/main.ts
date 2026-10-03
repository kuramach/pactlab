import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createApp } from './app';
import { createAuth0Verifier } from './auth/identity';

// Fail closed: invalid configuration or an RLS-bypassing role stops startup.
const config = loadConfig(apiEnvSchema);
const logger = createLogger('api', { level: config.LOG_LEVEL });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
await assertRuntimeRoleIsolation(prisma);

const app = await createApp(
  { prisma, logger, identityVerifier: createAuth0Verifier(config.AUTH0_DOMAIN, config.AUTH0_AUDIENCE) },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
logger.info({ port: config.API_PORT, env: config.APP_ENV }, 'api listening');
