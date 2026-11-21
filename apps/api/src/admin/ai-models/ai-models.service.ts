import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { aiModels, OperatorRequiredError, prismaExecutor, type AiProvider, type AiRouteKey, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { defaultPromptRegistry, matchesPick, SCORECARD, SCORECARD_AS_OF, SCORECARD_SOURCE, type BedrockCatalogEntry } from '@pactlab/ai';
import type { AiModelsRuntime } from '../../ai/ai-provider';
import { LOGGER, PRISMA } from '../../tokens';

export const AI_MODELS = Symbol('AI_MODELS');

/** True when any prompt in use has changed (or is new) since an evaluation that recorded its prompt hashes. */
export function staleOn(evaluated: Record<string, string> | undefined): boolean {
  if (!evaluated) return false;
  return defaultPromptRegistry()
    .list()
    .some((prompt) => evaluated[`${prompt.id}@${prompt.version}`] !== prompt.hash);
}

/**
 * AI models in the operator console (T-131): the catalog, the evaluation gate, the platform
 * routes and each organization's allow-list. Every action is checked and audited by the
 * `app_ops_ai_*` functions; every change clears the route cache so it applies within the request.
 */
@Injectable()
export class AiModelsService {
  private readonly sql: SqlExecutor;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(AI_MODELS) private readonly runtime: AiModelsRuntime | null,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  private async asOperator<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OperatorRequiredError) throw new ForbiddenException();
      throw error;
    }
  }

  // Refusals are 422 with a stable code (the problem-details filter passes those through).

  private changed(): void {
    this.runtime?.resolver.invalidate();
  }

  /** The platform routing diagram (Admin → AI models): every job's lanes with no organization's choices. */
  routing(tenant: TenantContext) {
    return this.asOperator(async () => {
      const models = await aiModels.list(this.sql, tenant.userId);
      return {
        enabled: this.runtime !== null,
        choices: models.filter((model) => model.status === 'EVALUATED').map((model) => ({ id: model.id, provider: model.provider, providerModelId: model.providerModelId, label: model.label })),
        routing: this.runtime ? await this.runtime.resolver.describeJobs(null) : null,
      };
    });
  }

  catalog(tenant: TenantContext) {
    return this.asOperator(async () => {
      const models = await aiModels.list(this.sql, tenant.userId);
      const terms = await aiModels.providerTerms(this.sql, tenant.userId);
      return {
        // Data terms of providers outside AWS (ADR 0034): their models serve only when both are recorded.
        terms: terms.map((entry) => ({ ...entry, recordedAt: entry.recordedAt.toISOString(), cleared: entry.dpaInPlace && entry.zeroRetention })),
        // Which providers this deployment can call; others arrive with their transports (ADR 0034).
        providers: this.runtime?.providers ?? [],
        aiOn: this.runtime !== null,
        models: models.map((model) => ({
          ...model,
          evaluatingSince: model.evaluatingSince?.toISOString() ?? null,
          createdAt: model.createdAt.toISOString(),
          // A prompt changed since the model was evaluated: it keeps serving, and the console asks for a fresh evaluation.
          // A health check doesn't depend on prompt versions; only older full evaluations can fall due.
          reevaluationDue: model.status === 'EVALUATED' && model.evaluation?.kind !== 'health' && staleOn(model.evaluation?.promptHashes),
        })),
      };
    });
  }

  /**
   * Add from Bedrock, led by the model scorecard (docs/model-scorecard.md): per job, the scorecard's picks
   * with their board score and cost per task, each marked in use, available on this account's Bedrock, or
   * not on Bedrock; then every other model Bedrock lists, minus those already in the catalog.
   */
  bedrockModels(tenant: TenantContext) {
    return this.asOperator(async () => {
      const catalogModels = (await aiModels.list(this.sql, tenant.userId)).filter((m) => m.status !== 'RETIRED');
      const inCatalog = new Set(catalogModels.filter((m) => m.provider === 'bedrock').map((m) => m.providerModelId));
      const catalog = this.runtime?.bedrock ?? null;
      let listed: BedrockCatalogEntry[] = [];
      if (catalog) {
        try {
          listed = await catalog.list();
        } catch (error) {
          this.logger.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'bedrock model list failed');
          throw new ServiceUnavailableException({ code: 'BEDROCK_LIST_FAILED' });
        }
      }
      const picked = new Set<string>();
      const scorecard = SCORECARD.map((entry) => ({
        ...entry,
        picks: entry.picks.map((pick) => {
          const inUse = catalogModels.find((m) => matchesPick(pick, { modelId: m.providerModelId, name: m.label }));
          const onBedrock = listed.find((model) => matchesPick(pick, model));
          if (onBedrock) picked.add(onBedrock.modelId);
          return { ...pick, inUse: inUse ? { id: inUse.id, ready: inUse.status === 'EVALUATED' } : null, bedrockModelId: inUse ? null : (onBedrock?.modelId ?? null) };
        }),
      }));
      return {
        connected: catalog !== null,
        scorecard: { asOf: SCORECARD_AS_OF, source: SCORECARD_SOURCE, jobs: scorecard },
        items: listed.filter((model) => !inCatalog.has(model.modelId) && !picked.has(model.modelId)),
      };
    });
  }

  /** Use a Bedrock model: it joins the catalog and its health check starts (seconds); once it passes, pick it in the diagram. */
  useBedrockModel(tenant: TenantContext, modelId: string) {
    return this.asOperator(async () => {
      const catalog = this.runtime?.bedrock ?? null;
      const model = catalog ? (await catalog.list()).find((entry) => entry.modelId === modelId) : undefined;
      // Only a model Bedrock lists for this account: no free-typed IDs.
      if (!model) throw new UnprocessableEntityException({ code: 'NOT_ON_BEDROCK' });
      const existing = (await aiModels.list(this.sql, tenant.userId)).find((m) => m.provider === 'bedrock' && m.providerModelId === modelId);
      const id = existing && existing.status !== 'RETIRED' ? existing.id : (await this.add(tenant, { provider: 'bedrock', providerModelId: modelId, label: `${model.name}` })).id;
      await this.evaluate(tenant, id);
      return { id };
    });
  }

  add(tenant: TenantContext, input: { provider: AiProvider; providerModelId: string; label: string }) {
    return this.asOperator(async () => {
      if (!this.runtime?.providers.includes(input.provider)) throw new UnprocessableEntityException({ code: 'PROVIDER_NOT_AVAILABLE' });
      // Claude's Bedrock IDs write versions with dashes (claude-opus-5-5); `claude-opus-5.5` is a typo that would only fail evaluation.
      if (input.provider === 'bedrock' && /anthropic\.claude-[a-z]+-\d+\.\d/.test(input.providerModelId)) throw new UnprocessableEntityException({ code: 'BEDROCK_ID_FORMAT' });
      try {
        return { id: await aiModels.add(this.sql, tenant.userId, input) };
      } catch (error) {
        // 23505: the provider already has this model in the catalog.
        if ((error as { meta?: { code?: string }; code?: string }).meta?.code === '23505' || /23505|unique/i.test(String((error as Error).message))) throw new UnprocessableEntityException({ code: 'MODEL_EXISTS' });
        throw error;
      }
    });
  }

  /**
   * Starts the evaluation suite against the model, in the background (a few minutes, one call at
   * a time). Only the synthetic golden set and probes are sent. The verdict is stored and audited;
   * a pass makes the model EVALUATED, the only state in which it may serve.
   */
  evaluate(tenant: TenantContext, modelId: string) {
    return this.asOperator(async () => {
      const runtime = this.runtime;
      if (!runtime) throw new ServiceUnavailableException({ code: 'AI_OFF' });
      const model = (await aiModels.list(this.sql, tenant.userId)).find((entry) => entry.id === modelId);
      if (!model) throw new NotFoundException();
      if (!(await aiModels.startEvaluation(this.sql, tenant.userId, modelId))) throw new UnprocessableEntityException({ code: 'EVALUATION_NOT_STARTED' });
      const run = async () => {
        try {
          const report = await runtime.evaluate({ provider: model.provider, providerModelId: model.providerModelId });
          await aiModels.recordEvaluation(this.sql, tenant.userId, modelId, report);
        } catch (error) {
          this.logger.warn({ modelId, errorName: error instanceof Error ? error.name : 'unknown' }, 'model evaluation failed to run');
          await aiModels.recordEvaluation(this.sql, tenant.userId, modelId, {
            passed: false,
            goldenPassed: 0,
            goldenTotal: 0,
            probesBlocked: 0,
            probesTotal: 0,
            citationRecall: 0,
            citationPrecision: 0,
            promptHashes: {},
            ranAt: new Date().toISOString(),
            failures: [`The evaluation could not reach the model (${error instanceof Error ? error.name : 'unknown error'}).`],
          });
        } finally {
          this.changed();
        }
      };
      // handled: the run records its own failure on the model (above); nothing waits for it
      void run().catch((error: unknown) => this.logger.error({ modelId, errorName: error instanceof Error ? error.name : 'unknown' }, 'model evaluation could not be recorded'));
      return { started: true };
    });
  }

  retire(tenant: TenantContext, modelId: string) {
    return this.asOperator(async () => {
      const outcome = await aiModels.retire(this.sql, tenant.userId, modelId);
      if (outcome === 'NOT_FOUND') throw new NotFoundException();
      if (outcome === 'IN_USE') throw new UnprocessableEntityException({ code: 'MODEL_IN_USE' });
      this.changed();
      return { retired: true };
    });
  }

  setPlatformRoute(tenant: TenantContext, alias: AiRouteKey, modelId: string) {
    return this.asOperator(async () => {
      if (!(await aiModels.setPlatformRoute(this.sql, tenant.userId, alias, modelId))) throw new UnprocessableEntityException({ code: 'NOT_EVALUATED' });
      this.changed();
      return { alias, modelId };
    });
  }

  /**
   * Record a provider's data terms (ADR 0034): a data-processing agreement in place and zero
   * retention or training on our requests. With both, its models may be evaluated and serve;
   * withdrawing either stops them at once. Audited.
   */
  setProviderTerms(tenant: TenantContext, terms: { provider: 'anthropic' | 'openai' | 'google'; dpaInPlace: boolean; zeroRetention: boolean; region: string | null; notes: string | null }) {
    return this.asOperator(async () => {
      await aiModels.setProviderTerms(this.sql, tenant.userId, terms);
      this.changed();
      return { cleared: terms.dpaInPlace && terms.zeroRetention };
    });
  }

  clearPlatformRoute(tenant: TenantContext, key: AiRouteKey) {
    return this.asOperator(async () => {
      if (!(await aiModels.clearPlatformRoute(this.sql, tenant.userId, key))) throw new UnprocessableEntityException({ code: 'ROUTE_REQUIRED' });
      this.changed();
      return { alias: key, modelId: null };
    });
  }

  organizationModels(tenant: TenantContext, organizationId: string) {
    return this.asOperator(() => aiModels.organizationModels(this.sql, tenant.userId, organizationId));
  }

  setOrganizationModels(tenant: TenantContext, organizationId: string, input: { allowed: string[]; routes: Partial<Record<AiRouteKey, string>> }) {
    return this.asOperator(async () => {
      const outcome = await aiModels.setOrganizationModels(this.sql, tenant.userId, organizationId, input);
      if (outcome === 'NOT_FOUND') throw new NotFoundException();
      if (outcome !== 'SAVED') throw new UnprocessableEntityException({ code: outcome });
      this.changed();
      return aiModels.organizationModels(this.sql, tenant.userId, organizationId);
    });
  }
}
