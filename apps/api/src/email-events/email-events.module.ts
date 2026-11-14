import { Module, type DynamicModule } from '@nestjs/common';
import { EmailEventsController } from './email-events.controller';
import { EMAIL_EVENTS_SETTINGS, EmailEventsService, type EmailEventsSettings } from './email-events.service';

/** SES delivery events and the do-not-send list (T-109, ADR 0032). */
@Module({})
export class EmailEventsModule {
  static register(settings: EmailEventsSettings): DynamicModule {
    return {
      module: EmailEventsModule,
      controllers: [EmailEventsController],
      providers: [EmailEventsService, { provide: EMAIL_EVENTS_SETTINGS, useValue: settings }],
      exports: [EmailEventsService],
    };
  }
}
