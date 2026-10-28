import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  foresightForecastPrompt,
  foresightQaPrompt,
  foresightTrendsPrompt,
  GatewayPolicyError,
  VoiceUnavailableError,
  type AiRunRecord,
  type ClaudeGateway,
  type SpeechToText,
  type TextToSpeech,
} from '@pactlab/ai';
import { D, projectValue, type ProjectionTrend } from '@pactlab/calculations';
import type {
  ForesightAnswerView,
  ForesightLineView,
  ForesightProjectionView,
  ForesightQuestionInput,
  ForesightScenarioInput,
  ForesightTrendView,
  ForesightUserForecastInput,
  ForesightView,
  ForesightVoiceQuestionInput,
  UpdateForesightScenarioInput,
} from '@pactlab/contracts';
import { appendAuditEvent, askingPrices, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  isCounterpartyRole,
  COMPANY_TYPE_LABELS,
  foresightMetricsFor,
  macroAreaFor,
  permissionsForDealRole,
  trendDefinitionsFor,
  type CompanyType,
  type DealRole,
  type PackId,
  type TenantContext,
  type TrendDefinition,
} from '@pactlab/domain';
import type { MacroForecastProvider } from '@pactlab/connectors';
import { DealAccess } from '../deals/deal-access';
import { BASELINE_MAX_AGE_MS, BASELINE_STALE_RUN_MS, forecastsView, forecastYears } from './forecasts';
import { PRISMA } from '../tokens';

export const FORESIGHT_DEPENDENCIES = Symbol('FORESIGHT_DEPENDENCIES');
export interface ForesightDependencies {
  readonly gateway: ClaudeGateway;
  readonly aiEnabled: boolean;
  readonly speechToText: SpeechToText;
  readonly textToSpeech: TextToSpeech;
  /** Published macro forecasts (IMF live, or fixture series in tests). */
  readonly macroForecasts: MacroForecastProvider;
  /** Refresh the forecast baseline in the background when Foresight is opened (off only in tests that drive generation by hand). */
  readonly autoBaseline: boolean;
}

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && !isCounterpartyRole(role);

type Override = { direction?: ForesightTrendView['direction']; magnitude?: ForesightTrendView['magnitude']; weight?: string };
type CustomTrend = ForesightScenarioInput['customTrends'][number];
type Line = Omit<ForesightLineView, 'projection'>;
const ASSUMPTION_NAMES = ['startValue', 'baseGrowth', 'baseMargin', 'rateToMultiple'] as const;

function aiFailure(error: unknown): never {
  if (error instanceof GatewayPolicyError) {
    if (error.code === 'PROHIBITED_DATA') throw new UnprocessableEntityException();
    throw new ServiceUnavailableException({ code: 'AI_OFF' });
  }
  throw error;
}
const providerUnavailable = (kind: string | null) =>
  new ServiceUnavailableException({ code: kind === 'ACCESS' ? 'AI_ACCESS' : kind === 'THROTTLED' ? 'AI_THROTTLED' : 'AI_UNAVAILABLE' });

/**
 * Foresight (T-073; codename Nostradamus): the AI baseline of five-year trend
 * lines per deal, the user's scenarios layered on top, the projected value
 * path under each, and grounded Q&A by text or voice. The model proposes
 * directions and bands only; values come from the projection engine. Every
 * generation, scenario change and question is audited; audio is never kept.
 */
