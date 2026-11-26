import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FintechController } from './fintech.controller';
import { FintechService } from './fintech.service';

/** Fintech (T-159): the read-only Payments page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [FintechController],
  providers: [FintechService, DealAccess],
})
export class FintechModule {}
