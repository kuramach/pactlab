import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ProfessionalServicesController } from './professional-services.controller';
import { ProfessionalServicesService } from './professional-services.service';

/** IT and professional services (T-167): the read-only Practice page; its checks are the pack's rules, run through Findings. */
@Module({
  controllers: [ProfessionalServicesController],
  providers: [ProfessionalServicesService, DealAccess],
})
export class ProfessionalServicesModule {}
