import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, DealAccess],
})
export class ConnectionsModule {}
