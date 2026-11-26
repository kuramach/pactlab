import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { NotificationDispatcher, NOTIFICATION_SETTINGS, type NotificationModuleSettings } from './notification-dispatcher';
import { NotificationSettingsController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Pact activity notifications (T-145, ADR 0045): the inbox, settings and the email dispatcher. */
@Module({})
export class NotificationsModule {
  static register(settings: NotificationModuleSettings): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController, NotificationSettingsController],
      providers: [NotificationsService, NotificationDispatcher, DealAccess, { provide: NOTIFICATION_SETTINGS, useValue: settings }],
      exports: [NotificationDispatcher],
    };
  }
}
