import { apiEnvSchema, applyDatabaseUrls, loadConfig, packPreviewEnabled } from '@pactlab/config';
import { assertRuntimeRoleIsolation, createPrismaClient, S3ObjectStore } from '@pactlab/db';
import { readFileSync } from 'node:fs';
import { BoldSignSigningProvider, BoldSignWebhook, DocuSignOAuth, FixtureMarketRentProvider, FixturePhotoProvider, FixturePropertyProvider, FixturePropertyRecordProvider, GoogleMapsPhotoProvider, LocalEncryptedSecretStore, MCP_EVIDENCE_PROFILES, parseMcpEvidenceServers, parseSelfHostedHosts, RentCastMarketRentProvider, RentCastPropertyProvider, RentCastPropertyRecordProvider, StripeBillingProvider, UnconfiguredBillingProvider } from '@pactlab/connectors';
import { createLogger } from '@pactlab/observability';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { PollyTextToSpeech, TranscribeSpeechToText } from '@pactlab/ai';
import { createAiGateway } from './ai/ai-provider';
import { createApp } from './app';
import { AwsCostExplorerSource } from './admin/cost/cost-explorer';
import { powerRolesFrom, SsmEnvironmentPowerSource } from './admin/cost/environment-power';
import { relyingParty } from './app.module';
import { createAuth0Verifier, DisabledIdentityVerifier } from './auth/identity';
import { Auth0UserInfo } from './contacts/auth0-userinfo';
import { channelAdapters } from './contacts/channels-config';
import { FileSystemObjectStore } from './documents/storage-adapters';
import { BullMqImportQueue } from './imports/bullmq-import-queue';
import { LocalFileEmailSender } from './email-login/email-sender';
import { SesEmailSender } from './email-login/ses-email-sender';
import { HttpsWebFetcher } from './common/safe-fetch';
import { DatabaseSuppressionList } from './email-events/email-events.service';
import { SnsVerifier } from './email-events/sns';
import { ensureEmailEventsSubscription } from './email-events/subscribe';
import { BrandedEmailSender, emailAssets } from './email-login/branded-email';
import { ReleaseInfo, ssmReleaseSource } from './health/release-info';
import { SignatureMalwareScanner } from './documents/upload-policy';
import { SecretsManagerSecretStore } from './connections/secrets-manager-store';
import { FixtureMacroForecastProvider, ImfMacroForecastProvider } from '@pactlab/connectors';

// Deployed tasks get database credentials as separate secret fields; build the URL from them.
applyDatabaseUrls();
// Fail closed: invalid configuration or an RLS-bypassing role stops startup.
const config = loadConfig(apiEnvSchema);
const logger = createLogger('api', { level: config.LOG_LEVEL });
// RentCast (T-158): deployed environments pass the secret, created holding `unset` until scripts/rentcast-key.sh sets it.
const rentcastKey = config.RENTCAST_API_KEY === 'unset' ? undefined : config.RENTCAST_API_KEY;
// Google Maps Platform (T-188): Street View + Places photos with one pay-as-you-go key.
const mapsKey = config.GOOGLE_MAPS_API_KEY === 'unset' ? undefined : config.GOOGLE_MAPS_API_KEY;
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
// SES delivery events (T-109): SNS signing certificates are fetched through the SSRF-safe fetcher.
const webFetcher = new HttpsWebFetcher();
const snsVerifier = config.EMAIL_EVENTS_TOPIC_ARN
  ? new SnsVerifier(config.EMAIL_EVENTS_TOPIC_ARN, async (url) => {
      const response = await webFetcher.get(url, { maxBytes: 16 * 1024, accept: 'application/x-pem-file' });
      if (response.status !== 200) throw new Error(`certificate fetch answered ${response.status}`);
      return response.body.toString('utf8');
    })
  : null;
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

// Document AI: Claude on Bedrock when AI_PROVIDER=bedrock (the task role when
// deployed, SSO locally); otherwise every model call fails closed.
const ai = await createAiGateway(config, prisma);