@Injectable()
export class ForesightService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FORESIGHT_DEPENDENCIES) private readonly deps: ForesightDependencies,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  private async recordRun(tx: TransactionClient, run: AiRunRecord) {
    await tx.aiRun.create({
      data: {
        id: run.id,
        organizationId: run.organizationId,
        dealId: run.dealId,
        taskType: run.taskType,
        promptId: run.promptId,
        promptVersion: run.promptVersion,
        promptHash: run.promptHash,
        modelAlias: run.modelAlias,
        resolvedModelId: run.resolvedModelId,
        inputHashes: [...run.inputHashes],
        outputHash: run.outputHash,
        status: run.status,
        repairAttempted: run.repairAttempted,
        injectionSignals: run.injectionSignals,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
        createdAt: new Date(run.createdAt),
      },
    });
  }

  private async pack(tx: TransactionClient, dealId: string): Promise<{ pack: PackId | null; companyType: CompanyType | null }> {
    const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
    const companyType = (seller?.companyType ?? null) as CompanyType | null;
    return { companyType, pack: companyType && companyType !== 'OTHER' ? (companyType as PackId) : 'SOFTWARE_SAAS' };
  }

  /** Today's value: the latest valuation run's enterprise value, else the asking price. */
  private async startValue(tx: TransactionClient, dealId: string): Promise<{ amount: string; currency: string; source: string } | null> {
    const run = await tx.valuationRun.findFirst({ where: { dealId }, orderBy: { ranAt: 'desc' }, select: { result: true, scenario: { select: { name: true } } } });
    const ev = (run?.result as { enterpriseValue?: { amount?: string; currency?: string } } | undefined)?.enterpriseValue;
    if (ev?.amount && ev.currency && Number(ev.amount) > 0) return { amount: ev.amount, currency: ev.currency, source: `Enterprise value from the latest valuation run (“${run?.scenario.name ?? 'scenario'}”)` };
    const asking = (await askingPrices.currentFor(tx, [dealId])).get(dealId);
    if (asking && Number(asking.amount) > 0) return { amount: asking.amount, currency: asking.currency, source: 'The asking price (no valuation has run yet)' };
    return null;
  }

  // --- Trend lines and scenarios ----------------------------------------------

  private baselineLine(set: { id: string; baseGrowth: { toFixed(): string }; baseMargin: { toFixed(): string } }, trends: { key: string; label: string; category: string; direction: string; magnitude: string; confidence: string; narrative: string; effects: unknown }[]): Line {
    return {
      id: null,
      name: 'AI baseline',
      kind: 'BASELINE',
      version: null,
      baseGrowth: set.baseGrowth.toFixed(),
      baseMargin: set.baseMargin.toFixed(),
      overrides: {},
      customTrends: [],
      trends: trends.map((trend) => ({
        key: trend.key,
        label: trend.label,
        category: trend.category as ForesightTrendView['category'],
        direction: trend.direction as ForesightTrendView['direction'],
        magnitude: trend.magnitude as ForesightTrendView['magnitude'],
        confidence: trend.confidence as ForesightTrendView['confidence'],
        narrative: trend.narrative,
        provenance: 'AI',
        adjusted: false,
        weight: '1',
        effects: trend.effects as ForesightTrendView['effects'],
      })),
    };
  }

  /** A scenario is the baseline with the user's overrides and custom trends on top; the baseline is untouched. */
  private scenarioLine(baseline: Line, scenario: { id: string; name: string; version: number; baseGrowth: { toFixed(): string }; baseMargin: { toFixed(): string }; overrides: unknown; customTrends: unknown }): Line {
    const overrides = (scenario.overrides ?? {}) as Record<string, Override>;
    const custom = (scenario.customTrends ?? []) as CustomTrend[];
    return {
      id: scenario.id,
      name: scenario.name,
      kind: 'SCENARIO',
      version: scenario.version,
      baseGrowth: scenario.baseGrowth.toFixed(),
      baseMargin: scenario.baseMargin.toFixed(),
      overrides,
      customTrends: custom,
      trends: [
        ...baseline.trends.map((trend) => {
          const override = overrides[trend.key];
          if (!override) return trend;
          return { ...trend, ...override, weight: override.weight ?? trend.weight, provenance: 'USER' as const, adjusted: true };
        }),
        ...custom.map((trend) => ({ ...trend, category: 'CUSTOM' as const, provenance: 'USER' as const, adjusted: false })),
      ],
    };
  }

  private project(line: Line, start: { amount: string; currency: string; source: string } | null): ForesightProjectionView | null {
    if (!start) return null;
    const result = projectValue({
      startValue: start.amount,
      currency: start.currency,
      baseGrowth: line.baseGrowth,
      baseMargin: line.baseMargin,
      trends: line.trends.map((trend): ProjectionTrend => ({ ...trend })),
    });
    return { ...result, impacts: [...result.impacts], path: [...result.path], sensitivity: [...result.sensitivity], assumptions: { ...result.assumptions, startValueSource: start.source } };
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<ForesightView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'foresight.viewed', requestId });
    // Opening Foresight never waits on a provider or the model: a missing or old baseline refreshes in the background.
    if (this.deps.autoBaseline) await this.ensureBaseline(tenant, dealId, requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      const set = await tx.foresightTrendSet.findFirst({ where: { dealId }, orderBy: { createdAt: 'desc' } });
      const start = await this.startValue(tx, dealId);
      const lines: ForesightLineView[] = [];
      if (set) {
        const trends = await tx.foresightTrend.findMany({ where: { dealId, trendSetId: set.id }, orderBy: { ordinal: 'asc' } });
        const baseline = this.baselineLine(set, trends);
        lines.push({ ...baseline, projection: this.project(baseline, start) });
        const scenarios = await tx.foresightScenario.findMany({ where: { dealId, trendSetId: set.id }, orderBy: { createdAt: 'asc' } });
        for (const scenario of scenarios) {
          const line = this.scenarioLine(baseline, scenario);
          lines.push({ ...line, projection: this.project(line, start) });
        }
      }
      const questions = await tx.foresightQuestion.findMany({ where: { dealId }, orderBy: { askedAt: 'desc' }, take: 20 });
      const names = new Map(lines.filter((line) => line.id).map((line) => [line.id as string, line.name]));
      const { pack } = await this.pack(tx, dealId);
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { baseCurrency: true } });
      const [baselineRow, rows] = await Promise.all([
        tx.foresightBaseline.findFirst({ where: { dealId } }),
        tx.foresightForecast.findMany({ where: { dealId }, orderBy: [{ metricKey: 'asc' }, { version: 'desc' }] }),
      ]);
      const authors = [...new Set(rows.map((row) => row.createdBy).filter((id): id is string => id !== null))];
      const users = authors.length ? await tx.user.findMany({ where: { id: { in: authors } }, select: { id: true, displayName: true } }) : [];
      const forecasts = forecastsView({
        pack,
        currency: deal?.baseCurrency ?? null,
        baseline: baselineRow,
        rows,
        names: new Map(users.map((user) => [user.id, user.displayName])),
        start,
        baseGrowth: set ? set.baseGrowth.toFixed() : '0.10',
        now: new Date(),
      });
      return {
        baseline: set ? { id: set.id, asOf: set.asOf.toISOString().slice(0, 10), modelId: set.modelId, promptVersion: `${set.promptId}@${set.promptVersion}` } : null,
        forecasts,
        lines,
        projectionUnavailable: start ? null : 'Run a valuation scenario (or record the asking price) to project value.',
        questions: questions.map((question) => ({
          id: question.id,
          via: question.via as 'TEXT' | 'VOICE',
          question: question.question,
          answer: question.answer,
          reliesOn: question.reliesOn,
          askedAt: question.askedAt.toISOString(),
          scenarioName: question.scenarioId ? (names.get(question.scenarioId) ?? null) : null,
        })),
        canEdit: canWrite(role),
        ai: { enabled: this.deps.aiEnabled },
        voice: { speechToText: this.deps.speechToText.available, textToSpeech: this.deps.textToSpeech.available },
      };
    });
  }

  /** Ask the model for this deal's baseline trend set: the generic questions plus the pack's own. */
  async generate(tenant: TenantContext, dealId: string, requestId: string): Promise<ForesightView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.generated', requestId });
    await this.generateTrendSet(tenant, dealId, requestId);
    return this.view(tenant, dealId, requestId);
  }

  /** Ask the model for the trend set (no access check: callers check). */
  private async generateTrendSet(tenant: TenantContext, dealId: string, requestId: string): Promise<void> {
    const { pack, companyType, deal } = await withTenant(this.prisma, tenant, async (tx) => ({
      ...(await this.pack(tx, dealId)),
      deal: await tx.deal.findFirst({ where: { id: dealId }, select: { targetName: true, baseCurrency: true } }),
    }));
    if (!deal) throw new NotFoundException();
    const definitions = trendDefinitionsFor(pack);
    const asOf = new Date().toISOString().slice(0, 10);
    let response;
    try {
      response = await this.deps.gateway.invoke(foresightTrendsPrompt, {
        organizationId: tenant.organizationId,
        dealId,
        inputs: [
          // Sector and currency only: no deal documents, findings or people data reach the model here.
          { name: 'deal', classification: 'BUSINESS', text: `Sector: ${companyType ? COMPANY_TYPE_LABELS[companyType] : 'Software & SaaS'}. Reporting currency: ${deal.baseCurrency}.` },
          { name: 'asOf', classification: 'PUBLIC', text: asOf },
          { name: 'questions', classification: 'PUBLIC', text: definitions.map((definition) => `${definition.key}: ${definition.question}`).join('\n') },
        ],
      });
    } catch (error) {
      aiFailure(error);
    }
    await withTenant(this.prisma, tenant, async (tx) => this.recordRun(tx, response.run));
    if (response.status === 'PROVIDER_ERROR') throw providerUnavailable(response.providerError);
    if (!response.output) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE' });
    // Keep only answers to the questions asked, once each; anything else is ignored.
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const answers = response.output.trends.filter((trend, index, all) => byKey.has(trend.key) && all.findIndex((other) => other.key === trend.key) === index);
    if (answers.length === 0) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE' });
    await withTenant(this.prisma, tenant, async (tx) => {
      const set = await tx.foresightTrendSet.create({
        data: { organizationId: tenant.organizationId, dealId, asOf: new Date(`${asOf}T00:00:00Z`), modelId: response.run.resolvedModelId, promptId: foresightTrendsPrompt.id, promptVersion: foresightTrendsPrompt.version, aiRunId: response.run.id, createdBy: tenant.userId },
      });
      await tx.foresightTrend.createMany({
        data: answers.map((answer, ordinal) => {
          const definition = byKey.get(answer.key) as TrendDefinition;
          return { organizationId: tenant.organizationId, dealId, trendSetId: set.id, ordinal, key: definition.key, label: definition.label, category: definition.category, direction: answer.direction, magnitude: answer.magnitude, confidence: answer.confidence, narrative: answer.narrative, effects: definition.effects as unknown as object };
        }),
      });
      await this.audit(tx, tenant, dealId, 'foresight.generated', 'foresight_trend_set', set.id, requestId);
    });
  }

  // --- Numeric forecasts (T-094 B10) -------------------------------------------

  /**
   * Start a background refresh of the published and AI forecasts (and the AI
   * trend lines, if there are none) when the baseline is missing, older than
   * 30 days, failed a while ago, or a previous run was lost. Returns at once.
   */
  private async ensureBaseline(tenant: TenantContext, dealId: string, requestId: string): Promise<void> {
    const now = Date.now();
    const claimed = await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.foresightBaseline.findFirst({ where: { dealId } });
      if (row) {
        if (row.status === 'RUNNING' && now - row.startedAt.getTime() < BASELINE_STALE_RUN_MS) return false;
        if (row.status !== 'RUNNING' && row.finishedAt) {
          const age = now - row.finishedAt.getTime();
          if (row.status === 'FAILED' ? age < BASELINE_STALE_RUN_MS : age < BASELINE_MAX_AGE_MS) return false;
        }
        const { count } = await tx.foresightBaseline.updateMany({ where: { id: row.id, startedAt: row.startedAt }, data: { status: 'RUNNING', startedAt: new Date(now), finishedAt: null, notes: [] } });
        return count === 1;
      }
      try {
        await tx.foresightBaseline.create({ data: { organizationId: tenant.organizationId, dealId, status: 'RUNNING', startedAt: new Date(now) } });
        return true;
      } catch {
        return false; // Another request claimed it first.
      }
    });
    if (claimed) {
      const run = this.refreshBaseline(tenant, dealId, requestId).finally(() => this.running.delete(run));
      this.running.add(run);
    }
  }

  private readonly running = new Set<Promise<void>>();

  /** Resolves when every background refresh started so far has finished (tests and graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  /** Start the baseline right after a pact is created, so Foresight opens populated. */
  async requestBaseline(tenant: TenantContext, dealId: string, requestId: string): Promise<{ status: string }> {
    await this.access.require(tenant, dealId, canRead, { action: 'foresight.baseline_requested', requestId });
    await this.ensureBaseline(tenant, dealId, requestId);
    const row = await withTenant(this.prisma, tenant, (tx) => tx.foresightBaseline.findFirst({ where: { dealId }, select: { status: true } }));
    return { status: row?.status ?? 'NONE' };
  }

  private async refreshBaseline(tenant: TenantContext, dealId: string, requestId: string): Promise<void> {
    const notes: string[] = [];
    let filled = 0;
    try {
      const { pack, companyType, deal } = await withTenant(this.prisma, tenant, async (tx) => ({
        ...(await this.pack(tx, dealId)),
        deal: await tx.deal.findFirst({ where: { id: dealId }, select: { baseCurrency: true } }),
      }));
      if (!deal) throw new NotFoundException();
      const metrics = foresightMetricsFor(pack);
      const years = forecastYears(new Date());
      const area = macroAreaFor(deal.baseCurrency);
      const published: string[] = [];

      // 1. Published forecasts (IMF WEO) for the macro metrics.
      for (const metric of metrics) {
        if (!metric.external) continue;
        if (!area) {
          notes.push(`No published ${metric.label.toLowerCase()} forecast for ${deal.baseCurrency}; the AI forecast is used.`);
          continue;
        }
        const result = await this.deps.macroForecasts.forecast(metric.external, area, years);
        if (result.status !== 'OK' || years.some((year) => result.series.values[year] === undefined)) {
          notes.push(`The published ${metric.label.toLowerCase()} forecast could not be fetched; it will be tried again later.`);
          continue;
        }
        const values = years.map((year) => result.series.values[year] as string);
        published.push(`${metric.key}: ${years.map((year, index) => `${year} ${values[index]}%`).join(', ')} (${result.series.sourceName})`);
        await this.saveForecast(tenant, dealId, { metricKey: metric.key, source: 'EXTERNAL', firstYear: years[0] as number, values, sourceName: result.series.sourceName, sourceUrl: result.series.sourceUrl, sourceAsOf: result.series.asOf, createdBy: null });
        filled += 1;
      }

      // 2. AI forecasts for every metric, with the published figures as context.
      if (!this.deps.aiEnabled) {
        notes.push('AI is off in this environment: AI forecasts appear once it is switched on.');
      } else {
        try {
          const response = await this.deps.gateway.invoke(foresightForecastPrompt, {
            organizationId: tenant.organizationId,
            dealId,
            inputs: [
              // Sector, currency and public figures only: no deal documents, findings or people data reach the model.
              { name: 'deal', classification: 'BUSINESS', text: `Sector: ${companyType ? COMPANY_TYPE_LABELS[companyType] : 'Software & SaaS'}. Reporting currency: ${deal.baseCurrency}. Economy: ${area ?? 'not mapped'}.` },
              { name: 'published', classification: 'PUBLIC', text: published.join('\n') || 'None.' },
              { name: 'years', classification: 'PUBLIC', text: `${years[0]}–${years[4]}` },
              { name: 'metrics', classification: 'PUBLIC', text: metrics.map((metric) => `${metric.key}: ${metric.label} (percent a year)`).join('\n') },
            ],
          });
          await withTenant(this.prisma, tenant, (tx) => this.recordRun(tx, response.run));
          const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
          const answers = (response.output?.metrics ?? []).filter((answer, index, all) => byKey.has(answer.key) && all.findIndex((other) => other.key === answer.key) === index);
          for (const answer of answers) {
            await this.saveForecast(tenant, dealId, {
              metricKey: answer.key,
              source: 'AI',
              firstYear: years[0] as number,
              values: answer.values.map((value) => value.toFixed(2)),
              rationale: answer.rationale,
              modelId: response.run.resolvedModelId,
              promptId: foresightForecastPrompt.id,
              promptVersion: foresightForecastPrompt.version,
              aiRunId: response.run.id,
              createdBy: null,
            });
            filled += 1;
          }
          if (answers.length < metrics.length) notes.push('The AI did not forecast every metric; missing ones use the published forecast or the neutral level.');
        } catch {
          notes.push('The AI forecast could not be made just now; it will be tried again later.');
        }

        // 3. The AI trend lines Foresight's scenarios and questions build on, if there are none yet.
        const hasTrends = await withTenant(this.prisma, tenant, (tx) => tx.foresightTrendSet.findFirst({ where: { dealId }, select: { id: true } }));
        if (!hasTrends) {
          try {
            await this.generateTrendSet(tenant, dealId, requestId);
          } catch {
            notes.push('The AI trend lines could not be made just now; they will be tried again later.');
          }
        }
      }
    } catch {
      notes.push('The forecasts could not be refreshed; they will be tried again later.');
    }
    const status = notes.length === 0 ? 'READY' : filled > 0 ? 'PARTIAL' : 'FAILED';
    await withTenant(this.prisma, tenant, (tx) => tx.foresightBaseline.updateMany({ where: { dealId }, data: { status, notes, finishedAt: new Date() } })).catch(() => undefined);
  }

  /** Append a forecast version; an unchanged EXTERNAL or AI series is not stored twice. */
  private async saveForecast(
    tenant: TenantContext,
    dealId: string,
    input: {
      metricKey: string;
      source: 'EXTERNAL' | 'AI' | 'USER';
      firstYear: number;
      values: string[];
      sourceName?: string | null;
      sourceUrl?: string | null;
      sourceAsOf?: string | null;
      rationale?: string | null;
      modelId?: string | null;
      promptId?: string | null;
      promptVersion?: string | null;
      aiRunId?: string | null;
      createdBy: string | null;
    },
  ): Promise<string | null> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const last = await tx.foresightForecast.findFirst({ where: { dealId, metricKey: input.metricKey, source: input.source }, orderBy: { version: 'desc' } });
      if (
        last &&
        input.source !== 'USER' &&
        last.firstYear === input.firstYear &&
        last.values.map((value) => value.toString()).join() === input.values.map((value) => new D(value).toString()).join()
      )
        return null;
      const row = await tx.foresightForecast.create({
        data: {
          organizationId: tenant.organizationId,
          dealId,
          metricKey: input.metricKey,
          source: input.source,
          version: (last?.version ?? 0) + 1,
          firstYear: input.firstYear,
          values: input.values,
          sourceName: input.sourceName ?? null,
          sourceUrl: input.sourceUrl ?? null,
          sourceAsOf: input.sourceAsOf ? new Date(`${input.sourceAsOf}T00:00:00Z`) : null,
          rationale: input.rationale ?? null,
          modelId: input.modelId ?? null,
          promptId: input.promptId ?? null,
          promptVersion: input.promptVersion ?? null,
          aiRunId: input.aiRunId ?? null,
          createdBy: input.createdBy,
        },
      });
      return row.id;
    });
  }

  /** The user's own five-year path for one metric, kept as a new version. */
  async saveUserForecast(tenant: TenantContext, dealId: string, input: ForesightUserForecastInput, requestId: string): Promise<ForesightView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.user_forecast_saved', requestId });
    const { pack } = await withTenant(this.prisma, tenant, (tx) => this.pack(tx, dealId));
    if (!foresightMetricsFor(pack).some((metric) => metric.key === input.metricKey)) throw new UnprocessableEntityException({ code: 'UNKNOWN_METRIC' });
    const id = await this.saveForecast(tenant, dealId, { metricKey: input.metricKey, source: 'USER', firstYear: forecastYears(new Date())[0] as number, values: input.values, createdBy: tenant.userId });
    if (id) await withTenant(this.prisma, tenant, (tx) => this.audit(tx, tenant, dealId, 'foresight.user_forecast_saved', 'foresight_forecast', id, requestId));
    return this.view(tenant, dealId, requestId);
  }

  private async requireBaseline(tx: TransactionClient, dealId: string) {
    const set = await tx.foresightTrendSet.findFirst({ where: { dealId }, orderBy: { createdAt: 'desc' } });
    if (!set) throw new ConflictException({ code: 'NO_BASELINE' });
    return set;
  }

  private async validateOverrides(tx: TransactionClient, dealId: string, trendSetId: string, input: ForesightScenarioInput) {
    const keys = new Set((await tx.foresightTrend.findMany({ where: { dealId, trendSetId }, select: { key: true } })).map((trend) => trend.key));
    if (Object.keys(input.overrides).some((key) => !keys.has(key))) throw new UnprocessableEntityException({ code: 'UNKNOWN_TREND' });
    if (new Set(input.customTrends.map((trend) => trend.key)).size !== input.customTrends.length) throw new UnprocessableEntityException({ code: 'DUPLICATE_TREND' });
  }

  async createScenario(tenant: TenantContext, dealId: string, input: ForesightScenarioInput, requestId: string): Promise<ForesightView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.scenario_created', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const set = await this.requireBaseline(tx, dealId);
      await this.validateOverrides(tx, dealId, set.id, input);
      const scenario = await tx.foresightScenario.create({
        data: { organizationId: tenant.organizationId, dealId, trendSetId: set.id, name: input.name, baseGrowth: input.baseGrowth, baseMargin: input.baseMargin, overrides: input.overrides, customTrends: input.customTrends, createdBy: tenant.userId, updatedBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'foresight.scenario_created', 'foresight_scenario', scenario.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async updateScenario(tenant: TenantContext, dealId: string, scenarioId: string, input: UpdateForesightScenarioInput, requestId: string): Promise<ForesightView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.scenario_updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const scenario = await tx.foresightScenario.findFirst({ where: { id: scenarioId, dealId } });
      if (!scenario) throw new NotFoundException();
      await this.validateOverrides(tx, dealId, scenario.trendSetId, input);
      const { count } = await tx.foresightScenario.updateMany({
        where: { id: scenarioId, dealId, version: input.expectedVersion },
        data: { name: input.name, baseGrowth: input.baseGrowth, baseMargin: input.baseMargin, overrides: input.overrides, customTrends: input.customTrends, version: input.expectedVersion + 1, updatedBy: tenant.userId, updatedAt: new Date() },
      });
      if (count !== 1) throw new ConflictException();
      await this.audit(tx, tenant, dealId, 'foresight.scenario_updated', 'foresight_scenario', scenarioId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  // --- Q&A --------------------------------------------------------------------

  /** A grounded answer from the trend lines, assumptions and projection of one line (baseline or a scenario). */
  async ask(tenant: TenantContext, dealId: string, input: ForesightQuestionInput, requestId: string, via: 'TEXT' | 'VOICE' = 'TEXT'): Promise<ForesightAnswerView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.question_asked', requestId });
    const view = await this.view(tenant, dealId, requestId);
    const line = input.scenarioId ? view.lines.find((candidate) => candidate.id === input.scenarioId) : view.lines.find((candidate) => candidate.kind === 'BASELINE');
    if (!line) throw (input.scenarioId ? new NotFoundException() : new ConflictException({ code: 'NO_BASELINE' }));
    const context = {
      line: line.name,
      asOf: view.baseline?.asOf,
      assumptions: line.projection?.assumptions ?? { baseGrowth: line.baseGrowth, baseMargin: line.baseMargin },
      trends: line.trends.map(({ key, label, direction, magnitude, confidence, narrative, provenance, weight }) => ({ key, label, direction, magnitude, confidence, narrative, provenance, weight })),
      impacts: line.projection?.impacts.map(({ trendKey, explanation }) => ({ trendKey, explanation })) ?? [],
      projectedValue: line.projection ? { currency: line.projection.currency, path: line.projection.path, topDrivers: line.projection.sensitivity.slice(0, 5) } : null,
    };
    let response;
    try {
      response = await this.deps.gateway.invoke(foresightQaPrompt, {
        organizationId: tenant.organizationId,
        dealId,
        inputs: [
          { name: 'context', classification: 'BUSINESS', text: JSON.stringify(context) },
          { name: 'question', classification: 'BUSINESS', text: input.question },
        ],
      });
    } catch (error) {
      aiFailure(error);
    }
    await withTenant(this.prisma, tenant, async (tx) => this.recordRun(tx, response.run));
    if (response.status === 'PROVIDER_ERROR') throw providerUnavailable(response.providerError);
    // An answer must name what it relies on, from this line only: trend keys or assumption names.
    const allowed = new Set<string>([...line.trends.map((trend) => trend.key), ...ASSUMPTION_NAMES]);
    const reliesOn = [...new Set(response.output?.reliesOn ?? [])].filter((key) => allowed.has(key));
    if (!response.output || reliesOn.length === 0) throw new UnprocessableEntityException({ code: 'UNGROUNDED_ANSWER' });
    const answer = response.output.answer;
    const saved = await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.foresightQuestion.create({
        data: { organizationId: tenant.organizationId, dealId, scenarioId: input.scenarioId, via, question: input.question, answer, reliesOn, aiRunId: response.run.id, askedBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'foresight.question_asked', 'foresight_question', row.id, requestId);
      return row;
    });
    let audio: string | null = null;
    if (input.speak && this.deps.textToSpeech.available) {
      try {
        audio = Buffer.from(await this.deps.textToSpeech.speak(answer)).toString('base64');
      } catch {
        audio = null; // the text answer stands
      }
    }
    return { id: saved.id, question: input.question, answer, reliesOn, audio };
  }

  /** A spoken question: transcribed in memory (the audio is discarded), then answered like a typed one. */
  async askByVoice(tenant: TenantContext, dealId: string, input: ForesightVoiceQuestionInput, requestId: string): Promise<ForesightAnswerView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'foresight.question_asked', requestId });
    if (!this.deps.speechToText.available) throw new ServiceUnavailableException({ code: 'VOICE_UNAVAILABLE' });
    let transcript: string;
    try {
      transcript = await this.deps.speechToText.transcribe(new Uint8Array(Buffer.from(input.audio, 'base64')), input.sampleRate);
    } catch (error) {
      if (error instanceof VoiceUnavailableError) throw new ServiceUnavailableException({ code: 'VOICE_UNAVAILABLE' });
      throw new ServiceUnavailableException({ code: 'VOICE_FAILED' });
    }
    if (transcript.trim().length < 3) throw new UnprocessableEntityException({ code: 'NOTHING_HEARD' });
    return this.ask(tenant, dealId, { question: transcript.slice(0, 1000), scenarioId: input.scenarioId, speak: input.speak }, requestId, 'VOICE');
  }
}
