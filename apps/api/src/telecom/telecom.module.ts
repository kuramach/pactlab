import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { TelecomController } from './telecom.controller';
import { TelecomService } from './telecom.service';

/** Telecom and media (T-168): the read-only Subscribers page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [TelecomController],
  providers: [TelecomService, DealAccess],
})
export class TelecomModule {}
