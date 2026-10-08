import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NotConfiguredClaudeGateway } from '@pactlab/ai';
import type { PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { AuthGuard } from './auth/auth.guard';
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
import { ImportsModule, type ImportsModuleDependencies } from './imports/imports.module';
import { UnavailableUploadStore } from './imports/upload-store';
import { MetricsModule } from './metrics/metrics.module';
import { PactsModule } from './pacts/pacts.module';
import { PrismaValuationRepository } from './valuation/prisma-valuation.repository';
import { ValuationModule } from './valuation/valuation.module';
import { IDENTITY_VERIFIER, LOGGER, PRISMA } from './tokens';

export interface AppDependencies {
  prisma: PrismaClient;
  identityVerifier: IdentityVerifier;
  logger: Logger;
  /**
   * Document storage, scanning and model access. Omitted adapters fail
   * closed: uploads are rejected and AI calls report NOT_CONFIGURED.
   */
  documents?: Partial<Omit<DocumentsModuleDependencies, 'repository'>>;
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
      ],
      exports: [PRISMA, IDENTITY_VERIFIER, LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    const findings = new PrismaFindingsRepository(deps.prisma);
    const tokens = deps.emailLogin ? new PactlabTokens(deps.emailLogin.tokenSecret, deps.prisma) : null;
    // Each token goes to the verifier of its issuer; an organization accepts only its own method.
    const identityVerifier = new CompositeIdentityVerifier({
      auth0: deps.identityVerifier,
      pactlab: tokens,
      pactlabIssuer: PACTLAB_TOKEN_ISSUER,
    });
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(deps, identityVerifier),
        DealsModule,
        MeModule,
        MetricsModule,
        PactsModule,
        ImportsModule.register({
          objectStore: deps.uploads?.objectStore ?? new UnavailableUploadStore(),
          malwareScanner: deps.uploads?.malwareScanner ?? new UnavailableMalwareScanner(),
        }),
        FindingsModule.register(findings),
        ValuationModule.register({
          valuation: new PrismaValuationRepository(deps.prisma),
          findings,
        }),
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
