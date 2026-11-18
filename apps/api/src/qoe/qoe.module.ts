import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { QoeController } from './qoe.controller';
import { QoeService } from './qoe.service';

/**
 * Quality of earnings (T-135). Given the app's own valuation module, so the peg goes onto the
 * draft terms through the same PricingService the Terms page uses; findings are global.
 */
@Module({})
export class QoeModule {
  static register(shared: { valuation: DynamicModule }): DynamicModule {
    return {
      module: QoeModule,
      imports: [shared.valuation],
      controllers: [QoeController],
      providers: [QoeService, DealAccess],
      exports: [QoeService],
    };
  }
}
