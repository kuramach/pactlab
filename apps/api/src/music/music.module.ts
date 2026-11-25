import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

/**
 * Music rights (T-140). Given the app's documents module, so register extraction runs through the
 * same gateway, page sources and AI-run records as every document; findings are global.
 */
@Module({})
export class MusicModule {
  static register(shared: { documents: DynamicModule }): DynamicModule {
    return {
      module: MusicModule,
      imports: [shared.documents],
      controllers: [MusicController],
      providers: [MusicService, DealAccess],
    };
  }
}
