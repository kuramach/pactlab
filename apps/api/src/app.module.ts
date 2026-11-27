import { randomBytes } from 'node:crypto';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NO_SPEECH_TO_TEXT, NO_TEXT_TO_SPEECH, NotConfiguredClaudeGateway, type SpeechToText, type TextToSpeech } from '@pactlab/ai';
import type { PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AI_OFF, type AiStatusView, type AiModelsRuntime } from './ai/ai-provider';
import { AiModule } from './ai/ai.module';
import { BalanceSheetModule } from './balance-sheet/balance-sheet.module';
import { PhasesModule } from './phases/phases.module';
import { CloseModule } from './close/close.module';
import { FixtureMarketRentProvider, FixturePropertyProvider, FixtureSigningProvider, type DocuSignOAuth, type MarketRentProvider, type PropertyDataProvider, type SigningProvider, type SigningWebhook } from '@pactlab/connectors';
import { VentureModule } from './venture/venture.module';
import { AdminModule } from './admin/admin.module';
import { SourceHealthModule } from './sources/source-health.module';
import { ForesightModule } from './foresight/foresight.module';
import { EngineeringModule } from './engineering/engineering.module';
import { ComparablesModule } from './comparables/comparables.module';
import { CompositeIdentityVerifier, type IdentityVerifier } from './auth/identity';
import { PACTLAB_TOKEN_ISSUER, PactlabTokens } from './auth/pactlab-token';
import { DealsModule } from './deals/deals.module';
import { DocumentsModule, type DocumentsModuleDependencies } from './documents/documents.module';
import { EmailLoginModule } from './email-login/email-login.module';
import { SignupModule } from './signup/signup.module';
import { UnavailableEmailSender, type EmailSender } from './email-login/email-sender';
import type { WebAuthnRelyingParty } from './email-login/passkeys.service';
import { PrismaDocumentsRepository } from './documents/prisma-documents.repository';
import { UnavailableMalwareScanner, UnavailableObjectStore } from './documents/storage-adapters';
import { FindingsModule } from './findings/findings.module';
import { PrismaFindingsRepository } from './findings/prisma-findings.repository';
import { HealthController } from './health/health.controller';
import { ReleaseInfo } from './health/release-info';
import { MeModule } from './me/me.module';
import { OrganizationModule } from './organization/organization.module';
import { ImportsModule, type ImportsModuleDependencies } from './imports/imports.module';
import { UnavailableUploadStore } from './imports/upload-store';
import { MarketRentsModule } from './market-rents/market-rents.module';
import { MetricsModule } from './metrics/metrics.module';
import { PactsModule } from './pacts/pacts.module';
import { PrismaValuationRepository } from './valuation/prisma-valuation.repository';
import { ValuationModule } from './valuation/valuation.module';
import { API_TOKENS, IDENTITY_VERIFIER, LOGGER, PACK_RELEASE, PRISMA } from './tokens';
import { PROVIDER_DEPENDENCIES, providerDependencies, type ProviderSettings } from './connections/provider-dependencies';
import type { PackRegistry } from './findings/pack-rules';
import { FixtureMacroForecastProvider, type MacroForecastProvider } from '@pactlab/connectors';
import { SaleModule } from './sale/sale.module';
import { RegulatoryModule } from './regulatory/regulatory.module';
import { DealDeletionModule } from './deals/deletion/deal-deletion.module';
import { InvitationsModule } from './invitations/invitations.module';
import { FinancingModule } from './financing/financing.module';
import { ReportsModule } from './reports/reports.module';
import { QoeModule } from './qoe/qoe.module';
import { SyndicationModule } from './syndication/syndication.module';
import { MusicModule } from './music/music.module';
import { EnergyModule } from './energy/energy.module';
import { FintechModule } from './fintech/fintech.module';
import { HealthcareModule } from './healthcare/healthcare.module';
import { ClinicsModule } from './clinics/clinics.module';
import { PharmaModule } from './pharma/pharma.module';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { ProfessionalServicesModule } from './professional-services/professional-services.module';
import { TelecomModule } from './telecom/telecom.module';
import { SpvModule } from './spv/spv.module';
import { BrandModule } from './brand/brand.module';
import { FeatureCardsModule } from './feature-cards/feature-cards.module';
import { EmailEventsModule } from './email-events/email-events.module';
import type { SnsVerifier } from './email-events/sns';
import { HttpsWebFetcher, type WebFetcher } from './common/safe-fetch';
import { IcModule } from './ic/ic.module';
import { BillingModule } from './billing/billing.module';
import { FixtureBillingProvider, type BillingProvider } from '@pactlab/connectors';
import { McpModule } from './mcp/mcp.module';
import type { CostSource } from './admin/cost/cost-explorer';
import { AgentProposalsModule } from './agent-proposals/agent-proposals.module';
import { ApiAccessTokens, McpAccessTokens } from './oauth/access-tokens';
import { HttpsClientMetadataFetcher, type ClientMetadataFetcher } from './oauth/client-metadata';
import { OAuthModule } from './oauth/oauth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DatabaseSuppressionList } from './email-events/email-events.service';

