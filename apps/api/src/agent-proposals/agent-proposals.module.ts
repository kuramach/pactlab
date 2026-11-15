import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { AgentProposalsController } from './agent-proposals.controller';
import { AgentProposalsService } from './agent-proposals.service';

/**
 * Suggestions from connected AI apps (T-084b). Given the app's own valuation (pricing) and
 * documents module instances, so approval runs exactly the services the app's buttons run.
 */
@Module({})
export class AgentProposalsModule {
  static register(shared: { valuation: DynamicModule; documents: DynamicModule }): DynamicModule {
    return {
      module: AgentProposalsModule,
      imports: [shared.valuation, shared.documents],
      controllers: [AgentProposalsController],
      providers: [AgentProposalsService, DealAccess],
      exports: [AgentProposalsService],
    };
  }
}
