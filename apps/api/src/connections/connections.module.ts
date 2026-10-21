import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ConnectionsController, GitHubAppController, SyntheticSourcesController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  controllers: [ConnectionsController, GitHubAppController, SyntheticSourcesController],
  providers: [ConnectionsService, DealAccess],
})
export class ConnectionsModule {}