export interface AppDependencies {
  /** Real AWS spend for the hosting-cost console: Cost Explorer in the payer account (live only). */
  hostingCost?: { source?: CostSource | null; now?: () => Date };
  prisma: PrismaClient;
  identityVerifier: IdentityVerifier;
  logger: Logger;
  /** Which release the services run (T-100); omitted: a local release (APP_VERSION, commit "local"). */
  release?: ReleaseInfo;
  /**
   * Document storage, scanning and model access. Omitted adapters fail
   * closed: uploads are rejected and AI calls report NOT_CONFIGURED.
   */
  documents?: Partial<Omit<DocumentsModuleDependencies, 'repository'>>;
  /** What `GET /v1/ai/status` reports; describes `documents.gateway`. Omitted: AI off. */
  aiStatus?: AiStatusView;
  /** AI models in the admin console (T-131): the route resolver and evaluator; null where AI is off. */
  aiModels?: AiModelsRuntime | null;
  /**
   * Live provider access: credential store, Pactlab's GitHub App, HTTP client.
   * Omitted: no stored credentials and no App, so live connections fail closed.
   */
  providers?: ProviderSettings;
  /** Billing export storage and scanning. Omitted adapters fail closed: uploads are rejected. */
  uploads?: Partial<ImportsModuleDependencies>;
  /**
   * Email one-time-code sign-in. Omitted: Pactlab-issued tokens are rejected
   * and the /v1/auth endpoints are not mounted. Without a sender, codes are
   * never delivered.
   */
  emailLogin?: { tokenSecret: string; emailSender?: EmailSender; webauthn?: WebAuthnRelyingParty };
  /** SES delivery events (T-109): the SNS topic's verifier; absent, the endpoint refuses every message. */
  emailEvents?: { verifier: SnsVerifier | null };
  /**
   * E-signature (T-107). `docusign`: Pactlab's app registration, which organizations connect
   * their own DocuSign accounts to. `fixture`: the fixture provider, outside production only.
   */
  signing?: {
    fixture: boolean;
    docusign: { oauth: DocuSignOAuth; connectHmacKey: string; redirectUri: string } | null;
    /** Pactlab's BoldSign account (T-136): the adapter and, once registered, its webhook. */
    boldsign?: { provider: SigningProvider; webhook: SigningWebhook | null } | null;
    /** What Pactlab signing sends with. Default: BoldSign when configured, else the fixture when on. */
    pactlab?: 'BOLDSIGN' | 'FIXTURE' | null;
    /** Until the production go: the only recipients envelopes may go to (addresses or `@domain`s). */
    testRecipients?: readonly string[] | null;
    /** How often the polling fallback asks about an open envelope (default one minute). */
    pollIntervalMs?: number;
  };
  /** Property data for teaser pages (batch 2): RentCast with a key; the fixture outside production; null hides the lookup. */
  property?: PropertyDataProvider | null;
  /** Market rents for a rent roll (T-158): RentCast with its key; the fixture outside production; null turns the check off. */
  marketRents?: MarketRentProvider | null;
  /**
   * Billing (T-087): the provider (Stripe with a key; otherwise the fixture outside production),
   * whether pact creation is gated (BILLING_ENFORCEMENT, default off) and Stripe Tax.
   */
  billing?: { provider?: BillingProvider; enforce?: boolean; automaticTax?: boolean };
  /**
   * Self-serve sign-up (needs `emailLogin` for the hash secret and sender).
   * Defaults: approval required, no operator email.
   */
  signup?: { requiresApproval?: boolean; operatorEmail?: string | null; loginUrl: string };
  /** Shown to operators so they always know which environment the console is looking at. */
  environment?: string;
  /** Whether unreleased packs may be started (default: yes, as in local runs and tests). */
  packPreview?: boolean;
  appVersion?: string;
  /** Foresight voice (Amazon Transcribe and Polly). Omitted: voice is unavailable; typing works. */
  voice?: { speechToText: SpeechToText; textToSpeech: TextToSpeech };
  /** Published macro forecasts for Foresight (T-094 B10). Omitted: invented fixture series (tests). */
  macroForecasts?: MacroForecastProvider;
  /** Live checks the public data it uses (T-137 follow-up); off unless set (tests, fixture data). */
  sourceChecks?: { intervalHours: number; operatorEmail: string | null };
  /** Fetches company websites for brand kits (T-123); tests inject a fixture server. */
  webFetcher?: WebFetcher;
  /** Refresh Foresight forecasts in the background when the tab is opened. Default on. */
  foresightAutoBaseline?: boolean;
  /**
   * The MCP server and its OAuth (T-084): the issuer (the web origin, where the consent page and
   * metadata live) and the MCP server's canonical URI. Omitted: neither is mounted.
   */
  mcp?: { issuer: string; resource: string; clientMetadata?: ClientMetadataFetcher };
  /**
   * Pact activity notifications (T-145): run the email dispatcher on a timer in this process (deployed and
   * local runs). Omitted (tests): the inbox works and nothing is sent until the dispatcher is run directly.
   */
  notifications?: { dispatch: boolean; intervalMs?: number };
  /** Pack and finding-rule registries. Omitted: the domain registries (tests inject a test-only rule). */
  packs?: PackRegistry;
}

