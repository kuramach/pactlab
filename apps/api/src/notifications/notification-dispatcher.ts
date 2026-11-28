import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ChannelSendError, type LineBot, type TelegramBot, type WhatsAppSender } from '@pactlab/connectors';
import { chatInstalls, contactDispatch, contacts, notificationDispatch, type DeliveryKind, type PendingNotification, type PrismaClient } from '@pactlab/db';
import { channelMessage, lineMessage, planEmail, resolveEmailMode } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { EmailSender } from '../email-login/email-sender';
import { EmailSuppressedError, type SuppressionList } from '../email-login/ses-email-sender';
import { chatMessage, type ChatSender } from '../contacts/chat-sender';
import { LINE_FREE_MONTHLY_ALLOWANCE, LineSender } from '../contacts/line-sender';
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
  readonly channels?: {
    readonly telegram: TelegramBot | null;
    readonly whatsapp: WhatsAppSender | null;
    readonly chat?: ChatSender | null;
    /** LINE (T-182): pushes within the monthly allowance; at the allowance, email only. */
    readonly line?: LineBot | null;
    readonly lineAllowance?: number;
  } | null;
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
  /** Messages sent on Telegram or WhatsApp, and those that failed. */
  channelSent: number;
  channelFailed: number;
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
  private readonly line: LineSender | null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    const bot = settings.channels?.line ?? null;
    this.line = bot ? new LineSender(bot, prisma, logger, settings.channels?.lineAllowance ?? LINE_FREE_MONTHLY_ALLOWANCE) : null;
  }

  onApplicationBootstrap(): void {
    const channels = this.settings.channels;
    if (!this.settings.scheduled || (!this.settings.emailSender && !channels?.telegram && !channels?.whatsapp && !channels?.chat?.enabled && !this.line)) return;
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
    const outcome: DispatchOutcome = { sent: 0, digests: 0, suppressed: 0, failed: 0, inAppOnly: 0, noAddress: 0, waiting: 0, deadlines: 0, channelSent: 0, channelFailed: 0 };
    outcome.deadlines = await notificationDispatch.deadlines(this.prisma, now);
    const digests = new Map<string, { email: string; items: PendingNotification[] }>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const items = await notificationDispatch.pendingPage(this.prisma, { after, limit: PAGE });
      if (items.length === 0) break;
      const settings = await notificationDispatch.settings(this.prisma, items.map((item) => item.userId));
      const inApp: string[] = [];
      const noAddress: string[] = [];
      const toChannels: PendingNotification[] = [];
      for (const item of items) {
        const recipient = settings.get(item.userId);
        if (!recipient) continue;
        const mode = resolveEmailMode(item.urgency, recipient.person, recipient.pacts.get(item.dealId) ?? null);
        const plan = planEmail({ urgency: item.urgency, mode, createdAt: item.createdAt }, recipient.person, now, recipient.lastDigestAt);
        // Channels follow the same plan: only "act now", only when it is due now (quiet hours honoured).
        if (plan === 'SEND_NOW' && item.urgency === 'ACT_NOW') toChannels.push(item);
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
      await this.toChannels(toChannels, outcome);
      outcome.inAppOnly += await notificationDispatch.settle(this.prisma, { ids: inApp, status: 'IN_APP_ONLY' });
      outcome.noAddress += await notificationDispatch.settle(this.prisma, { ids: noAddress, status: 'NO_ADDRESS' });
      if (items.length < PAGE) break;
      after = items[items.length - 1]?.id ?? null;
    }
    for (const [userId, digest] of digests) await this.deliver(userId, digest.email, 'DIGEST', digest.items, outcome);
    return outcome;
  }

  /**
   * One content-free message per item on each verified channel: the shared "Pactlab:" words and a link to
   * the inbox, never the pact's name or any deal content (a lock screen shows it). Each is claimed first,
   * so it is sent at most once per channel; a channel stopped since is no longer returned.
   */
  private async toChannels(items: readonly PendingNotification[], outcome: DispatchOutcome): Promise<void> {
    const channels = this.settings.channels;
    if (items.length === 0) return;
    await this.toChats(items, outcome);
    if (!channels?.telegram && !channels?.whatsapp && !this.line) return;
    const live = await contactDispatch.channels(this.prisma, [...new Set(items.map((item) => item.userId))]);
    const link = new URL('/notifications', this.settings.appOrigin).toString();
    for (const item of items) {
      for (const channel of live.filter((row) => row.userId === item.userId)) {
        const telegram = channel.kind === 'TELEGRAM' ? (channels?.telegram ?? null) : null;
        const whatsapp = channel.kind === 'WHATSAPP' ? (channels?.whatsapp ?? null) : null;
        const line = channel.kind === 'LINE' ? this.line : null;
        if (!telegram && !whatsapp && !line) continue;
        const deliveryId = await contactDispatch.claim(this.prisma, { channelId: channel.channelId, notificationId: item.id });
        if (!deliveryId) continue;
        try {
          if (telegram) await telegram.sendMessage(channel.handle, channelMessage('ACT_NOW', { link }));
          else if (whatsapp) await whatsapp.sendTemplate(channel.handle, 'ACT_NOW', link);
          // The delivery's own id is LINE's retry key: accepted at most once. At the monthly allowance this throws
          // `LineAllowanceReached` and nothing is sent; the email for the same item goes as planned.
          else if (line) await line.push(channel.handle, lineMessage('ACT_NOW', { link }), deliveryId);
          await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
          outcome.channelSent += 1;
        } catch (error) {
          const errorClass = error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown';
          await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass });
          outcome.channelFailed += 1;
          // The person can no longer be reached there: stop the channel rather than fail every time.
          if (error instanceof ChannelSendError && error.recipientGone) await contacts.stop(this.prisma, { kind: channel.kind, handle: channel.handle, reason: 'BLOCKED' });
          this.logger.warn({ channel: channel.kind, errorClass }, 'notification message failed');
        }
      }
    }
  }

  /**
   * Slack and Teams (T-181): one direct message from the Pactlab bot per item and link, the same words as
   * every channel and an Open Pactlab button that needs sign-in. Only links whose install is live are
   * returned, so an uninstall or token revocation stops sends at once. Claimed first: at most once.
   */
  private async toChats(items: readonly PendingNotification[], outcome: DispatchOutcome): Promise<void> {
    const chat = this.settings.channels?.chat;
    if (!chat?.enabled) return;
    const targets = await chatInstalls.targets(this.prisma, [...new Set(items.map((item) => item.userId))]);
    const message = chatMessage('ACT_NOW', new URL('/notifications', this.settings.appOrigin).toString());
    for (const item of items) {
      for (const target of targets.filter((row) => row.userId === item.userId)) {
        const deliveryId = await contactDispatch.claim(this.prisma, { channelId: target.channelId, notificationId: item.id });
        if (!deliveryId) continue;
        try {
          await chat.send(target, message);
          await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
          outcome.channelSent += 1;
        } catch (error) {
          const errorClass = error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown';
          await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass });
          outcome.channelFailed += 1;
          if (error instanceof ChannelSendError && error.recipientGone) await contacts.stop(this.prisma, { kind: target.kind, handle: target.handle, reason: 'BLOCKED' });
          this.logger.warn({ channel: target.kind, errorClass }, 'notification message failed');
        }
      }
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
