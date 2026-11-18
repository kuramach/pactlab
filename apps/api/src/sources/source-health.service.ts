import { ForbiddenException, Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { MacroForecastProvider } from '@pactlab/connectors';
import { operatorOps, prismaExecutor, sourceStatus, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { EmailSender } from '../email-login/email-sender';
import { emails } from '../email-login/emails';
import { LOGGER, PRISMA } from '../tokens';

export const SOURCE_HEALTH_SETTINGS = Symbol('SOURCE_HEALTH_SETTINGS');

export interface SourceHealthSettings {
  /** The provider Foresight uses: the check calls the same code, from the same network. */
  readonly macroForecasts: MacroForecastProvider;
  readonly emailSender: EmailSender | null;
  readonly operatorEmail: string | null;
  readonly environment: string;
  /** Scheduled checks on; off for fixture data (tests, local), where there is nothing to reach. */
  readonly scheduled: boolean;
  readonly intervalHours: number;
}

/** The IMF World Economic Outlook, as Foresight reads it (T-094 B10). */
export const IMF_SOURCE = 'imf-weo';
const IMF_LABEL = 'IMF World Economic Outlook';

/**
 * Live checks its own public data sources (T-137 follow-up): live is what uses the data, so live is
 * where reachability is checked. Every few hours one API task (an atomic claim) calls the IMF with
 * Foresight's own provider, records the result for Admin → Health, and emails the operator only when
 * the status changes. A failing check never throws into the app.
 */
@Injectable()
export class SourceHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly sql: SqlExecutor;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(SOURCE_HEALTH_SETTINGS) private readonly settings: SourceHealthSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  onApplicationBootstrap(): void {
    if (!this.settings.scheduled) return;
    const every = this.settings.intervalHours * 3_600_000;
    // First check shortly after start; the claim keeps restarts and several tasks from re-checking early.
    const schedule = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.run(false);
        schedule(every);
      }, delay);
      this.timer.unref();
    };
    schedule(30_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Operators only: the console's table. */
  async list(tenant: TenantContext) {
    await this.requireOperator(tenant);
    return { items: (await sourceStatus.list(this.sql, tenant.userId)).map((row) => ({ ...row, label: row.source === IMF_SOURCE ? IMF_LABEL : row.source, checkedAt: iso(row.checkedAt), lastOkAt: iso(row.lastOkAt), failingSince: iso(row.failingSince) })) };
  }

  /** Operators only: "Check now", whatever the interval. */
  async checkNow(tenant: TenantContext) {
    await this.requireOperator(tenant);
    await this.run(true);
    return this.list(tenant);
  }

  /** One check of the IMF. `force` (an operator's Check now) skips the interval. */
  async run(force: boolean): Promise<'CHECKED' | 'SKIPPED'> {
    try {
      const interval = force ? 0 : Math.max(1, Math.round(this.settings.intervalHours * 60) - 5);
      if (!(await sourceStatus.claim(this.sql, IMF_SOURCE, interval))) return 'SKIPPED';
      const year = new Date().getUTCFullYear();
      const years = [1, 2, 3, 4, 5].map((n) => year + n);
      const result = await this.settings.macroForecasts.forecast('NGDP_RPCH', 'USA', years);
      const ok = result.status === 'OK' && years.every((y) => result.series.values[y] !== undefined);
      const detail = ok ? null : result.status === 'UNAVAILABLE' ? [result.reason, result.detail].filter(Boolean).join(' · ') : 'MISSING_YEARS';
      const before = await sourceStatus.record(this.sql, IMF_SOURCE, ok, detail);
      this.logger.info({ source: IMF_SOURCE, ok, detail }, 'public data source checked');
      const changed = ok ? before === 'FAILING' : before !== 'FAILING';
      if (changed) this.alert(ok, detail);
      return 'CHECKED';
    } catch (error) {
      this.logger.warn({ source: IMF_SOURCE, errorClass: error instanceof Error ? error.name : 'unknown' }, 'public data source check could not run');
      return 'SKIPPED';
    }
  }

  private alert(ok: boolean, detail: string | null): void {
    const { emailSender, operatorEmail, environment } = this.settings;
    if (!emailSender || !operatorEmail) return;
    // silent-ok: the status is recorded and shown in Admin → Health either way; email is the nudge.
    void emailSender.send(emails.operatorSourceAlert(operatorEmail, { source: IMF_LABEL, environment, ok, detail })).catch((error: unknown) => {
      this.logger.error({ kind: 'operator-source-alert', errorClass: error instanceof Error ? error.name : 'unknown' }, 'source alert email failed');
    });
  }

  private async requireOperator(tenant: TenantContext): Promise<void> {
    if (!(await operatorOps.isOperator(this.sql, tenant.userId))) throw new ForbiddenException();
  }
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
