import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { aiModels, OperatorRequiredError, prismaExecutor, type AiAlias, type AiProvider, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { evaluationRecord } from '../../ai/model-routes';
import type { AiModelsRuntime } from '../../ai/ai-provider';
import { LOGGER, PRISMA } from '../../tokens';

export const AI_MODELS = Symbol('AI_MODELS');

/**
 * AI models in the operator console (T-130): the catalog, the evaluation gate, the platform
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

  catalog(tenant: TenantContext) {
    return this.asOperator(async () => {
      const models = await aiModels.list(this.sql, tenant.userId);
      return {
        // Which providers this deployment can call; others arrive with their transports (ADR 0029).
        providers: this.runtime?.providers ?? [],
        aiOn: this.runtime !== null,
        models: models.map((model) => ({ ...model, evaluatingSince: model.evaluatingSince?.toISOString() ?? null, createdAt: model.createdAt.toISOString() })),
      };
    });
  }

  add(tenant: TenantContext, input: { provider: AiProvider; providerModelId: string; label: string }) {
    return this.asOperator(async () => {
      if (!this.runtime?.providers.includes(input.provider)) throw new UnprocessableEntityException({ code: 'PROVIDER_NOT_AVAILABLE' });
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
          await aiModels.recordEvaluation(this.sql, tenant.userId, modelId, evaluationRecord(report));
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

  setPlatformRoute(tenant: TenantContext, alias: AiAlias, modelId: string) {
    return this.asOperator(async () => {
      if (!(await aiModels.setPlatformRoute(this.sql, tenant.userId, alias, modelId))) throw new UnprocessableEntityException({ code: 'NOT_EVALUATED' });
      this.changed();
      return { alias, modelId };
    });
  }

  organizationModels(tenant: TenantContext, organizationId: string) {
    return this.asOperator(() => aiModels.organizationModels(this.sql, tenant.userId, organizationId));
  }

  setOrganizationModels(tenant: TenantContext, organizationId: string, input: { allowed: string[]; routes: Partial<Record<AiAlias, string>> }) {
    return this.asOperator(async () => {
      const outcome = await aiModels.setOrganizationModels(this.sql, tenant.userId, organizationId, input);
      if (outcome === 'NOT_FOUND') throw new NotFoundException();
      if (outcome !== 'SAVED') throw new UnprocessableEntityException({ code: outcome });
      this.changed();
      return aiModels.organizationModels(this.sql, tenant.userId, organizationId);
    });
  }
}
