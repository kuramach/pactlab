import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { ValuationController } from './valuation.controller';
import { VALUATION_REPOSITORY, type ValuationRepository } from './valuation.repository';
import { ValuationService } from './valuation.service';

/**
 * Valuation scenarios as deal sub-resources. Repositories are supplied by
 * the caller: the RLS-backed implementations need the valuation and
 * findings tables, which are a separate schema task.
 */
@Module({})
export class ValuationModule {
  static register(deps: {
    valuation: ValuationRepository;
    findings: FindingsRepository;
  }): DynamicModule {
    return {
      module: ValuationModule,
      controllers: [ValuationController],
      providers: [
        ValuationService,
        DealAccess,
        { provide: VALUATION_REPOSITORY, useValue: deps.valuation },
        { provide: FINDINGS_REPOSITORY, useValue: deps.findings },
      ],
      exports: [ValuationService],
    };
  }
}
