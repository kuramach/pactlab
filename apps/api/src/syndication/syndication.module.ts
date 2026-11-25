import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { SyndicationController } from './syndication.controller';
import { SyndicationService } from './syndication.service';

/**
 * Multifamily syndication (T-106). Given the app's documents module, so offering extraction runs
 * through the same gateway, page sources and AI-run records as every document; findings are global.
 */
@Module({})
export class SyndicationModule {
  static register(shared: { documents: DynamicModule }): DynamicModule {
    return {
      module: SyndicationModule,
      imports: [shared.documents],
      controllers: [SyndicationController],
      providers: [SyndicationService, DealAccess],
    };
  }
}
