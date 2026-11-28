import { Module, type DynamicModule } from '@nestjs/common';
import { ContactsController, ContactWebhooksController, LineAllowanceController, OrganizationContactsController } from './contacts.controller';
import { CONTACT_SETTINGS, ContactsService, type ContactModuleSettings } from './contacts.service';

/** Contact details in the profile (T-180, ADR 0064): verified email, Telegram, WhatsApp and LINE (T-182). */
@Module({})
export class ContactsModule {
  static register(settings: ContactModuleSettings): DynamicModule {
    return {
      module: ContactsModule,
      controllers: [ContactsController, OrganizationContactsController, LineAllowanceController, ContactWebhooksController],
      providers: [ContactsService, { provide: CONTACT_SETTINGS, useValue: settings }],
      exports: [ContactsService],
    };
  }
}
