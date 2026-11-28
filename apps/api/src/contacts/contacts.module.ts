import { Module, type DynamicModule } from '@nestjs/common';
import { ChatAppsController, ChatWebhooksController, MyChatController } from './chat.controller';
import { CHAT_SETTINGS, ChatService, type ChatModuleSettings } from './chat.service';
import { ContactsController, ContactWebhooksController, OrganizationContactsController } from './contacts.controller';
import { CONTACT_SETTINGS, ContactsService, type ContactModuleSettings } from './contacts.service';

/** Contact details in the profile (T-180, ADR 0064): verified email, Telegram and WhatsApp; Slack and Teams (T-181, ADR 0065). */
@Module({})
export class ContactsModule {
  static register(settings: ContactModuleSettings, chat: ChatModuleSettings): DynamicModule {
    return {
      module: ContactsModule,
      controllers: [ContactsController, OrganizationContactsController, ContactWebhooksController, ChatAppsController, MyChatController, ChatWebhooksController],
      providers: [ContactsService, ChatService, { provide: CONTACT_SETTINGS, useValue: settings }, { provide: CHAT_SETTINGS, useValue: chat }],
      exports: [ContactsService, ChatService],
    };
  }
}
