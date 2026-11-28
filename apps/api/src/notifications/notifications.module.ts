import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { NotificationDispatcher, NOTIFICATION_SETTINGS, type NotificationModuleSettings } from './notification-dispatcher';
import { NotificationSettingsController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Pact activity notifications (T-145, ADR 0046): the inbox, settings and the email dispatcher; urgent alerts on channels and devices (T-146). */
@Module({})
export class NotificationsModule {
  static register(settings: NotificationModuleSettings): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController, NotificationSettingsController, AlertsController],
      providers: [NotificationsService, AlertsService, NotificationDispatcher, DealAccess, { provide: NOTIFICATION_SETTINGS, useValue: settings }],
      exports: [NotificationDispatcher],
    };
  }
}
