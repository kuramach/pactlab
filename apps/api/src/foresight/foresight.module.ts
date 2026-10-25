import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ForesightController } from './foresight.controller';
import { FORESIGHT_DEPENDENCIES, ForesightService, type ForesightDependencies } from './foresight.service';

/** Foresight (T-073). Shares the document-AI gateway; voice adapters fail closed when not configured. */
@Module({})
export class ForesightModule {
  static register(deps: ForesightDependencies): DynamicModule {
    return {
      module: ForesightModule,
      controllers: [ForesightController],
      providers: [ForesightService, DealAccess, { provide: FORESIGHT_DEPENDENCIES, useValue: deps }],
      exports: [ForesightService],
    };
  }
}
