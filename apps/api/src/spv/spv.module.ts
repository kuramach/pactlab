import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { SpvController } from './spv.controller';
import { SpvService } from './spv.service';

/** Startup equity SPV (T-141). Shares the app's invitations module for investor invitations; findings are global. */
@Module({})
export class SpvModule {
  static register(invitations: DynamicModule): DynamicModule {
    return { module: SpvModule, imports: [invitations], controllers: [SpvController], providers: [SpvService, DealAccess] };
  }
}
