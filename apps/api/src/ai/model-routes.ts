import { defaultPromptRegistry, modelLabel, TransportClaudeGateway, type ModelAlias, type ModelProvider, type ModelRoute, type ModelTransport } from '@pactlab/ai';
import { judgeModel, runDocumentEvals, type EvalReport } from '@pactlab/ai/evals';
import { aiModels, prismaExecutor, type AiEvaluation, type PrismaClient, type SqlExecutor } from '@pactlab/db';

const CACHE_MS = 60_000;

/**
 * Which model serves each alias for each organization (T-130), from the admin console's catalog:
 * the organization's route, else the platform route, only EVALUATED models, only allowed ones.
 * Cached a minute per organization; the console invalidates it on every change. Where the
 * catalog has nothing for an alias, the deployment's configured route serves (AI never goes dark).
 */
export class ModelRouteResolver {
  private readonly sql: SqlExecutor;
  private readonly cache = new Map<string, { at: number; routes: Map<ModelAlias, ModelRoute | 'BLOCKED'> }>();

  constructor(
    prisma: PrismaClient,
    /** The deployment's configured routes: effort per alias, the evaluated fallback, and the default. */
    private readonly configured: Readonly<Record<ModelAlias, ModelRoute>>,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  /** Bring the deployment's configured models into an empty catalog (EVALUATED: they serve today). */
  async adopt(provider: ModelProvider): Promise<number> {
    return aiModels.adoptRoutes(
      this.sql,
      (Object.keys(this.configured) as ModelAlias[]).map((alias) => ({ alias, provider, modelId: this.configured[alias].modelId, label: modelLabel(this.configured[alias].modelId) })),
    );
  }

  async routeFor(organizationId: string, alias: ModelAlias): Promise<ModelRoute | null | 'BLOCKED'> {
    let entry = this.cache.get(organizationId);
    if (!entry || this.now() - entry.at > CACHE_MS) {
      const routes = new Map<ModelAlias, ModelRoute | 'BLOCKED'>();
      for (const row of await aiModels.routesFor(this.sql, organizationId)) {
        if (row.blocked) routes.set(row.alias, 'BLOCKED');
        else if (row.providerModelId && row.provider) routes.set(row.alias, this.route(row.alias, row.provider, row.providerModelId));
      }
      entry = { at: this.now(), routes };
      this.cache.set(organizationId, entry);
    }
    return entry.routes.get(alias) ?? null;
  }

  /** The alias keeps its effort; the evaluated fallback (T-096) applies only to the configured model it was evaluated with. */
  private route(alias: ModelAlias, provider: ModelProvider, modelId: string): ModelRoute {
    const configured = this.configured[alias];
    return {
      modelId,
      provider,
      effort: configured.effort,
      ...(configured.fallbackModelId && modelId === configured.modelId && provider === (configured.provider ?? 'bedrock') ? { fallbackModelId: configured.fallbackModelId } : {}),
    };
  }

  invalidate(): void {
    this.cache.clear();
  }
}

/** Runs the evaluation suite against one model; null where AI is off. */
export type ModelEvaluator = (model: { provider: ModelProvider; providerModelId: string }) => Promise<EvalReport>;

/**
 * The evaluator for this deployment: live, the synthetic golden set and injection probes sent to
 * that model through the deployment's transport (no deal data, ever); with the fixture provider,
 * the recorded cassettes (tests and local runs make no model call).
 */
export function modelEvaluator(transport: ModelTransport | null, configured: Readonly<Record<ModelAlias, ModelRoute>>): ModelEvaluator {
  if (!transport) return () => runDocumentEvals();
  return (model) => {
    const routes = Object.fromEntries((Object.keys(configured) as ModelAlias[]).map((alias) => [alias, { modelId: model.providerModelId, provider: model.provider, effort: configured[alias].effort }])) as Record<ModelAlias, ModelRoute>;
    return runDocumentEvals({ live: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry(), routes }) });
  };
}

/** What is stored with the model: the scores, the verdict and the prompt hashes it ran against. */
export function evaluationRecord(report: EvalReport): AiEvaluation {
  const verdict = judgeModel(report);
  const registry = defaultPromptRegistry();
  return {
    passed: verdict.passed,
    goldenPassed: report.golden.filter((row) => row.passed).length,
    goldenTotal: report.golden.length,
    probesBlocked: report.probesBlocked,
    probesTotal: report.probes.length,
    citationRecall: report.citationRecall,
    citationPrecision: report.citationPrecision,
    promptHashes: Object.fromEntries(registry.list().map((prompt) => [`${prompt.id}@${prompt.version}`, prompt.hash])),
    ranAt: new Date().toISOString(),
    ...(verdict.failures.length > 0 ? { failures: verdict.failures.slice(0, 20) } : {}),
  };
}
