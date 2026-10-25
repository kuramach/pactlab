import { Module, type DynamicModule } from '@nestjs/common';
import { AdminController, BugReportsController, OrganizationFlagsController } from './admin.controller';
import { ADMIN_SETTINGS, AdminService, type AdminSettings } from './admin.service';

/** Operator console, bug reports and organization flags (T-072). */
@Module({})
export class AdminModule {
  static register(settings: AdminSettings): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminController, BugReportsController, OrganizationFlagsController],
      providers: [AdminService, { provide: ADMIN_SETTINGS, useValue: settings }],
      exports: [AdminService],
    };
  }
}
