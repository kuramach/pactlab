import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FinancingController } from './financing.controller';
import { FINANCING_FILES, FinancingService, type FinancingFiles } from './financing.service';

/** Buyer financing (T-117, ADR 0033). */
@Module({})
export class FinancingModule {
  static register(files: FinancingFiles): DynamicModule {
    return { module: FinancingModule, controllers: [FinancingController], providers: [FinancingService, DealAccess, { provide: FINANCING_FILES, useValue: files }], exports: [FinancingService] };
  }
}
