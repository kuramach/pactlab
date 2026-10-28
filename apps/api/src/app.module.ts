import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NO_SPEECH_TO_TEXT, NO_TEXT_TO_SPEECH, NotConfiguredClaudeGateway, type SpeechToText, type TextToSpeech } from '@pactlab/ai';
import type { PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AI_OFF, type AiStatusView } from './ai/ai-provider';
import { AiModule } from './ai/ai.module';
import { BalanceSheetModule } from './balance-sheet/balance-sheet.module';
import { PhasesModule } from './phases/phases.module';
import { VentureModule } from './venture/venture.module';
import { AdminModule } from './admin/admin.module';
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
import { PrismaDocumentsRepository } from './documents/prisma-documents.repository';
import { UnavailableMalwareScanner, UnavailableObjectStore } from './documents/storage-adapters';
import { FindingsModule } from './findings/findings.module';
import { PrismaFindingsRepository } from './findings/prisma-findings.repository';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { OrganizationModule } from './organization/organization.module';
import { ImportsModule, type ImportsModuleDependencies } from './imports/imports.module';
import { UnavailableUploadStore } from './imports/upload-store';
import { MetricsModule } from './metrics/metrics.module';
import { PactsModule } from './pacts/pacts.module';
import { PrismaValuationRepository } from './valuation/prisma-valuation.repository';
import { ValuationModule } from './valuation/valuation.module';
import { IDENTITY_VERIFIER, LOGGER, PRISMA } from './tokens';
import { PROVIDER_DEPENDENCIES, providerDependencies, type ProviderSettings } from './connections/provider-dependencies';
import type { PackRegistry } from './findings/pack-rules';
import { FixtureMacroForecastProvider, type MacroForecastProvider } from '@pactlab/connectors';
import { SaleModule } from './sale/sale.module';
import { DealDeletionModule } from './deals/deletion/deal-deletion.module';
import { InvitationsModule } from './invitations/invitations.module';

export interface AppDependencies {
  prisma: PrismaClient;
  identityVerifier: IdentityVerifier;
  logger: Logger;
  /**
   * Document storage, scanning and model access. Omitted adapters fail
   * closed: uploads are rejected and AI calls report NOT_CONFIGURED.
   */
  documents?: Partial<Omit<DocumentsModuleDependencies, 'repository'>>;
  /** What `GET /v1/ai/status` reports; describes `documents.gateway`. Omitted: AI off. */
  aiStatus?: AiStatusView;
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
  emailLogin?: { tokenSecret: string; emailSender?: EmailSender };
  /**
   * Self-serve sign-up (needs `emailLogin` for the hash secret and sender).
   * Defaults: approval required, no operator email.
   */
  signup?: { requiresApproval?: boolean; operatorEmail?: string | null; loginUrl: string };
  /** Shown to operators so they always know which environment the console is looking at. */
  environment?: string;
  appVersion?: string;
  /** Foresight voice (Amazon Transcribe and Polly). Omitted: voice is unavailable; typing works. */
  voice?: { speechToText: SpeechToText; textToSpeech: TextToSpeech };
  /** Published macro forecasts for Foresight (T-094 B10). Omitted: invented fixture series (tests). */
  macroForecasts?: MacroForecastProvider;
  /** Refresh Foresight forecasts in the background when the tab is opened. Default on. */
  foresightAutoBaseline?: boolean;
  /** Pack and finding-rule registries. Omitted: the domain registries (tests inject a test-only rule). */
  packs?: PackRegistry;
}

@Global()
@Module({})
class InfrastructureModule {
  static register(deps: AppDependencies, identityVerifier: IdentityVerifier): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: PRISMA, useValue: deps.prisma },
        { provide: IDENTITY_VERIFIER, useValue: identityVerifier },
        { provide: LOGGER, useValue: deps.logger },
        { provide: PROVIDER_DEPENDENCIES, useValue: providerDependencies(deps.providers) },
      ],
      exports: [PRISMA, IDENTITY_VERIFIER, LOGGER, PROVIDER_DEPENDENCIES],
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
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(deps, identityVerifier),
        DealsModule,
        MeModule,
        MetricsModule,
        PactsModule,
        BalanceSheetModule,
        PhasesModule,
        VentureModule,
        ForesightModule.register({
          gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway(),
          aiEnabled: deps.aiStatus?.enabled ?? false,
          speechToText: deps.voice?.speechToText ?? NO_SPEECH_TO_TEXT,
          textToSpeech: deps.voice?.textToSpeech ?? NO_TEXT_TO_SPEECH,
          macroForecasts: deps.macroForecasts ?? new FixtureMacroForecastProvider(),
          autoBaseline: deps.foresightAutoBaseline ?? true,
        }),
        AdminModule.register({
          emailSender: deps.emailLogin?.emailSender ?? null,
          loginUrl: deps.signup?.loginUrl ?? 'http://localhost:3000/login',
          appVersion: deps.appVersion ?? process.env['npm_package_version'] ?? '0.0.0',
          environment: deps.environment ?? 'local',
        }),
        EngineeringModule,
        AuditModule,
        OrganizationModule,
        AiModule.register(deps.aiStatus ?? AI_OFF),
        ImportsModule.register({
          objectStore: deps.uploads?.objectStore ?? new UnavailableUploadStore(),
          malwareScanner: deps.uploads?.malwareScanner ?? new UnavailableMalwareScanner(),
          importQueue: deps.uploads?.importQueue ?? null,
        }),
        FindingsModule.register(findings, deps.packs),
        ValuationModule.register({ valuation, findings }),
        ComparablesModule.register({ valuation, findings }),
        DocumentsModule.register({
          repository: new PrismaDocumentsRepository(deps.prisma),
          objectStore: deps.documents?.objectStore ?? new UnavailableObjectStore(),
          malwareScanner: deps.documents?.malwareScanner ?? new UnavailableMalwareScanner(),
          gateway: deps.documents?.gateway ?? new NotConfiguredClaudeGateway(),
        }),
        ...(tokens && deps.emailLogin
          ? [
              EmailLoginModule.register({
                tokens,
                emailSender: deps.emailLogin.emailSender ?? new UnavailableEmailSender(),
                hashSecret: deps.emailLogin.tokenSecret,
              }),
            ]
          : []),
        invitations,
        SaleModule.register(invitations),
        DealDeletionModule.register({
          documents: deps.documents?.objectStore ?? new UnavailableObjectStore(),
          uploads: deps.uploads?.objectStore ?? new UnavailableUploadStore(),
        }),
        ...(deps.emailLogin && deps.signup
          ? [
              SignupModule.register({
                emailSender: deps.emailLogin.emailSender ?? new UnavailableEmailSender(),
                hashSecret: deps.emailLogin.tokenSecret,
                requiresApproval: deps.signup.requiresApproval ?? true,
                operatorEmail: deps.signup.operatorEmail ?? null,
                loginUrl: deps.signup.loginUrl,
              }),
            ]
          : []),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
