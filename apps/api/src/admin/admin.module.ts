import { Module, type DynamicModule } from '@nestjs/common';
import { AdminController, BugReportsController, OrganizationFlagsController } from './admin.controller';
import { ADMIN_SETTINGS, AdminService, type AdminSettings } from './admin.service';
import type { AiModelsRuntime } from '../ai/ai-provider';
import { AiModelsController } from './ai-models/ai-models.controller';
import { AI_MODELS, AiModelsService } from './ai-models/ai-models.service';
import { FeatureRequestsAdminController, FeatureRequestsMineController } from './feature-requests.controller';
import { FeatureRequestsService } from './feature-requests.service';
import { HostingCostController } from './cost/hosting-cost.controller';
import { HOSTING_COST_SETTINGS, HostingCostService, type HostingCostSettings } from './cost/hosting-cost.service';

/** Operator console, bug reports and organization flags (T-072), hosting cost, and AI models (T-131). */
@Module({})
export class AdminModule {
  static register(settings: AdminSettings, cost: HostingCostSettings, models: AiModelsRuntime | null = null): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminController, BugReportsController, OrganizationFlagsController, HostingCostController, AiModelsController, FeatureRequestsAdminController, FeatureRequestsMineController],
      providers: [AdminService, FeatureRequestsService, { provide: ADMIN_SETTINGS, useValue: settings }, HostingCostService, { provide: HOSTING_COST_SETTINGS, useValue: cost }, AiModelsService, { provide: AI_MODELS, useValue: models }],
      exports: [AdminService],
    };
  }
}
