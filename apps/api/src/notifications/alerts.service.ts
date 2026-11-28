import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AlertChannelsBody, PushSubscriptionBody } from '@pactlab/contracts';
import { ChannelSendError, isKnownPushEndpoint } from '@pactlab/connectors';
import { alertPreferences, pushSubscriptions, type PrismaClient } from '@pactlab/db';
import { ALERT_CHANNELS, ALERT_DAILY_CAP, ALERT_FOLD_MINUTES, alertChannelOn, pushPayload, type AlertChannel, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { LOGGER, PRISMA } from '../tokens';
import { NOTIFICATION_SETTINGS, type NotificationModuleSettings } from './notification-dispatcher';

/**
 * Urgent alerts in Settings → Notifications (T-146): the person's channel choices and this browser's
 * web push subscription. Theirs alone: RLS by user and organization, writes through definer functions.
 */
@Injectable()
export class AlertsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** What this deployment offers: the VAPID public key the browser subscribes with (null: web push is off), and the limits. */
  config() {
    const channels = this.settings.channels;
    const available: Record<AlertChannel, boolean> = {
      WEB_PUSH: Boolean(channels?.push),
      TELEGRAM: Boolean(channels?.telegram),
      SLACK: Boolean(channels?.chat?.slack),
      TEAMS: Boolean(channels?.chat?.teams),
      // Deferred (Kumar, 2026-11-27): offered only where an earlier deployment turned it on.
      WHATSAPP: Boolean(channels?.whatsapp),
    };
    return { publicKey: channels?.push?.publicKey ?? null, available, dailyCap: ALERT_DAILY_CAP, foldMinutes: ALERT_FOLD_MINUTES };
  }

  async channels(tenant: TenantContext) {
    const preferences = await alertPreferences.get(this.prisma, tenant);
    return { off: preferences.off, on: ALERT_CHANNELS.filter((channel) => alertChannelOn(preferences, channel)) };
  }

  async setChannels(tenant: TenantContext, body: AlertChannelsBody) {
    await alertPreferences.set(this.prisma, tenant, { off: body.off });
    return this.channels(tenant);
  }

  async devices(tenant: TenantContext) {
    const items = await pushSubscriptions.list(this.prisma, tenant);
    return { items: items.map((device) => ({ id: device.id, label: device.label, createdAt: device.createdAt.toISOString(), lastSentAt: device.lastSentAt?.toISOString() ?? null })) };
  }

  async subscribe(tenant: TenantContext, body: PushSubscriptionBody) {
    if (!this.settings.channels?.push) throw new UnprocessableEntityException({ code: 'PUSH_OFF', detail: 'Alerts on devices are not turned on for this Pactlab' });
    // Only the browsers' own push services are ever called: an endpoint elsewhere is refused (SSRF).
    if (!isKnownPushEndpoint(body.endpoint)) throw new UnprocessableEntityException({ code: 'PUSH_SERVICE_UNKNOWN', detail: 'This browser’s push service is not one Pactlab sends to' });
    const id = await pushSubscriptions.subscribe(this.prisma, tenant, { endpoint: body.endpoint, p256dh: body.keys.p256dh.replace(/=+$/, ''), auth: body.keys.auth.replace(/=+$/, ''), label: body.label });
    if (!id) throw new NotFoundException();
    return { id };
  }

  async remove(tenant: TenantContext, id: string) {
    if (!(await pushSubscriptions.unsubscribe(this.prisma, tenant, id))) throw new NotFoundException();
    return { removed: true };
  }

  /** A test alert to one of the person's own devices, at most 3 an hour. The same content-free payload. */
  async test(tenant: TenantContext, id: string) {
    const sender = this.settings.channels?.push;
    if (!sender) throw new UnprocessableEntityException({ code: 'PUSH_OFF', detail: 'Alerts on devices are not turned on for this Pactlab' });
    const claimed = await pushSubscriptions.claimTest(this.prisma, tenant, id);
    if (!claimed) throw new NotFoundException();
    try {
      await sender.send(claimed.target, JSON.stringify(pushPayload('TEST')), { urgency: 'normal', ttlSeconds: 600 });
      await pushSubscriptions.finish(this.prisma, { deliveryId: claimed.deliveryId, outcome: 'SENT', errorClass: null });
      return { sent: true, expired: false };
    } catch (error) {
      const errorClass = error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown';
      const gone = error instanceof ChannelSendError && error.recipientGone;
      await pushSubscriptions.finish(this.prisma, { deliveryId: claimed.deliveryId, outcome: gone ? 'EXPIRED' : 'FAILED', errorClass });
      if (gone) await pushSubscriptions.expire(this.prisma, id);
      this.logger.warn({ channel: 'WEB_PUSH', errorClass }, 'test push failed');
      return { sent: false, expired: gone };
    }
  }
}
