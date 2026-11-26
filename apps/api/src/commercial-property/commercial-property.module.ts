import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { CommercialPropertyController } from './commercial-property.controller';
import { CommercialPropertyService } from './commercial-property.service';

/** Commercial property (T-165): the read-only Leases page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [CommercialPropertyController],
  providers: [CommercialPropertyService, DealAccess],
})
export class CommercialPropertyModule {}
