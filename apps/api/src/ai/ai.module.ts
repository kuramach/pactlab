import { Module, type DynamicModule } from '@nestjs/common';
import type { AiStatusView } from './ai-provider';
import { AI_STATUS, AiController } from './ai.controller';

@Module({})
export class AiModule {
  static register(status: AiStatusView): DynamicModule {
    return { module: AiModule, controllers: [AiController], providers: [{ provide: AI_STATUS, useValue: status }] };
  }
}
