import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createApp } from './app';
import { createAuth0Verifier, DisabledIdentityVerifier } from './auth/identity';
import { FileSystemObjectStore } from './documents/storage-adapters';
import { LocalFileEmailSender } from './email-login/email-sender';
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
    // Auth0 is optional per deployment; without it only email-code tokens verify.
    identityVerifier:
      config.AUTH0_DOMAIN && config.AUTH0_AUDIENCE
        ? createAuth0Verifier(config.AUTH0_DOMAIN, config.AUTH0_AUDIENCE)
        : new DisabledIdentityVerifier(),
    ...(localDocuments ? { documents: localDocuments, uploads: localDocuments } : {}),
    // Sign-in codes are written to files locally; no email provider is wired
    // for deployed environments yet, so codes are not delivered there.
    signup: {
      requiresApproval: config.SIGNUP_REQUIRES_APPROVAL,
      operatorEmail: config.OPERATOR_EMAIL ?? null,
      loginUrl: new URL('/login', config.APP_WEB_ORIGIN).toString(),
    },
    emailLogin: {
      tokenSecret: config.AUTH_TOKEN_SECRET,
      ...(config.APP_ENV === 'local' && config.LOCAL_MAIL_DIR
        ? { emailSender: new LocalFileEmailSender(config.LOCAL_MAIL_DIR) }
        : {}),
    },
  },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
logger.info({ port: config.API_PORT, env: config.APP_ENV }, 'api listening');
