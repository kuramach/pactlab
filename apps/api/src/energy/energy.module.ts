import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { EnergyController } from './energy.controller';
import { EnergyService } from './energy.service';

/**
 * Energy generation & rights (T-142). Given the app's documents module, so report extraction runs through the
 * same gateway, page sources and AI-run records as every document; findings are global.
 */
@Module({})
export class EnergyModule {
  static register(shared: { documents: DynamicModule }): DynamicModule {
    return {
      module: EnergyModule,
      imports: [shared.documents],
      controllers: [EnergyController],
      providers: [EnergyService, DealAccess],
    };
  }
}
