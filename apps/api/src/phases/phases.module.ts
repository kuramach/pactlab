import { Global, Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';

/** Global: closing a deal (DealsService) generates the post-close registers. */
@Global()
@Module({
  controllers: [PhasesController],
  providers: [PhasesService, DealAccess],
  exports: [PhasesService],
})
export class PhasesModule {}
