import { apiEnvSchema, applyDatabaseUrls, loadConfig, packPreviewEnabled } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient, S3ObjectStore } from '@pactlab/db';
import { readFileSync } from 'node:fs';
import { DocuSignOAuth, FixturePropertyProvider, LocalEncryptedSecretStore, parseSelfHostedHosts, RentCastPropertyProvider, StripeBillingProvider, UnconfiguredBillingProvider } from '@pactlab/connectors';
import { createLogger } from '@pactlab/observability';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { PollyTextToSpeech, TranscribeSpeechToText } from '@pactlab/ai';
import { createAiGateway } from './ai/ai-provider';
import { createApp } from './app';
import { relyingParty } from './app.module';
import { createAuth0Verifier, DisabledIdentityVerifier } from './auth/identity';
import { FileSystemObjectStore } from './documents/storage-adapters';
import { BullMqImportQueue } from './imports/bullmq-import-queue';
import { LocalFileEmailSender } from './email-login/email-sender';
import { SesEmailSender } from './email-login/ses-email-sender';
import { BrandedEmailSender, emailAssets } from './email-login/branded-email';
import { ReleaseInfo, ssmReleaseSource } from './health/release-info';
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
    release: new ReleaseInfo(config.RELEASE_PARAMETER ? ssmReleaseSource(config.RELEASE_PARAMETER, config.AWS_REGION) : null),
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
    // Packs launch one at a time: unreleased ones are previewable in dev and qa only (or by PACK_PREVIEW).
    packPreview: packPreviewEnabled(config.APP_ENV, config.PACK_PREVIEW),
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
    // Property data for teaser pages (batch 2): RentCast with a key; synthetic facts outside production.
    // Billing (T-087): Stripe with a key; the fixture checkout outside production; never the fixture in production.
    billing: {
      ...(config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
        ? { provider: new StripeBillingProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET) }
        : config.APP_ENV === 'production'
          ? { provider: new UnconfiguredBillingProvider() }
          : {}),
      enforce: config.BILLING_ENFORCEMENT,
      automaticTax: config.STRIPE_AUTOMATIC_TAX,
    },
    property: config.RENTCAST_API_KEY ? new RentCastPropertyProvider(config.RENTCAST_API_KEY) : config.APP_ENV === 'production' ? null : new FixturePropertyProvider(),
    // E-signature (T-107): organizations connect their own DocuSign to Pactlab's app registration;
    // the fixture provider stands in outside production.
    signing: {
      fixture: config.APP_ENV !== 'production',
      docusign:
        config.DOCUSIGN_INTEGRATION_KEY && config.DOCUSIGN_CLIENT_SECRET && config.DOCUSIGN_AUTH_HOST && config.DOCUSIGN_CONNECT_HMAC_KEY
          ? {
              oauth: new DocuSignOAuth({ integrationKey: config.DOCUSIGN_INTEGRATION_KEY, clientSecret: config.DOCUSIGN_CLIENT_SECRET, authHost: config.DOCUSIGN_AUTH_HOST }),
              connectHmacKey: config.DOCUSIGN_CONNECT_HMAC_KEY,
              redirectUri: new URL('/settings/docusign/callback', config.APP_WEB_ORIGIN).toString(),
            }
          : null,
    },
    // The MCP server and Pactlab's OAuth for it (T-084): the web origin issues (consent page and
    // metadata live there); the MCP server is /v1/mcp wherever the API is reachable.
    mcp: {
      issuer: new URL(config.APP_WEB_ORIGIN).origin,
      // Deployed, /v1 shares the web origin; locally the API listens on its own port.
      resource: `${new URL(config.API_PUBLIC_ORIGIN ?? (config.APP_ENV === 'local' ? `http://localhost:${config.API_PORT}` : config.APP_WEB_ORIGIN)).origin}/v1/mcp`,
    },
    emailLogin: {
      tokenSecret: config.AUTH_TOKEN_SECRET,
      webauthn: relyingParty(config.APP_WEB_ORIGIN, config.WEBAUTHN_RP_ID),
      ...(config.EMAIL_PROVIDER === 'ses' && config.EMAIL_FROM
        ? { emailSender: new BrandedEmailSender(new SesEmailSender(new SESv2Client({ region: config.AWS_REGION }), config.EMAIL_FROM), emailAssets(config.APP_WEB_ORIGIN)) }
        : config.APP_ENV === 'local' && config.LOCAL_MAIL_DIR
          ? { emailSender: new BrandedEmailSender(new LocalFileEmailSender(config.LOCAL_MAIL_DIR), emailAssets(config.APP_WEB_ORIGIN)) }
          : {}),
    },
  },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
logger.info({ port: config.API_PORT, env: config.APP_ENV, ai: ai.status.provider }, 'api listening');
