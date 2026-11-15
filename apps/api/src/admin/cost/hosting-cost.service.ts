import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { D } from '@pactlab/calculations';
import { hostingCost, OperatorRequiredError, prismaExecutor, type CostGranularity, type CostRateKind, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { LOGGER, PRISMA } from '../../tokens';
import type { CostSource } from './cost-explorer';
import { actualSpend, meteredCost, unallocated } from './cost-view';

export const HOSTING_COST_SETTINGS = Symbol('HOSTING_COST_SETTINGS');
export interface HostingCostSettings {
  /** Cost Explorer in the payer account; null where it is not configured (everywhere but live). */
  readonly source: CostSource | null;
  /** This deployment's `pactlab:environment` tag value (prod, stage, dev, qa): whose spend the metered rows explain. */
  readonly environment: string;
  readonly now?: () => Date;
}

const DAY = 86_400_000;
const STALE_MS = 24 * 3_600_000;
const REFRESH_EVERY_MS = 3_600_000;
const DAILY_DAYS = 92;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));

/**
 * Hosting cost (2026-11-15), operator-only. Real spend comes from Cost Explorer (stored, refreshed
 * at most hourly and on its own after a day); metered estimates come from this environment's AI
 * runs and documents priced with operator-entered rates; the rest is one unallocated line.
 */
@Injectable()
export class HostingCostService {
  private readonly sql: SqlExecutor;
  private refreshing: Promise<void> | null = null;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(HOSTING_COST_SETTINGS) private readonly settings: HostingCostSettings,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  private now() {
    return this.settings.now?.() ?? new Date();
  }

  private async asOperator<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OperatorRequiredError) throw new ForbiddenException();
      throw error;
    }
  }

  /** Pull 13 months (monthly) and the last 92 days (daily) from Cost Explorer; replaces what is stored. */
  private refreshNow(actor: string): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const source = this.settings.source;
    if (!source) return Promise.resolve();
    const run = async () => {
      const now = this.now();
      const windows: { granularity: CostGranularity; from: string; to: string }[] = [
        { granularity: 'MONTHLY', from: iso(monthStart(now, -12)), to: iso(monthStart(now, 1)) },
        { granularity: 'DAILY', from: iso(new Date(now.getTime() - DAILY_DAYS * DAY)), to: iso(new Date(now.getTime() + DAY)) },
      ];
      let stored = 0;
      try {
        for (const window of windows) stored += await hostingCost.replace(this.sql, actor, window.granularity, window.from, window.to, await source.fetch(window.granularity, window.from, window.to));
        await hostingCost.logSync(this.sql, actor, { status: 'SUCCEEDED', lines: stored, errorClass: null, at: now });
      } catch (error) {
        const errorClass = error instanceof Error ? error.name : 'unknown';
        this.logger.warn({ errorClass }, 'hosting cost refresh failed');
        await hostingCost.logSync(this.sql, actor, { status: 'FAILED', lines: stored, errorClass, at: now });
      }
    };
    this.refreshing = run().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Refresh now, at most once an hour (Cost Explorer charges per request). */
  refresh(tenant: TenantContext) {
    return this.asOperator(async () => {
      const state = await hostingCost.syncState(this.sql, tenant.userId);
      if (!this.settings.source) throw new ConflictException({ code: 'COST_SOURCE_NOT_CONFIGURED' });
      if (state.lastAttemptAt && this.now().getTime() - state.lastAttemptAt.getTime() < REFRESH_EVERY_MS) throw new ConflictException({ code: 'REFRESHED_RECENTLY' });
      await this.refreshNow(tenant.userId);
      return { state: await hostingCost.syncState(this.sql, tenant.userId) };
    });
  }

  /**
   * The cost view for [from, to) and, optionally, one environment. A view of data over a day old
   * starts a refresh in the background (at most hourly); the page says so.
   */
  view(tenant: TenantContext, query: { from: string; to: string; environment?: string | undefined }) {
    return this.asOperator(async () => {
      const state = await hostingCost.syncState(this.sql, tenant.userId);
      const now = this.now();
      const stale = !state.lastSuccessAt || now.getTime() - state.lastSuccessAt.getTime() > STALE_MS;
      const mayTry = !state.lastAttemptAt || now.getTime() - state.lastAttemptAt.getTime() >= REFRESH_EVERY_MS;
      let refreshing = this.refreshing !== null;
      if (this.settings.source && stale && mayTry && !refreshing) {
        // handled: refreshNow logs and records its own failure; the page shows the last attempt
        void this.refreshNow(tenant.userId).catch(() => undefined);
        refreshing = true;
      }

      // Daily lines while the period is inside the daily window; whole months otherwise.
      const dailyFrom = iso(new Date(now.getTime() - DAILY_DAYS * DAY));
      const granularity: CostGranularity = query.from >= dailyFrom ? 'DAILY' : 'MONTHLY';
      const linesFrom = granularity === 'MONTHLY' ? `${query.from.slice(0, 7)}-01` : query.from;
      const all = await hostingCost.lines(this.sql, tenant.userId, granularity, linesFrom, query.to);
      const lines = query.environment ? all.filter((line) => line.environment === query.environment) : all;
      const [ai, storage, rates] = await Promise.all([
        hostingCost.aiUsage(this.sql, tenant.userId, query.from, query.to),
        hostingCost.storageUsage(this.sql, tenant.userId, query.from, query.to),
        hostingCost.rates(this.sql, tenant.userId),
      ]);
      const actual = actualSpend(lines);
      const metered = meteredCost({ ai, storage, rates, periodEnd: iso(new Date(new Date(`${query.to}T00:00:00Z`).getTime() - DAY)) });
      const here = all.filter((line) => line.environment === this.settings.environment);
      const hereTotal = here.reduce((sum, line) => sum.plus(line.amount), new D(0)).toFixed(2);
      const bedrockHere = actualSpend(here).bedrock.reduce((sum, line) => sum.plus(line.amount), new D(0)).toFixed(2);
      return {
        period: { from: query.from, to: query.to, granularity, environment: query.environment ?? null },
        source: {
          configured: this.settings.source !== null,
          environment: this.settings.environment,
          refreshing,
          lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
          lastStatus: state.lastStatus,
          lastError: state.lastError,
          lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        },
        environments: [...new Set(all.map((line) => line.environment))].sort(),
        actual: { ...actual, bedrock: undefined },
        metered,
        // Only when Cost Explorer has this environment's spend for the period.
        shared: here.length > 0 ? { environment: this.settings.environment, actual: hereTotal, metered: metered.total, unallocated: unallocated(hereTotal, metered.total) } : null,
        bedrockCheck: here.length > 0 ? { actual: bedrockHere, metered: metered.ai } : null,
        rates,
      };
    });
  }

  rates(tenant: TenantContext) {
    return this.asOperator(async () => ({ items: await hostingCost.rates(this.sql, tenant.userId) }));
  }

  setRate(tenant: TenantContext, rate: { kind: CostRateKind; key: string; unitPrice: string; currency: string; effectiveFrom: string; sourceNote: string }) {
    return this.asOperator(async () => ({ id: await hostingCost.setRate(this.sql, tenant.userId, rate) }));
  }

  deleteRate(tenant: TenantContext, id: string) {
    return this.asOperator(async () => {
      if (!(await hostingCost.deleteRate(this.sql, tenant.userId, id))) throw new NotFoundException();
      return { deleted: true };
    });
  }
}
