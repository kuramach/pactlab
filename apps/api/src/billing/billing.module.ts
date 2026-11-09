import { Module, type DynamicModule } from '@nestjs/common';
import { BillingAdminController, BillingController, BillingWebhookController } from './billing.controller';
import { BILLING, BillingService, type BillingDependencies } from './billing.service';

/** Billing (T-087). Exported so pact creation and sign-up can consume and redeem. */
@Module({})
export class BillingModule {
  static register(deps: BillingDependencies): DynamicModule {
    return {
      module: BillingModule,
      global: true,
      controllers: [BillingController, BillingWebhookController, BillingAdminController],
      providers: [BillingService, { provide: BILLING, useValue: deps }],
      exports: [BillingService],
    };
  }
}
