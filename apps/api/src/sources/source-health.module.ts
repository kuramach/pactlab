import { type DynamicModule, Module } from '@nestjs/common';
import { SourceHealthController } from './source-health.controller';
import { SOURCE_HEALTH_SETTINGS, SourceHealthService, type SourceHealthSettings } from './source-health.service';

@Module({})
export class SourceHealthModule {
  static register(settings: SourceHealthSettings): DynamicModule {
    return {
      module: SourceHealthModule,
      controllers: [SourceHealthController],
      providers: [SourceHealthService, { provide: SOURCE_HEALTH_SETTINGS, useValue: settings }],
      exports: [SourceHealthService],
    };
  }
}
