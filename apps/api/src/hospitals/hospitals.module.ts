import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';

/** Hospitals (T-162): the read-only Hospital page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [HospitalsController],
  providers: [HospitalsService, DealAccess],
})
export class HospitalsModule {}
