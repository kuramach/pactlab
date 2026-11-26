import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { notificationDispatch, type DeliveryKind, type PendingNotification, type PrismaClient } from '@pactlab/db';
import { planEmail, resolveEmailMode } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { EmailSender } from '../email-login/email-sender';
import { EmailSuppressedError, type SuppressionList } from '../email-login/ses-email-sender';
import { LOGGER, PRISMA } from '../tokens';
import { digestEmail, immediateEmail } from './notification-emails';

export const NOTIFICATION_SETTINGS = Symbol('NOTIFICATION_SETTINGS');

export interface NotificationModuleSettings {
  /** Null: nothing is emailed (no delivery configured); the inbox still works. */
  readonly emailSender: EmailSender | null;
  readonly suppression: SuppressionList | null;
  /** The web origin links point into. */
  readonly appOrigin: string;
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
    if (!this.settings.scheduled || !this.settings.emailSender) return;
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
    const outcome: DispatchOutcome = { sent: 0, digests: 0, suppressed: 0, failed: 0, inAppOnly: 0, noAddress: 0, waiting: 0, deadlines: 0 };
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
    return outcome;
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
