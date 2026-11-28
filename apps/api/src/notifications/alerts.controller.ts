import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { alertChannelsSchema, pushSubscriptionSchema, type AlertChannelsBody, type PushSubscriptionBody } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlertsService } from './alerts.service';

const idParams = z.object({ id: z.uuid() });

/** Urgent alerts (T-146): channel choices, and web push on this person's devices. */
@Controller('v1')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly service: AlertsService) {}

  @Get('alerts/config')
  config() {
    return this.service.config();
  }

  @Get('notification-settings/channels')
  channels(@Tenant() tenant: TenantContext) {
    return this.service.channels(tenant);
  }

  @Put('notification-settings/channels')
  setChannels(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(alertChannelsSchema)) body: AlertChannelsBody) {
    return this.service.setChannels(tenant, body);
  }

  @Get('me/push-subscriptions')
  devices(@Tenant() tenant: TenantContext) {
    return this.service.devices(tenant);
  }

  @Post('me/push-subscriptions')
  subscribe(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(pushSubscriptionSchema)) body: PushSubscriptionBody) {
    return this.service.subscribe(tenant, body);
  }

  @Delete('me/push-subscriptions/:id')
  remove(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.remove(tenant, params.id);
  }

  @Post('me/push-subscriptions/:id/test')
  @HttpCode(200)
  test(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.test(tenant, params.id);
  }
}
