import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { HealthcareController } from './healthcare.controller';
import { HealthcareService } from './healthcare.service';

/** Healthcare services (T-160): the read-only Practice page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [HealthcareController],
  providers: [HealthcareService, DealAccess],
})
export class HealthcareModule {}
