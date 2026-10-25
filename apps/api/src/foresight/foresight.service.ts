import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  foresightQaPrompt,
  foresightTrendsPrompt,
  GatewayPolicyError,
  VoiceUnavailableError,
  type AiRunRecord,
  type ClaudeGateway,
  type SpeechToText,
  type TextToSpeech,
} from '@pactlab/ai';
import { projectValue, type ProjectionTrend } from '@pactlab/calculations';
import type {
  ForesightAnswerView,
  ForesightLineView,
  ForesightProjectionView,
  ForesightQuestionInput,
  ForesightScenarioInput,
  ForesightTrendView,
  ForesightView,
  ForesightVoiceQuestionInput,
  UpdateForesightScenarioInput,
} from '@pactlab/contracts';
import { appendAuditEvent, askingPrices, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  COMPANY_TYPE_LABELS,
  permissionsForDealRole,
  trendDefinitionsFor,
  type CompanyType,
  type DealRole,
  type PackId,
  type TenantContext,
  type TrendDefinition,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

export const FORESIGHT_DEPENDENCIES = Symbol('FORESIGHT_DEPENDENCIES');
export interface ForesightDependencies {
  readonly gateway: ClaudeGateway;
  readonly aiEnabled: boolean;
  readonly speechToText: SpeechToText;
  readonly textToSpeech: TextToSpeech;
}

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && role !== 'TARGET_CONTRIBUTOR';

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
      return {
        baseline: set ? { id: set.id, asOf: set.asOf.toISOString().slice(0, 10), modelId: set.modelId, promptVersion: `${set.promptId}@${set.promptVersion}` } : null,
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
