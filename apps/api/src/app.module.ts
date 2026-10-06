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
import { UnavailableEmailSender, type EmailSender } from './email-login/email-sender';
import { PrismaDocumentsRepository } from './documents/prisma-documents.repository';
import { UnavailableMalwareScanner, UnavailableObjectStore } from './documents/storage-adapters';
import { FindingsModule } from './findings/findings.module';
import { PrismaFindingsRepository } from './findings/prisma-findings.repository';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { MetricsModule } from './metrics/metrics.module';
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
  /**
   * Email one-time-code sign-in. Omitted: Pactlab-issued tokens are rejected
   * and the /v1/auth endpoints are not mounted. Without a sender, codes are
   * never delivered.
   */
  emailLogin?: { tokenSecret: string; emailSender?: EmailSender };
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
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
