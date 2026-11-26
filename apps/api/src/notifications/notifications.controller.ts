import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { notificationInboxQuerySchema, notificationSettingsSchema, pactNotificationOverrideSchema, type NotificationInboxQuery, type NotificationSettingsBody, type PactNotificationOverrideBody } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { NotificationsService } from './notifications.service';

const idParams = z.object({ id: z.uuid() });
const dealParams = z.object({ dealId: z.uuid() });

/** The bell's inbox (T-145): the signed-in person's own items, newest first, paginated (T-126). */
@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  page(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(notificationInboxQuerySchema)) query: NotificationInboxQuery) {
    return this.service.page(tenant, query);
  }

  @Get('unread-count')
  unread(@Tenant() tenant: TenantContext) {
    return this.service.unreadCount(tenant);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Tenant() tenant: TenantContext) {
    return this.service.markAllRead(tenant);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.markRead(tenant, params.id);
  }
}

/** Settings → Notifications (T-145): the person's settings, and their override on one pact. */
@Controller('v1')
export class NotificationSettingsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get('notification-settings')
  get(@Tenant() tenant: TenantContext) {
    return this.service.settings(tenant);
  }

  @Put('notification-settings')
  put(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(notificationSettingsSchema)) body: NotificationSettingsBody) {
    return this.service.updateSettings(tenant, body);
  }

  @Get('deals/:dealId/notification-settings')
  getPact(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(dealParams)) params: { dealId: string }, @RequestId() requestId: string) {
    return this.service.pactSettings(tenant, params.dealId, requestId);
  }

  @Put('deals/:dealId/notification-settings')
  putPact(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(dealParams)) params: { dealId: string }, @Body(new ZodValidationPipe(pactNotificationOverrideSchema)) body: PactNotificationOverrideBody, @RequestId() requestId: string) {
    return this.service.updatePactSettings(tenant, params.dealId, body, requestId);
  }
}
