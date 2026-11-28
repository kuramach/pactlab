import { Module, type DynamicModule } from '@nestjs/common';
import { ChatAppsController, ChatWebhooksController, MyChatController } from './chat.controller';
import { CHAT_SETTINGS, ChatService, type ChatModuleSettings } from './chat.service';
import { AdminLineController, ContactsController, ContactWebhooksController, OrganizationContactsController } from './contacts.controller';
import { CONTACT_SETTINGS, ContactsService, type ContactModuleSettings } from './contacts.service';
import { LineService } from './line.service';

/** Contact details in the profile (T-180, ADR 0064): verified email, Telegram and WhatsApp; Slack and Teams (T-181, ADR 0065); LINE (T-182, ADR 0066). */
@Module({})
export class ContactsModule {
  static register(settings: ContactModuleSettings, chat: ChatModuleSettings): DynamicModule {
    return {
      module: ContactsModule,
      controllers: [ContactsController, OrganizationContactsController, ContactWebhooksController, AdminLineController, ChatAppsController, MyChatController, ChatWebhooksController],
      providers: [ContactsService, ChatService, LineService, { provide: CONTACT_SETTINGS, useValue: settings }, { provide: CHAT_SETTINGS, useValue: chat }],
      exports: [ContactsService, ChatService, LineService],
    };
  }
}
