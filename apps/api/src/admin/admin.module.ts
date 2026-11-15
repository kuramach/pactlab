import { Module, type DynamicModule } from '@nestjs/common';
import { AdminController, BugReportsController, OrganizationFlagsController } from './admin.controller';
import { ADMIN_SETTINGS, AdminService, type AdminSettings } from './admin.service';
import { HostingCostController } from './cost/hosting-cost.controller';
import { HOSTING_COST_SETTINGS, HostingCostService, type HostingCostSettings } from './cost/hosting-cost.service';

/** Operator console, bug reports and organization flags (T-072), and hosting cost. */
@Module({})
export class AdminModule {
  static register(settings: AdminSettings, cost: HostingCostSettings): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminController, BugReportsController, OrganizationFlagsController, HostingCostController],
      providers: [AdminService, { provide: ADMIN_SETTINGS, useValue: settings }, HostingCostService, { provide: HOSTING_COST_SETTINGS, useValue: cost }],
      exports: [AdminService],
    };
  }
}
