import { Module, type DynamicModule } from '@nestjs/common';
import type { ClaudeGateway } from '@pactlab/ai';
import { DealAccess } from '../deals/deal-access';
import { MetricsModule } from '../metrics/metrics.module';
import { CriticalsController, CriticalsLibraryController } from './criticals.controller';
import { CriticalsService } from './criticals.service';
import { CRITICALS_GATEWAY } from './criticals.tokens';

/**
 * Deal Criticals (T-179, ADR 0060): the org library and each pact's panel. Ratings read the pack
 * metrics through MetricsService and raise findings through the global FindingsService; the AI
 * gateway proposes structures from words and reads document metrics.
 */
@Module({})
export class CriticalsModule {
  static register(deps: { gateway: ClaudeGateway }): DynamicModule {
    return {
      module: CriticalsModule,
      imports: [MetricsModule],
      controllers: [CriticalsLibraryController, CriticalsController],
      providers: [CriticalsService, DealAccess, { provide: CRITICALS_GATEWAY, useValue: deps.gateway }],
      exports: [CriticalsService],
    };
  }
}
