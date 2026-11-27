import { Module, type DynamicModule } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SUPPORT_CHAT, SupportChatService, type SupportChatDependencies } from './support-chat.service';

/** Product-help chat on the site and in the app (T-175). */
@Module({})
export class SupportChatModule {
  static register(deps: SupportChatDependencies): DynamicModule {
    return { module: SupportChatModule, controllers: [SupportChatController], providers: [{ provide: SUPPORT_CHAT, useValue: deps }, SupportChatService] };
  }
}
