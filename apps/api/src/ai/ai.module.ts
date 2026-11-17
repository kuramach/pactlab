import { Module, type DynamicModule } from '@nestjs/common';
import type { AiModelsRuntime, AiStatusView } from './ai-provider';
import { AI_ROUTES, AI_STATUS, AiController } from './ai.controller';

@Module({})
export class AiModule {
  static register(status: AiStatusView, models: AiModelsRuntime | null = null): DynamicModule {
    return { module: AiModule, controllers: [AiController], providers: [{ provide: AI_STATUS, useValue: status }, { provide: AI_ROUTES, useValue: models }] };
  }
}
