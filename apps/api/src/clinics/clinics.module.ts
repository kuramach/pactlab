import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ClinicsController } from './clinics.controller';
import { ClinicsService } from './clinics.service';

/** Small clinics (T-161): the read-only Clinic page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [ClinicsController],
  providers: [ClinicsService, DealAccess],
})
export class ClinicsModule {}
