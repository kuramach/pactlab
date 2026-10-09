import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ConnectionsController, GitHubAppController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  controllers: [ConnectionsController, GitHubAppController],
  providers: [ConnectionsService, DealAccess],
})
export class ConnectionsModule {}
