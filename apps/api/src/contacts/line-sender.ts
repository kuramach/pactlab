import { ChannelSendError, type LineBot } from '@pactlab/connectors';
import { lineQuota, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';

/**
 * The free monthly allowance of the Pactlab LINE Official Account (T-182): 200 messages on the Communication
 * plan for Japan (lycbiz.com, read 2026-11-27). A paid plan is a paid dependency: until Kumar's approval is
 * recorded (tasks/…/T-182.md), sends stop here, so the allowance can never be raised by configuration alone.
 */
export const LINE_FREE_MONTHLY_ALLOWANCE = 200;

/** What operators see once sends have stopped for the month. */
export const LINE_ALLOWANCE_NOTICE = 'LINE monthly allowance reached';

/**
 * Sends one LINE push (T-182), shared by the notification dispatcher and the profile's test message. Every push is
 * taken from the month's allowance before it is sent; at the allowance nothing is sent (the person still gets
 * email) and operators see the notice. A push LINE did not accept is given back. The user ID is never logged.
 */
export class LineSender {
  constructor(
    readonly bot: LineBot | null,
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    readonly allowance: number = LINE_FREE_MONTHLY_ALLOWANCE,
  ) {}

  get enabled(): boolean {
    return this.bot !== null;
  }

  /** `retryKey` is the delivery's own id, so LINE accepts the push at most once. */
  async push(userId: string, text: string, retryKey: string): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new ChannelSendError('LineOff');
    if (!(await lineQuota.take(this.prisma, this.allowance))) {
      this.logger.warn({ channel: 'LINE', allowance: this.allowance }, LINE_ALLOWANCE_NOTICE);
      throw new ChannelSendError('LineAllowanceReached');
    }
    try {
      await bot.push(userId, text, retryKey);
    } catch (error) {
      if (error instanceof ChannelSendError && error.errorClass === 'LineMonthlyLimit') {
        await lineQuota.exhausted(this.prisma);
        this.logger.warn({ channel: 'LINE' }, LINE_ALLOWANCE_NOTICE);
      } else {
        await lineQuota.release(this.prisma);
      }
      throw error;
    }
  }
}
