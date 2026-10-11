import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { VALUATION_REPOSITORY, type ValuationRepository } from '../valuation/valuation.repository';
import { ValuationService } from '../valuation/valuation.service';
import { ComparablesController } from './comparables.controller';
import { ComparablesService } from './comparables.service';

/** Comparables and multiple benchmarks; reads scenarios through the valuation service. */
@Module({})
export class ComparablesModule {
  static register(deps: { valuation: ValuationRepository; findings: FindingsRepository }): DynamicModule {
    return {
      module: ComparablesModule,
      controllers: [ComparablesController],
      providers: [
        ComparablesService,
        ValuationService,
        DealAccess,
        { provide: VALUATION_REPOSITORY, useValue: deps.valuation },
        { provide: FINDINGS_REPOSITORY, useValue: deps.findings },
      ],
      exports: [ComparablesService],
    };
  }
}
