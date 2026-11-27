import { Module, type DynamicModule } from '@nestjs/common';
import { PactPricingAdminController, PactPricingController } from './pact-pricing.controller';
import { PACT_PRICING, PactPricingService, type PactPricingDependencies } from './pact-pricing.service';

/** Pact pricing storage (T-177a): price books, pact promo codes and stored quotes. */
@Module({})
export class PactPricingModule {
  static register(deps: PactPricingDependencies): DynamicModule {
    return {
      module: PactPricingModule,
      controllers: [PactPricingController, PactPricingAdminController],
      providers: [PactPricingService, { provide: PACT_PRICING, useValue: deps }],
      exports: [PactPricingService],
    };
  }
}
