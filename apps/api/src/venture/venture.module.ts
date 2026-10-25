import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { VentureController } from './venture.controller';
import { VentureService } from './venture.service';

@Module({
  controllers: [VentureController],
  providers: [VentureService, DealAccess],
})
export class VentureModule {}