/** The passkey relying party for a web origin: its host, unless configured otherwise. */
export function relyingParty(origin: string, rpId?: string): WebAuthnRelyingParty {
  return { rpId: rpId ?? new URL(origin).hostname, rpName: 'Pactlab', origin: new URL(origin).origin };
}

@Global()
@Module({})
class InfrastructureModule {
  static register(deps: AppDependencies, identityVerifier: IdentityVerifier, apiTokens: ApiAccessTokens | null): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: API_TOKENS, useValue: apiTokens },
        { provide: PRISMA, useValue: deps.prisma },
        { provide: IDENTITY_VERIFIER, useValue: identityVerifier },
        { provide: LOGGER, useValue: deps.logger },
        { provide: PACK_RELEASE, useValue: { preview: deps.packPreview ?? true } },
        { provide: PROVIDER_DEPENDENCIES, useValue: providerDependencies({ ...deps.providers, ...(deps.emailLogin?.tokenSecret ? { stateSecret: deps.emailLogin.tokenSecret } : {}) }) },
      ],
      exports: [PRISMA, IDENTITY_VERIFIER, API_TOKENS, LOGGER, PACK_RELEASE, PROVIDER_DEPENDENCIES],
    };
  }
}

@Module({})
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    const findings = new PrismaFindingsRepository(deps.prisma);
    const valuation = new PrismaValuationRepository(deps.prisma);
    const tokens = deps.emailLogin ? new PactlabTokens(deps.emailLogin.tokenSecret, deps.prisma) : null;
    // Each token goes to the verifier of its issuer; an organization accepts only its own method.
    const identityVerifier = new CompositeIdentityVerifier({
      auth0: deps.identityVerifier,
      pactlab: tokens,
      pactlabIssuer: PACTLAB_TOKEN_ISSUER,
    });
    const invitations = InvitationsModule.register({
      emailSender: deps.emailLogin?.emailSender ?? new UnavailableEmailSender(),
      appOrigin: deps.signup?.loginUrl ? new URL(deps.signup.loginUrl).origin : 'http://localhost:3000',
    });
    // Built once: the MCP server (T-084) shares these instances with the REST API.
    const foresightModule = ForesightModule.register({
      gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway(),
      aiEnabled: deps.aiStatus?.enabled ?? false,
      speechToText: deps.voice?.speechToText ?? NO_SPEECH_TO_TEXT,
      textToSpeech: deps.voice?.textToSpeech ?? NO_TEXT_TO_SPEECH,
      macroForecasts: deps.macroForecasts ?? new FixtureMacroForecastProvider(),
      autoBaseline: deps.foresightAutoBaseline ?? true,
    });
    const documentsModule = DocumentsModule.register({
      repository: new PrismaDocumentsRepository(deps.prisma),
      objectStore: deps.documents?.objectStore ?? new UnavailableObjectStore(),
      malwareScanner: deps.documents?.malwareScanner ?? new UnavailableMalwareScanner(),
      gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway(),
      ...(deps.documents?.contextBudgetChars !== undefined ? { contextBudgetChars: deps.documents.contextBudgetChars } : {}),
    });
    const valuationModule = ValuationModule.register({ valuation, findings, pricing: { gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway() } });
    // Reports (T-110), shared with the investment committee (T-118): an IC pack is a report.
    // Buyer financing (T-117): shared with reports, which show it as the reader may see it.
    const financingModule = FinancingModule.register({ objectStore: deps.documents?.objectStore ?? new UnavailableObjectStore(), scanner: deps.documents?.malwareScanner ?? new UnavailableMalwareScanner() });
    // Quality of earnings (T-135): its peg goes onto the draft terms; reports carry its section.
    const qoeModule = QoeModule.register({ valuation: valuationModule });
    const reportsModule = ReportsModule.register({ store: deps.documents?.objectStore ?? new UnavailableObjectStore(), shared: [valuationModule, documentsModule, financingModule, qoeModule] });
    // Suggestions from connected AI apps, decided in the app (T-084b).
    const agentProposalsModule = AgentProposalsModule.register({ valuation: valuationModule, documents: documentsModule });
    // Pactlab's OAuth server for the MCP server (T-084) and the REST API (T-128), with Pactlab sign-in only.
    // The API is the MCP server's parent path: `<origin>/v1`.
    const apiTokens = deps.emailLogin && deps.mcp ? new ApiAccessTokens(deps.emailLogin.tokenSecret, deps.mcp.issuer, deps.mcp.resource.replace(/\/mcp$/, '')) : null;
    const oauthModule =
      deps.emailLogin && deps.mcp && apiTokens
        ? OAuthModule.register({
            accessTokens: new McpAccessTokens(deps.emailLogin.tokenSecret, deps.mcp.issuer, deps.mcp.resource),
            apiTokens,
            clientMetadata: deps.mcp.clientMetadata ?? new HttpsClientMetadataFetcher(),
            hashSecret: deps.emailLogin.tokenSecret,
          })
        : null;
    // Billing (T-087): registered globally so pact creation and sign-up can use it.
    const webOrigin = deps.signup?.loginUrl ? new URL(deps.signup.loginUrl).origin : 'http://localhost:3000';
    const billingModule = BillingModule.register({
      provider: deps.billing?.provider ?? new FixtureBillingProvider(randomBytes(24).toString('hex'), `${webOrigin}/billing/fixture-checkout`),
      enforce: deps.billing?.enforce ?? false,
      automaticTax: deps.billing?.automaticTax ?? false,
      appOrigin: webOrigin,
      hashSecret: deps.emailLogin?.tokenSecret ?? randomBytes(32).toString('hex'),
    });
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(deps, identityVerifier, apiTokens),
        billingModule,
        DealsModule,
        MeModule,
        MetricsModule,
        // Market rents (T-158); the fixture unless an environment says otherwise.
        MarketRentsModule.register(deps.marketRents === undefined ? new FixtureMarketRentProvider() : deps.marketRents),
        PactsModule,
        BalanceSheetModule,
        PhasesModule,
        CloseModule.register({
          fixtureSigning: deps.signing?.fixture === false ? null : new FixtureSigningProvider(),
          docusign: deps.signing?.docusign ?? null,
          boldsign: deps.signing?.boldsign ?? null,
          pactlabSigning: deps.signing?.pactlab !== undefined ? deps.signing.pactlab : deps.signing?.boldsign ? 'BOLDSIGN' : deps.signing?.fixture === false ? null : 'FIXTURE',
          testRecipients: deps.signing?.testRecipients ?? null,
          appOrigin: webOrigin,
          pollIntervalMs: deps.signing?.pollIntervalMs ?? 60_000,
          secrets: deps.providers?.secrets ?? null,
          stateSecret: deps.emailLogin?.tokenSecret ?? 'signing-state-unconfigured',
          documents: deps.documents?.objectStore ?? new UnavailableObjectStore(),
        }),
        VentureModule,
        foresightModule,
        SourceHealthModule.register({
          macroForecasts: deps.macroForecasts ?? new FixtureMacroForecastProvider(),
          emailSender: deps.emailLogin?.emailSender ?? null,
          operatorEmail: deps.sourceChecks?.operatorEmail ?? null,
          environment: deps.environment ?? 'local',
          scheduled: deps.sourceChecks !== undefined,
          intervalHours: deps.sourceChecks?.intervalHours ?? 6,
        }),
        AdminModule.register({
          emailSender: deps.emailLogin?.emailSender ?? null,
          loginUrl: deps.signup?.loginUrl ?? 'http://localhost:3000/login',
          appVersion: deps.appVersion ?? process.env['npm_package_version'] ?? '0.0.0',
          environment: deps.environment ?? 'local',
          linkSealSecret: deps.emailLogin?.tokenSecret ?? null,
        }, {
          source: deps.hostingCost?.source ?? null,
          // The pactlab:environment tag the stacks carry: APP_ENV, except production is "prod".
          environment: deps.environment === 'production' ? 'prod' : (deps.environment ?? 'local'),
          ...(deps.hostingCost?.now ? { now: deps.hostingCost.now } : {}),
        }, deps.aiModels ?? null),
        EngineeringModule,
        AuditModule,
        OrganizationModule,
        AiModule.register(deps.aiStatus ?? AI_OFF, deps.aiModels ?? null),
        ImportsModule.register({
          objectStore: deps.uploads?.objectStore ?? new UnavailableUploadStore(),
          malwareScanner: deps.uploads?.malwareScanner ?? new UnavailableMalwareScanner(),
          importQueue: deps.uploads?.importQueue ?? null,
          // The mapping assistant for files not in the standard template; off, names are matched only.
          gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway(),
          documentStore: deps.documents?.objectStore ?? null,
        }),
        FindingsModule.register(findings, deps.packs),
        valuationModule,
        ComparablesModule.register({ valuation, findings }),
        documentsModule,
        // Reports (T-110): the same service instances the app reads through.
        qoeModule,
        // Multifamily syndication (T-106): offering extraction runs through the documents module.
        SyndicationModule.register({ documents: documentsModule }),
        // Music rights (T-140): register extraction runs through the documents module.
        MusicModule.register({ documents: documentsModule }),
        // Energy generation & rights (T-142): report extraction runs through the documents module.
        EnergyModule.register({ documents: documentsModule }),
        // Fintech (T-159): the read-only Payments page; its checks run through Findings.
        FintechModule,
        // Healthcare services (T-160): the read-only Practice page; its checks run through Findings.
        HealthcareModule,
        // Small clinics (T-161): the read-only Clinic page; its checks run through Findings.
        ClinicsModule,
        // Pharma & biotech (T-163): the read-only Pipeline page; its checks run through Findings.
        PharmaModule,
        // E-commerce and DTC (T-164): the read-only Channels page; its checks run through Findings.
        EcommerceModule,
        // IT and professional services (T-167): the read-only Practice page; its checks run through Findings.
        ProfessionalServicesModule,
        // Telecom and media (T-168): the read-only Subscribers page; its checks run through Findings.
        TelecomModule,
        // Startup equity SPV (T-141): investors are invited to their seats through the invitations module.
        SpvModule.register(invitations),
        reportsModule,
        IcModule.register({ reports: reportsModule }),
        BrandModule.register({ store: deps.documents?.objectStore ?? new UnavailableObjectStore(), fetcher: deps.webFetcher ?? new HttpsWebFetcher() }),
        FeatureCardsModule,
        NotificationsModule.register({
          emailSender: deps.emailLogin?.emailSender ?? null,
          suppression: deps.emailLogin?.tokenSecret ? new DatabaseSuppressionList(deps.prisma, deps.emailLogin.tokenSecret) : null,
          appOrigin: webOrigin,
          scheduled: deps.notifications?.dispatch ?? false,
          intervalMs: deps.notifications?.intervalMs ?? 60_000,
        }),
        EmailEventsModule.register({ verifier: deps.emailEvents?.verifier ?? null, fetcher: deps.webFetcher ?? new HttpsWebFetcher(), hashSecret: deps.emailLogin?.tokenSecret ?? randomBytes(32).toString('hex') }),
        ...(tokens && deps.emailLogin
          ? [
              EmailLoginModule.register({
                tokens,
                emailSender: deps.emailLogin.emailSender ?? new UnavailableEmailSender(),
                hashSecret: deps.emailLogin.tokenSecret,
                // Passkeys are bound to the web host (T-108); tests and local runs use the sign-in page's origin.
                webauthn: deps.emailLogin.webauthn ?? relyingParty(deps.signup?.loginUrl ? new URL(deps.signup.loginUrl).origin : 'http://localhost:3000'),
              }),
            ]
          : []),
        invitations,
        RegulatoryModule,
        financingModule,
        SaleModule.register(
          invitations,
          {
            objectStore: deps.documents?.objectStore ?? new UnavailableObjectStore(),
            scanner: deps.documents?.malwareScanner ?? new UnavailableMalwareScanner(),
          },
          {
            emailSender: deps.emailLogin?.emailSender ?? new UnavailableEmailSender(),
            appOrigin: deps.signup?.loginUrl ? new URL(deps.signup.loginUrl).origin : 'http://localhost:3000',
            // Without the token secret (some tests), a per-process key: rate limits then hold within one process.
            hashSecret: deps.emailLogin?.tokenSecret ?? randomBytes(32).toString('hex'),
            // Property data for teaser pages (batch 2); the fixture unless an environment says otherwise.
            property: deps.property === undefined ? new FixturePropertyProvider() : deps.property,
          },
        ),
        DealDeletionModule.register({
          documents: deps.documents?.objectStore ?? new UnavailableObjectStore(),
          uploads: deps.uploads?.objectStore ?? new UnavailableUploadStore(),
        }),
        ...(tokens && deps.emailLogin && deps.signup
          ? [
              SignupModule.register({
                emailSender: deps.emailLogin.emailSender ?? new UnavailableEmailSender(),
                hashSecret: deps.emailLogin.tokenSecret,
                requiresApproval: deps.signup.requiresApproval ?? true,
                operatorEmail: deps.signup.operatorEmail ?? null,
                loginUrl: deps.signup.loginUrl,
                tokens,
              }),
            ]
          : []),
        agentProposalsModule,
        ...(oauthModule ? [oauthModule, McpModule.register({ oauth: oauthModule, valuation: valuationModule, foresight: foresightModule, documents: documentsModule, agentProposals: agentProposalsModule })] : []),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: ReleaseInfo, useValue: deps.release ?? new ReleaseInfo(null) }],
    };
  }
}
