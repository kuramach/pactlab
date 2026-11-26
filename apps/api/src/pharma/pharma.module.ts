import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { PharmaController } from './pharma.controller';
import { PharmaService } from './pharma.service';

/** Pharma and biotech (T-163): the read-only Pipeline page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [PharmaController],
  providers: [PharmaService, DealAccess],
})
export class PharmaModule {}
