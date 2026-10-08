import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { PactsController } from './pacts.controller';
import { PactsService } from './pacts.service';

@Module({
  controllers: [PactsController],
  providers: [PactsService, DealAccess],
})
export class PactsModule {}
