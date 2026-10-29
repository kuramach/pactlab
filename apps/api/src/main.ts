import { apiEnvSchema, applyDatabaseUrls, loadConfig } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient, S3ObjectStore } from '@pactlab/db';
import { readFileSync } from 'node:fs';
import { LocalEncryptedSecretStore, parseSelfHostedHosts } from '@pactlab/connectors';
import { createLogger } from '@pactlab/observability';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { PollyTextToSpeech, TranscribeSpeechToText } from '@pactlab/ai';
import { createAiGateway } from './ai/ai-provider';
import { createApp } from './app';
import { createAuth0Verifier, DisabledIdentityVerifier } from './auth/identity';
import { FileSystemObjectStore } from './documents/storage-adapters';
import { BullMqImportQueue } from './imports/bullmq-import-queue';
import { LocalFileEmailSender } from './email-login/email-sender';
import { SesEmailSender } from './email-login/ses-email-sender';
import { SignatureMalwareScanner } from './documents/upload-policy';
import { FixtureMacroForecastProvider, ImfMacroForecastProvider } from '@pactlab/connectors';

// Deployed tasks get database credentials as separate secret fields; build the URL from them.
applyDatabaseUrls();
// Fail closed: invalid configuration or an RLS-bypassing role stops startup.
const config = loadConfig(apiEnvSchema);
const logger = createLogger('api', { level: config.LOG_LEVEL });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
await assertRuntimeRoleIsolation(prisma);

// Originals: the environment's bucket when deployed (task-role credentials,
// SSE-KMS), the local file store on a laptop. Scanning: the signature scanner
// locally and, by explicit setting, in dev and qa (ADR 0019); stage and
// production need a managed scanner. Without both, uploads fail closed.
const objectStore =
  config.DOCUMENT_STORE === 's3' && config.DOCUMENT_BUCKET && config.DOCUMENT_KMS_KEY_ID
    ? new S3ObjectStore(new S3Client({ region: config.AWS_REGION }), config.DOCUMENT_BUCKET, config.DOCUMENT_KMS_KEY_ID)
    : config.APP_ENV === 'local' && config.DOCUMENT_STORE_DIR
      ? new FileSystemObjectStore(config.DOCUMENT_STORE_DIR)
      : undefined;
const malwareScanner = config.APP_ENV === 'local' || config.MALWARE_SCANNER === 'signature' ? new SignatureMalwareScanner() : undefined;
const localDocuments = objectStore && malwareScanner ? { objectStore, malwareScanner } : undefined;

// Document AI: Claude on Bedrock when AI_PROVIDER=bedrock (SSO credentials from
// the AWS default chain); otherwise every model call fails closed.
const ai = await createAiGateway(config);

// Provider credentials: an encrypted local store until Secrets Manager (T-007);
// elsewhere live connections that need a stored token fail closed.
const providers = {
  // Operator-approved self-hosted Jira servers; Atlassian Cloud is always allowed.
  jiraSitePolicy: { selfHostedHosts: parseSelfHostedHosts(config.JIRA_SELF_HOSTED_HOSTS) },
  allowFixtureConnections: config.ALLOW_FIXTURE_CONNECTIONS
    ? config.ALLOW_FIXTURE_CONNECTIONS === 'true'
    : ['local', 'test', 'dev', 'qa'].includes(config.APP_ENV),
  ...(config.APP_ENV === 'local' && config.LOCAL_SECRETS_DIR && config.LOCAL_SECRETS_KEY
    ? { secrets: new LocalEncryptedSecretStore(config.LOCAL_SECRETS_DIR, config.LOCAL_SECRETS_KEY) }
    : {}),
  githubApp:
    config.GITHUB_APP_ID && config.GITHUB_APP_SLUG && config.GITHUB_APP_PRIVATE_KEY_PATH
      ? {
          appId: config.GITHUB_APP_ID,
          slug: config.GITHUB_APP_SLUG,
          privateKeyPem: readFileSync(config.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8'),
        }
      : null,
};

const app = await createApp(
  {
    prisma,
    logger,
    providers,
    // Auth0 is optional per deployment; without it only email-code tokens verify.
    identityVerifier:
      config.AUTH0_DOMAIN && config.AUTH0_AUDIENCE
        ? createAuth0Verifier(config.AUTH0_DOMAIN, config.AUTH0_AUDIENCE)
        : new DisabledIdentityVerifier(),
    documents: { ...localDocuments, gateway: ai.gateway },
    // Large imports run on the worker when Redis is configured (the worker shares the store).
    ...(localDocuments ? { uploads: { ...localDocuments, importQueue: config.REDIS_URL ? new BullMqImportQueue(config.REDIS_URL) : null } } : {}),
    aiStatus: ai.status,
    environment: config.APP_ENV,
    macroForecasts: config.MACRO_FORECAST_SOURCE === 'fixture' ? new FixtureMacroForecastProvider() : new ImfMacroForecastProvider(),
    // Foresight voice uses Amazon Transcribe and Polly with the same AWS sign-in as Bedrock.
    ...(config.AI_PROVIDER === 'bedrock' && config.AWS_REGION
      ? { voice: { speechToText: new TranscribeSpeechToText(config.AWS_REGION), textToSpeech: new PollyTextToSpeech(config.AWS_REGION) } }
      : {}),
    // Sign-in codes: Amazon SES when deployed (EMAIL_PROVIDER=ses), a local mail folder on a laptop.
    signup: {
      requiresApproval: config.SIGNUP_REQUIRES_APPROVAL,
      operatorEmail: config.OPERATOR_EMAIL ?? null,
      loginUrl: new URL('/login', config.APP_WEB_ORIGIN).toString(),
    },
    emailLogin: {
      tokenSecret: config.AUTH_TOKEN_SECRET,
      ...(config.EMAIL_PROVIDER === 'ses' && config.EMAIL_FROM
        ? { emailSender: new SesEmailSender(new SESv2Client({ region: config.AWS_REGION }), config.EMAIL_FROM) }
        : config.APP_ENV === 'local' && config.LOCAL_MAIL_DIR
          ? { emailSender: new LocalFileEmailSender(config.LOCAL_MAIL_DIR) }
          : {}),
    },
  },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
logger.info({ port: config.API_PORT, env: config.APP_ENV, ai: ai.status.provider }, 'api listening');
