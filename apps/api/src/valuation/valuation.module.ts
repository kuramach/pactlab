import { Module, type DynamicModule } from '@nestjs/common';
import { PricingController, ProposedTermsController } from '../pricing/pricing.controller';
import { PRICING_DEPENDENCIES, PricingService, type PricingDependencies } from '../pricing/pricing.service';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { ValuationController } from './valuation.controller';
import { VALUATION_REPOSITORY, type ValuationRepository } from './valuation.repository';
import { ValuationService } from './valuation.service';

/**
 * Valuation scenarios as deal sub-resources. Repositories are supplied by
 * the caller: `AppModule` mounts the RLS-backed Prisma implementations.
 */
@Module({})
export class ValuationModule {
  static register(deps: {
    valuation: ValuationRepository;
    findings: FindingsRepository;
    /** Buyer personas (T-105) price through valuation and draft the brief through the AI gateway. */
    pricing: PricingDependencies;
  }): DynamicModule {
    return {
      module: ValuationModule,
      controllers: [ValuationController, PricingController, ProposedTermsController],
      providers: [
        ValuationService,
        PricingService,
        DealAccess,
        { provide: PRICING_DEPENDENCIES, useValue: deps.pricing },
        { provide: VALUATION_REPOSITORY, useValue: deps.valuation },
        { provide: FINDINGS_REPOSITORY, useValue: deps.findings },
      ],
      exports: [ValuationService, PricingService],
    };
  }
}
