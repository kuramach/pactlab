import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ChannelSendError, type TelegramBot, type WebPushSender, type WhatsAppSender } from '@pactlab/connectors';
import { alertDispatch, chatInstalls, contactDispatch, contacts, notificationDispatch, pushSubscriptions, type ChatTarget, type DeliveryKind, type DispatchChannel, type PendingAlertItem, type PendingNotification, type PrismaClient, type PushTarget } from '@pactlab/db';
import {
  ALERT_DAILY_CAP,
  ALERT_FOLD_MINUTES,
  DEFAULT_ALERT_CHANNELS,
  alertChannelOn,
  channelMessage,
  planAlert,
  planEmail,
  pushPayload,
  resolveEmailMode,
  type AlertChannel,
} from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { EmailSender } from '../email-login/email-sender';
import { EmailSuppressedError, type SuppressionList } from '../email-login/ses-email-sender';
import { chatMessage, type ChatSender } from '../contacts/chat-sender';
import { LOGGER, PRISMA } from '../tokens';
import { digestEmail, immediateEmail } from './notification-emails';

export const NOTIFICATION_SETTINGS = Symbol('NOTIFICATION_SETTINGS');

export interface NotificationModuleSettings {
  /** Null: nothing is emailed (no delivery configured); the inbox still works. */
  readonly emailSender: EmailSender | null;
  readonly suppression: SuppressionList | null;
  /** The web origin links point into. */
  readonly appOrigin: string;
  /**
   * Message channels (T-180, ADR 0064): "act now" items also go, content-free, to the person's verified
   * Telegram chat and WhatsApp number. Null or absent: email and the inbox only.
   */
  readonly channels?: { readonly telegram: TelegramBot | null; readonly whatsapp: WhatsAppSender | null; readonly chat?: ChatSender | null; readonly push?: WebPushSender | null } | null;
  /** Run the dispatcher on a timer (the API process; ADR 0046). Off in tests, which call run(). */
  readonly scheduled: boolean;
  readonly intervalMs: number;
}

export interface DispatchOutcome {
  sent: number;
  digests: number;
  suppressed: number;
  failed: number;
  inAppOnly: number;
  noAddress: number;
  waiting: number;
  deadlines: number;
  /** Messages sent on a channel (Telegram, WhatsApp, Slack, Teams, web push), and those that failed. */
  channelSent: number;
  channelFailed: number;
  /** Urgent alerts (T-146): sent, held for the 15-minute fold, held back by the daily cap. */
  alerts: number;
  folded: number;
  capped: number;
  /** Devices whose push service said the subscription is gone; they are ended. */
  pushExpired: number;
}

const PAGE = 200;
const MAX_PAGES = 20;

/**
 * Sends what is due (T-145): "act now" at once, the digest in its slot, nothing during quiet hours
 * unless opted through, nothing to a suppressed address. Every email is claimed before it is sent,
 * so a retry, a crash or a second API task never sends it twice (at most once); every outcome is
 * recorded on the delivery and shown on the person's items. Replay-safe: a rerun finds nothing new.
 */
