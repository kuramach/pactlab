import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { DealAccess } from './deal-access';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

/** Connections, sync runs and evidence are deal sub-resources and compose under this module. */
@Module({
  imports: [ConnectionsModule, EvidenceModule],
  controllers: [DealsController],
  providers: [DealsService, DealAccess],
})
export class DealsModule {}
