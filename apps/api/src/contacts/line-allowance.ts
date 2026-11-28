import { ChannelSendError, type LineMessenger } from '@pactlab/connectors';
import type { Logger } from '@pactlab/observability';

/** What a LINE send may do this month. Fails closed: if LINE cannot say how many were sent, nothing is pushed. */
export interface LineAllowanceState {
  /** Pushes still allowed this month. */
  readonly remaining: number;
  /** The cap in force: the configured allowance, or the account's own target limit if lower. */
  readonly limit: number;
  /** LINE's count this month, or null when it could not be read. */
  readonly used: number | null;
}

/** The error class recorded on a LINE message held back at the cap (the operator console counts these). */
export const LINE_ALLOWANCE_REACHED = 'LineAllowanceReached';

/**
 * The monthly cap on LINE pushes (T-182): the free allowance (200 a month on the Communication plan) unless a
 * paid plan is approved. LINE's own count (the quota endpoints) is read before each batch, so a message sent
 * from LINE Official Account Manager counts too. Replies are free and never checked.
 */
export class LineAllowance {
  private warnedMonth: string | null = null;

  constructor(
    private readonly line: LineMessenger,
    readonly allowance: number,
    private readonly logger: Logger,
  ) {}

  async state(): Promise<LineAllowanceState> {
    try {
      const usage = await this.line.monthlyUsage();
      const limit = Math.min(this.allowance, usage.accountLimit ?? Number.POSITIVE_INFINITY);
      const remaining = Math.max(0, limit - usage.used);
      if (remaining === 0) this.reached();
      return { remaining, limit, used: usage.used };
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof ChannelSendError ? error.errorClass : 'unknown' }, 'LINE allowance unreadable; LINE sends held');
      return { remaining: 0, limit: this.allowance, used: null };
    }
  }

  /** Once a month per process: the operator's signal, beside the console's "LINE monthly allowance reached". */
  reached(): void {
    const month = new Date().toISOString().slice(0, 7);
    if (this.warnedMonth === month) return;
    this.warnedMonth = month;
    this.logger.warn({ channel: 'LINE', allowance: this.allowance }, 'LINE monthly allowance reached');
  }
}
