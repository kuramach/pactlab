import { Module, type DynamicModule } from '@nestjs/common';
import type { MarketRentProvider } from '@pactlab/connectors';
import { DealAccess } from '../deals/deal-access';
import { MarketRentsController } from './market-rents.controller';
import { MARKET_RENT_PROVIDER, MarketRentsService } from './market-rents.service';

/** Market rents for a rent roll (T-158): RentCast in live, the fixture elsewhere; null turns the retrieval off. */
@Module({})
export class MarketRentsModule {
  static register(provider: MarketRentProvider | null): DynamicModule {
    return {
      module: MarketRentsModule,
      controllers: [MarketRentsController],
      providers: [MarketRentsService, DealAccess, { provide: MARKET_RENT_PROVIDER, useValue: provider }],
    };
  }
}
