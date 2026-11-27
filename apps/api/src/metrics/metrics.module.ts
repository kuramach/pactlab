import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, DealAccess],
  // Deal Criticals (T-179) rate pack metrics through the same service.
  exports: [MetricsService],
})
export class MetricsModule {}
