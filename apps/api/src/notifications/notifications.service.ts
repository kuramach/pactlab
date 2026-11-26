import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { NotificationSettingsBody, PactNotificationOverrideBody } from '@pactlab/contracts';
import { notificationInbox, notificationPreferences, type PrismaClient } from '@pactlab/db';
import { isValidTimeZone, type NotificationSettings, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

/** The signed-in person's inbox and notification settings (T-145). Theirs alone, under RLS. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  page(tenant: TenantContext, query: { cursor?: string | undefined; limit: number; unread: boolean }) {
    return notificationInbox.page(this.prisma, tenant, { cursor: query.cursor, limit: query.limit, unreadOnly: query.unread });
  }

  async unreadCount(tenant: TenantContext) {
    return { count: await notificationInbox.unreadCount(this.prisma, tenant) };
  }

  /** `read` is false when the item was already read, or is not the caller's (RLS hides it). */
  async markRead(tenant: TenantContext, id: string) {
    const read = await notificationInbox.markRead(this.prisma, tenant, id);
    return { read, unread: await notificationInbox.unreadCount(this.prisma, tenant) };
  }

  async markAllRead(tenant: TenantContext) {
    return { read: await notificationInbox.markAllRead(this.prisma, tenant), unread: 0 };
  }

  settings(tenant: TenantContext) {
    return notificationPreferences.get(this.prisma, tenant);
  }

  async updateSettings(tenant: TenantContext, body: NotificationSettingsBody): Promise<NotificationSettings> {
    if (!isValidTimeZone(body.timeZone)) throw new UnprocessableEntityException({ code: 'UNKNOWN_TIME_ZONE', detail: 'Choose a time zone from the list' });
    return notificationPreferences.set(this.prisma, tenant, body);
  }

  async pactSettings(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, 'DEAL_READ', { action: 'notifications.pact_settings_viewed', requestId });
    return notificationPreferences.getPact(this.prisma, tenant, dealId);
  }

  async updatePactSettings(tenant: TenantContext, dealId: string, body: PactNotificationOverrideBody, requestId: string) {
    await this.access.require(tenant, dealId, 'DEAL_READ', { action: 'notifications.pact_settings_changed', requestId });
    return notificationPreferences.setPact(this.prisma, tenant, dealId, body);
  }
}