// Provider credentials: an encrypted local store until Secrets Manager (T-007);
// elsewhere live connections that need a stored token fail closed.
const providers = {
  // Operator-approved self-hosted Jira servers; Atlassian Cloud is always allowed.
  jiraSitePolicy: { selfHostedHosts: parseSelfHostedHosts(config.JIRA_SELF_HOSTED_HOSTS) },
  // Operator-approved MCP evidence servers (T-084c), `<profile>=<https url>`; none unless listed.
  // Parsed here and fail-closed: a bad entry stops startup. (Read directly until packages/config lists it.)
  mcpServerPolicy: parseMcpEvidenceServers(process.env['MCP_EVIDENCE_SERVERS'], Object.keys(MCP_EVIDENCE_PROFILES)),
  allowFixtureConnections: config.ALLOW_FIXTURE_CONNECTIONS
    ? config.ALLOW_FIXTURE_CONNECTIONS === 'true'
    : ['local', 'test', 'dev', 'qa'].includes(config.APP_ENV),
  ...(config.CREDENTIAL_STORE === 'secretsmanager' && config.CREDENTIAL_STORE_PREFIX && config.CREDENTIAL_STORE_KMS_KEY_ID
    ? { secrets: new SecretsManagerSecretStore(new SecretsManagerClient({ region: config.AWS_REGION }), config.CREDENTIAL_STORE_PREFIX, config.CREDENTIAL_STORE_KMS_KEY_ID) }
    : config.APP_ENV === 'local' && config.LOCAL_SECRETS_DIR && config.LOCAL_SECRETS_KEY
      ? { secrets: new LocalEncryptedSecretStore(config.LOCAL_SECRETS_DIR, config.LOCAL_SECRETS_KEY) }
      : {}),
  // Document sources sign in with OAuth (T-147): each provider's Connect shows only when its client is set.
  documentOAuth: {
    ...(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET ? { 'google-drive': { clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET } } : {}),
    ...(config.MICROSOFT_OAUTH_CLIENT_ID && config.MICROSOFT_OAUTH_CLIENT_SECRET ? { onedrive: { clientId: config.MICROSOFT_OAUTH_CLIENT_ID, clientSecret: config.MICROSOFT_OAUTH_CLIENT_SECRET } } : {}),
  },
  webOrigin: config.APP_WEB_ORIGIN,
  googlePicker: config.GOOGLE_PICKER_API_KEY && config.GOOGLE_PROJECT_NUMBER ? { apiKey: config.GOOGLE_PICKER_API_KEY, appId: config.GOOGLE_PROJECT_NUMBER } : null,
  githubApp:
    config.GITHUB_APP_ID && config.GITHUB_APP_SLUG && config.GITHUB_APP_PRIVATE_KEY_PATH
      ? {
          appId: config.GITHUB_APP_ID,
          slug: config.GITHUB_APP_SLUG,
          privateKeyPem: readFileSync(config.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8'),
        }
      : null,
};

// Pactlab signing's adapters here (T-136): unset, the fixture outside production and none in production.
const signingAdapters = config.SIGNING_PROVIDER ?? (config.APP_ENV === 'production' ? [] : ['fixture']);
// Email: Amazon SES when deployed (EMAIL_PROVIDER=ses), a local mail folder on a laptop, else none.
const emailSender =
  config.EMAIL_PROVIDER === 'ses' && config.EMAIL_FROM
    ? new BrandedEmailSender(
        new SesEmailSender(new SESv2Client({ region: config.AWS_REGION }), config.EMAIL_FROM, {
          ...(config.EMAIL_CONFIGURATION_SET ? { configurationSetName: config.EMAIL_CONFIGURATION_SET } : {}),
          suppression: new DatabaseSuppressionList(prisma, config.AUTH_TOKEN_SECRET),
          logger,
        }),
        emailAssets(config.APP_WEB_ORIGIN),
      )
    : config.APP_ENV === 'local' && config.LOCAL_MAIL_DIR
      ? new BrandedEmailSender(new LocalFileEmailSender(config.LOCAL_MAIL_DIR), emailAssets(config.APP_WEB_ORIGIN))
      : null;
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
    aiModels: ai.models,
    environment: config.APP_ENV,
    // Hosting cost: real spend from Cost Explorer in the payer account, where the role is configured (live).
    // Each environment's power state on the same page (ADR 0063): live reads dev, qa and stage through their read-only
    // roles (ENVIRONMENT_POWER_ROLES); a hibernatable environment reads its own (POWER_ENVIRONMENT). Read directly until
    // packages/config lists them.
    ...(() => {
      const powerRoles = powerRolesFrom(process.env['ENVIRONMENT_POWER_ROLES']);
      const own = process.env['POWER_ENVIRONMENT'];
      const self = config.APP_ENV === 'production' ? 'prod' : (own ?? '');
      const power = config.AWS_REGION && (Object.keys(powerRoles).length || own) ? new SsmEnvironmentPowerSource({ region: config.AWS_REGION, self, roles: powerRoles }) : null;
      const source = config.COST_EXPLORER_ROLE_ARN ? new AwsCostExplorerSource(config.COST_EXPLORER_ROLE_ARN) : null;
      return source || power ? { hostingCost: { source, power } } : {};
    })(),
    // Packs launch one at a time: unreleased ones are previewable in dev and qa only (or by PACK_PREVIEW).
    packPreview: packPreviewEnabled(config.APP_ENV, config.PACK_PREVIEW),
    macroForecasts: config.MACRO_FORECAST_SOURCE === 'fixture' ? new FixtureMacroForecastProvider() : new ImfMacroForecastProvider(),
    // Live checks the public data it uses, from its own network (T-137 follow-up): Admin → Health, operator email on a change.
    ...(config.MACRO_FORECAST_SOURCE === 'imf' ? { sourceChecks: { intervalHours: config.SOURCE_CHECK_INTERVAL_HOURS, operatorEmail: config.OPERATOR_EMAIL ?? null } } : {}),
    // Foresight voice uses Amazon Transcribe and Polly with the same AWS sign-in as Bedrock.
    ...(config.AI_PROVIDER === 'bedrock' && config.AWS_REGION
      ? { voice: { speechToText: new TranscribeSpeechToText(config.AWS_REGION), textToSpeech: new PollyTextToSpeech(config.AWS_REGION) } }
      : {}),
    // Sign-in codes: Amazon SES when deployed (EMAIL_PROVIDER=ses), a local mail folder on a laptop.
    // Product-help chat (T-175): handed-off questions go here. (Read directly until packages/config lists it.)
    supportChat: { teamEmail: process.env['SUPPORT_TEAM_EMAIL']?.trim() || config.OPERATOR_EMAIL || null },
    featureRequests: { issueRepository: /^[\w.-]+\/[\w.-]+$/.test(process.env['TASK_ISSUE_REPOSITORY'] ?? '') ? (process.env['TASK_ISSUE_REPOSITORY'] ?? null) : null },
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
    property: rentcastKey ? new RentCastPropertyProvider(rentcastKey) : config.APP_ENV === 'production' ? null : new FixturePropertyProvider(),
    // Market rents for a rent roll (T-158, docs/runbooks/rentcast.md): the same key; the fixture outside production; off in production without it.
    marketRents: rentcastKey ? new RentCastMarketRentProvider(rentcastKey) : config.APP_ENV === 'production' ? null : new FixtureMarketRentProvider(),
    // Multifamily property profile (T-188, docs/runbooks/rentcast.md): RentCast records and Google Maps photos; fixtures outside production; off in production without a key.
    propertyRecords: rentcastKey ? new RentCastPropertyRecordProvider(rentcastKey) : config.APP_ENV === 'production' ? null : new FixturePropertyRecordProvider(),
    propertyPhotos: mapsKey ? new GoogleMapsPhotoProvider(mapsKey) : config.APP_ENV === 'production' ? null : new FixturePhotoProvider(),
    // E-signature (T-107) on the signing seam (T-136): SIGNING_PROVIDER lists the adapters Pactlab
    // signing may use here, the first being the default (unset: the fixture outside production).
    // Organizations may instead send from their own DocuSign, connected to Pactlab's registration.
    signing: {
      fixture: signingAdapters.includes('fixture'),
      // The first listed adapter that can serve: BoldSign once its key is set, else the next one listed.
      pactlab: signingAdapters.map((adapter) => (adapter === 'boldsign' ? (config.BOLDSIGN_API_KEY ? 'BOLDSIGN' : null) : 'FIXTURE')).find((adapter) => adapter !== null) ?? null,
      boldsign:
        signingAdapters.includes('boldsign') && config.BOLDSIGN_API_KEY
          ? {
              provider: new BoldSignSigningProvider({ apiKey: config.BOLDSIGN_API_KEY, baseUrl: config.BOLDSIGN_API_BASE_URL }),
              // Until a public endpoint is registered with BoldSign, the polling fallback carries status.
              webhook: config.BOLDSIGN_WEBHOOK_SECRET ? new BoldSignWebhook(config.BOLDSIGN_WEBHOOK_SECRET) : null,
            }
          : null,
      testRecipients: config.BOLDSIGN_PRODUCTION_SENDING ? null : (config.SIGNING_TEST_RECIPIENTS ?? null),
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
    emailEvents: { verifier: snsVerifier },
    // Pact activity notifications (T-145): the dispatcher sends due emails every minute (claims keep it at most once across tasks).
    notifications: { dispatch: true },
    // Contact details (T-180): Auth0's verified email claim; Telegram and WhatsApp, both off unless configured.
    contacts: {
      identityEmails: config.AUTH0_DOMAIN && config.AUTH0_AUDIENCE ? new Auth0UserInfo(config.AUTH0_DOMAIN) : null,
      ...channelAdapters(process.env, config.APP_ENV),
    },
    webFetcher,
    emailLogin: {
      tokenSecret: config.AUTH_TOKEN_SECRET,
      webauthn: relyingParty(config.APP_WEB_ORIGIN, config.WEBAUTHN_RP_ID),
      ...(emailSender ? { emailSender } : {}),
    },
  },
  { webOrigin: config.APP_WEB_ORIGIN },
);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
// Once listening, so SNS's confirmation can reach this release (T-109). Deployed, /v1 shares the web origin.
if (config.EMAIL_EVENTS_TOPIC_ARN && config.AWS_REGION && config.APP_ENV !== 'local') {
  void ensureEmailEventsSubscription({ region: config.AWS_REGION, topicArn: config.EMAIL_EVENTS_TOPIC_ARN, endpoint: new URL('/v1/email-events/sns', config.APP_WEB_ORIGIN).toString(), logger });
}
logger.info({ port: config.API_PORT, env: config.APP_ENV, ai: ai.status.provider }, 'api listening');
// Deployed: prove the task role reaches Bedrock, logged by error class only (T-096).
if (!['local', 'test'].includes(config.APP_ENV)) {
  void ai.check().then((health) => {
    if (!health) return;
    if (health.healthy) logger.info({ ai: 'healthy', modelId: health.modelId, latencyMs: health.latencyMs }, 'ai startup check');
    else logger.warn({ ai: 'unhealthy', modelId: health.modelId, kind: health.kind, providerCode: health.providerCode }, 'ai startup check');
  });
}
