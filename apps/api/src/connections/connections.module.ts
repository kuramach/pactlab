import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ConnectionsController, GitHubAppController, McpEvidenceServersController, SyntheticSourcesController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  controllers: [ConnectionsController, GitHubAppController, McpEvidenceServersController, SyntheticSourcesController],
  providers: [ConnectionsService, DealAccess],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