@Injectable()
export class NotificationDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<DispatchOutcome> | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    const channels = this.settings.channels;
    if (!this.settings.scheduled || (!this.settings.emailSender && !channels?.telegram && !channels?.whatsapp && !channels?.chat?.enabled && !channels?.push)) return;
    const tick = () => {
      this.timer = setTimeout(() => {
        // handled: each delivery's outcome is stored on it and shown on the person's items; this only logs a run that could not start.
        void this.run().catch((error: unknown) => this.logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'notification dispatch failed'));
        tick();
      }, this.settings.intervalMs);
      this.timer.unref();
    };
    tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** One pass. Concurrent calls share the pass already running. */
  run(now: Date = new Date()): Promise<DispatchOutcome> {
    this.running ??= this.pass(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass(now: Date): Promise<DispatchOutcome> {
    const outcome: DispatchOutcome = { sent: 0, digests: 0, suppressed: 0, failed: 0, inAppOnly: 0, noAddress: 0, waiting: 0, deadlines: 0, channelSent: 0, channelFailed: 0, alerts: 0, folded: 0, capped: 0, pushExpired: 0 };
    outcome.deadlines = await notificationDispatch.deadlines(this.prisma, now);
    const digests = new Map<string, { email: string; items: PendingNotification[] }>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const items = await notificationDispatch.pendingPage(this.prisma, { after, limit: PAGE });
      if (items.length === 0) break;
      const settings = await notificationDispatch.settings(this.prisma, items.map((item) => item.userId));
      const inApp: string[] = [];
      const noAddress: string[] = [];
      for (const item of items) {
        const recipient = settings.get(item.userId);
        if (!recipient) continue;
        const mode = resolveEmailMode(item.urgency, recipient.person, recipient.pacts.get(item.dealId) ?? null);
        const plan = planEmail({ urgency: item.urgency, mode, createdAt: item.createdAt }, recipient.person, now, recipient.lastDigestAt);
        if (plan === 'IN_APP_ONLY') inApp.push(item.id);
        else if (plan === 'WAIT') outcome.waiting += 1;
        else if (!item.email || !this.settings.emailSender) noAddress.push(item.id);
        else if (plan === 'SEND_NOW') await this.deliver(item.userId, item.email, 'IMMEDIATE', [item], outcome);
        else {
          const entry = digests.get(item.userId) ?? { email: item.email, items: [] };
          entry.items.push(item);
          digests.set(item.userId, entry);
        }
      }
      outcome.inAppOnly += await notificationDispatch.settle(this.prisma, { ids: inApp, status: 'IN_APP_ONLY' });
      outcome.noAddress += await notificationDispatch.settle(this.prisma, { ids: noAddress, status: 'NO_ADDRESS' });
      if (items.length < PAGE) break;
      after = items[items.length - 1]?.id ?? null;
    }
    for (const [userId, digest] of digests) await this.deliver(userId, digest.email, 'DIGEST', digest.items, outcome);
    await this.alerts(now, outcome);
    return outcome;
  }

  /**
   * Urgent alerts (T-146): "act now" items reach the person's chosen channels as well as email. One
   * content-free message (the shared "Pactlab:" words and a link that needs sign-in, never the pact's
   * name or any deal content) per alert on each channel. An alert holds every item due for one person on
   * one pact; a pact alerted in the last 15 minutes waits and its later events go out together in the
   * next one; a person alerted 10 times in 24 hours gets email and the inbox only. Each message is
   * claimed before it is sent: at most once per channel; a channel stopped since is no longer returned.
   */
  private async alerts(now: Date, outcome: DispatchOutcome): Promise<void> {
    const channels = this.settings.channels;
    if (!channels || (!channels.telegram && !channels.whatsapp && !channels.chat?.enabled && !channels.push)) return;
    const link = new URL('/notifications', this.settings.appOrigin).toString();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const items: PendingAlertItem[] = await alertDispatch.pendingPage(this.prisma, { now, after, limit: PAGE });
      if (items.length === 0) break;
      const users = [...new Set(items.map((item) => item.userId))];
      const [settings, preferences, direct, chats, devices] = await Promise.all([
        notificationDispatch.settings(this.prisma, users),
        alertDispatch.preferences(this.prisma, users),
        channels.telegram || channels.whatsapp ? contactDispatch.channels(this.prisma, users) : Promise.resolve([] as DispatchChannel[]),
        channels.chat?.enabled ? chatInstalls.targets(this.prisma, users) : Promise.resolve([] as ChatTarget[]),
        channels.push ? pushSubscriptions.targets(this.prisma, users) : Promise.resolve([] as PushTarget[]),
      ]);
      const skip: string[] = [];
      const groups = new Map<string, { userId: string; dealId: string; ids: string[] }>();
      for (const item of items) {
        const recipient = settings.get(item.userId);
        if (!recipient) continue;
        const plan = planAlert({ urgency: 'ACT_NOW' }, recipient.person, recipient.pacts.get(item.dealId) ?? null, now);
        if (plan === 'SKIP') skip.push(item.id);
        if (plan !== 'ALERT') continue;
        const key = `${item.userId}:${item.dealId}`;
        const group = groups.get(key) ?? { userId: item.userId, dealId: item.dealId, ids: [] };
        group.ids.push(item.id);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const chosen = preferences.get(group.userId) ?? DEFAULT_ALERT_CHANNELS;
        const on = (kind: AlertChannel) => alertChannelOn(chosen, kind);
        const mine = {
          direct: direct.filter((row) => row.userId === group.userId && on(row.kind as AlertChannel) && ((row.kind === 'TELEGRAM' && channels.telegram) || (row.kind === 'WHATSAPP' && channels.whatsapp))),
          chats: chats.filter((row) => row.userId === group.userId && on(row.kind)),
          devices: on('WEB_PUSH') ? devices.filter((row) => row.userId === group.userId) : [],
        };
        if (mine.direct.length + mine.chats.length + mine.devices.length === 0) {
          // Nowhere the person chose: settled, so it is not looked at again.
          skip.push(...group.ids);
          continue;
        }
        const taken = await alertDispatch.take(this.prisma, { userId: group.userId, dealId: group.dealId, ids: group.ids, now, cap: ALERT_DAILY_CAP, foldMinutes: ALERT_FOLD_MINUTES });
        if (taken.decision === 'FOLD') outcome.folded += group.ids.length;
        if (taken.decision === 'CAPPED') outcome.capped += group.ids.length;
        if (taken.decision !== 'ALERT') continue;
        outcome.alerts += 1;
        // Telegram, WhatsApp, Slack and Teams claim on the alert's first item: one message per alert per channel.
        const [lead] = [...group.ids].sort();
        if (!lead) continue;
        const { telegram, whatsapp, chat } = channels;
        for (const channel of mine.direct) {
          await this.sendClaimed(channel.kind, channel.handle, () => contactDispatch.claim(this.prisma, { channelId: channel.channelId, notificationId: lead }), outcome, async () => {
            if (channel.kind === 'TELEGRAM' && telegram) await telegram.sendMessage(channel.handle, channelMessage('ACT_NOW', { link }));
            else if (channel.kind === 'WHATSAPP' && whatsapp) await whatsapp.sendTemplate(channel.handle, 'ACT_NOW', link);
          });
        }
        for (const target of mine.chats) {
          if (!chat) break;
          await this.sendClaimed(target.kind, target.handle, () => contactDispatch.claim(this.prisma, { channelId: target.channelId, notificationId: lead }), outcome, () => chat.send(target, chatMessage('ACT_NOW', link)));
        }
        for (const device of mine.devices) await this.push(device, taken.alertId, outcome);
      }
      await alertDispatch.skip(this.prisma, skip);
      if (items.length < PAGE) break;
      after = items[items.length - 1]?.id ?? null;
    }
  }

  /** One claimed message on Telegram, WhatsApp, Slack or Teams; its outcome stored on the delivery. */
  private async sendClaimed(kind: DispatchChannel['kind'], handle: string, claim: () => Promise<string | null>, outcome: DispatchOutcome, send: () => Promise<void>): Promise<void> {
    const deliveryId = await claim();
    if (!deliveryId) return;
    try {
      await send();
      await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
      outcome.channelSent += 1;
    } catch (error) {
      const errorClass = error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown';
      await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass });
      outcome.channelFailed += 1;
      // The person can no longer be reached there: stop the channel rather than fail every time.
      if (error instanceof ChannelSendError && error.recipientGone) await contacts.stop(this.prisma, { kind, handle, reason: 'BLOCKED' });
      this.logger.warn({ channel: kind, errorClass }, 'notification message failed');
    }
  }

  /** One web push to one device. A subscription the push service says is gone (404, 410) is ended. */
  private async push(device: PushTarget, alertId: string, outcome: DispatchOutcome): Promise<void> {
    const sender = this.settings.channels?.push;
    if (!sender) return;
    const deliveryId = await pushSubscriptions.claim(this.prisma, { subscriptionId: device.subscriptionId, alertId });
    if (!deliveryId) return;
    try {
      await sender.send(device, JSON.stringify(pushPayload('ACT_NOW')), { urgency: 'high' });
      await pushSubscriptions.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
      outcome.channelSent += 1;
    } catch (error) {
      const errorClass = error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown';
      const gone = error instanceof ChannelSendError && error.recipientGone;
      await pushSubscriptions.finish(this.prisma, { deliveryId, outcome: gone ? 'EXPIRED' : 'FAILED', errorClass });
      if (gone) {
        await pushSubscriptions.expire(this.prisma, device.subscriptionId);
        outcome.pushExpired += 1;
      } else outcome.channelFailed += 1;
      this.logger.warn({ channel: 'WEB_PUSH', errorClass }, 'notification push failed');
    }
  }

  private async deliver(userId: string, email: string, kind: DeliveryKind, items: readonly PendingNotification[], outcome: DispatchOutcome): Promise<void> {
    const sender = this.settings.emailSender;
    if (!sender) return;
    const deliveryId = await notificationDispatch.claim(this.prisma, { userId, kind, ids: items.map((item) => item.id) });
    // Another pass took them: never send twice.
    if (!deliveryId) return;
    const finish = (result: 'SENT' | 'SUPPRESSED' | 'FAILED', errorClass: string | null) => notificationDispatch.finish(this.prisma, { deliveryId, outcome: result, errorClass });
    let suppressed: string | null = null;
    try {
      suppressed = (await this.settings.suppression?.check(email)) ?? null;
    } catch (error) {
      // handled: SES's own suppression stays the floor (as SesEmailSender does); logged by class only.
      this.logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'suppression check failed; sending anyway');
    }
    if (suppressed) {
      await finish('SUPPRESSED', suppressed);
      outcome.suppressed += 1;
      return;
    }
    const origin = this.settings.appOrigin;
    const [single] = items;
    const message = kind === 'IMMEDIATE' && single ? immediateEmail(email, single, origin) : digestEmail(email, items, origin);
    try {
      await sender.send(message);
      await finish('SENT', null);
      if (kind === 'IMMEDIATE') outcome.sent += 1;
      else outcome.digests += 1;
    } catch (error) {
      if (error instanceof EmailSuppressedError) {
        await finish('SUPPRESSED', error.reason);
        outcome.suppressed += 1;
        return;
      }
      // Recorded on the delivery and shown on the person's items as "email not delivered"; never retried (at most once).
      await finish('FAILED', error instanceof Error ? error.name : 'unknown');
      outcome.failed += 1;
      this.logger.warn({ kind, items: items.length, errorClass: error instanceof Error ? error.name : 'unknown' }, 'notification email failed');
    }
  }
}
