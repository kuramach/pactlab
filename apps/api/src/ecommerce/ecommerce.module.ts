import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';

/** E-commerce and DTC (T-164): the read-only Channels page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [EcommerceController],
  providers: [EcommerceService, DealAccess],
})
export class EcommerceModule {}
