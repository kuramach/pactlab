import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { AuthGuard } from './auth/auth.guard';
import type { IdentityVerifier } from './auth/identity';
import { DealsModule } from './deals/deals.module';
import { FindingsModule } from './findings/findings.module';
import { PrismaFindingsRepository } from './findings/prisma-findings.repository';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { MetricsModule } from './metrics/metrics.module';
import { IDENTITY_VERIFIER, LOGGER, PRISMA } from './tokens';

export interface AppDependencies {
  prisma: PrismaClient;
  identityVerifier: IdentityVerifier;
  logger: Logger;
}

@Global()
@Module({})
class InfrastructureModule {
  static register(deps: AppDependencies): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: PRISMA, useValue: deps.prisma },
        { provide: IDENTITY_VERIFIER, useValue: deps.identityVerifier },
        { provide: LOGGER, useValue: deps.logger },
      ],
      exports: [PRISMA, IDENTITY_VERIFIER, LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(deps),
        DealsModule,
        MeModule,
        MetricsModule,
        FindingsModule.register(new PrismaFindingsRepository(deps.prisma)),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
