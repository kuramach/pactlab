import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';

@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService, DealAccess],
})
export class EvidenceModule {}
