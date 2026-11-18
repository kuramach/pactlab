import { defaultPromptRegistry, JOB_MODEL_MAP, modelLabel, parseJobOverride, TransportClaudeGateway, type JobType, type ModelAlias, type ModelProvider, type ModelRoute, type ModelTransport } from '@pactlab/ai';
import { judgeModel, runDocumentEvals, type EvalReport } from '@pactlab/ai/evals';
import { aiModels, prismaExecutor, type AiEvaluation, type AiRouteKey, type PrismaClient, type SqlExecutor } from '@pactlab/db';

const CACHE_MS = 60_000;

/**
 * Which model serves each alias for each organization (T-131), from the admin console's catalog:
 * the organization's route, else the platform route, only EVALUATED models, only allowed ones.
 * Cached a minute per organization; the console invalidates it on every change. Where the
 * catalog has nothing for an alias, the deployment's configured route serves (AI never goes dark).
 */
export class ModelRouteResolver {
  private readonly sql: SqlExecutor;
  private readonly cache = new Map<string, { at: number; routes: Map<AiRouteKey, { route: ModelRoute; label: string } | 'BLOCKED'> }>();
  private readonly usable = new Map<string, { at: number; ok: boolean }>();
  private readonly spend = new Map<string, { at: number; usd: number }>();

  constructor(
    prisma: PrismaClient,
    /** The deployment's configured routes: effort per alias, the evaluated fallback, and the default. */
    private readonly configured: Readonly<Record<ModelAlias, ModelRoute>>,
    private readonly now: () => number = Date.now,
    /** Best-of-breed routing (T-132): the connected providers, `MODEL_JOB_<JOB>` overrides, and the per-pact cost ceiling. */
    private readonly routing: { providers: readonly ModelProvider[]; jobOverrides?: Partial<Record<JobType, string>>; ceilingUsd?: number | null } = { providers: [] },
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
    const chosen = await this.describe(organizationId, alias);
    return chosen === 'BLOCKED' || chosen === null ? chosen : chosen.route;
  }

  /** The route with the catalog's name for the model (what users see); null: the configured route serves. */
  async describe(organizationId: string, alias: AiRouteKey): Promise<{ route: ModelRoute; label: string } | null | 'BLOCKED'> {
    let entry = this.cache.get(organizationId);
    if (!entry || this.now() - entry.at > CACHE_MS) {
      const routes = new Map<AiRouteKey, { route: ModelRoute; label: string } | 'BLOCKED'>();
      for (const row of await aiModels.routesFor(this.sql, organizationId)) {
        if (row.blocked) routes.set(row.alias, 'BLOCKED');
        else if (row.providerModelId && row.provider) routes.set(row.alias, { route: this.route(row.alias, row.provider, row.providerModelId), label: row.label ?? row.providerModelId });
      }
      entry = { at: this.now(), routes };
      this.cache.set(organizationId, entry);
    }
    return entry.routes.get(alias) ?? null;
  }

  /**
   * Best-of-breed routing (T-132): the lanes a job may run on for this organization and pact, best
   * first. In order: the console's route for the job type (organization, then platform), then
   * `MODEL_JOB_<JOB>`, then the registry's chain. A Claude lane is the deployment's Claude route for
   * its alias (as the console sets it); any other lane serves only when its provider is connected and
   * the model is in the catalog, EVALUATED, its terms recorded and allowed for the organization.
   * Over the per-pact cost ceiling, economy lanes go first. 'BLOCKED': the allow-list leaves nothing.
   */
  async lanesFor(request: { organizationId: string; dealId: string; jobType: JobType; alias: ModelAlias }): Promise<ModelRoute[] | 'BLOCKED'> {
    const lanes: { route: ModelRoute; tier: 'flagship' | 'economy' }[] = [];
    let blocked = false;
    const add = (route: ModelRoute, tier: 'flagship' | 'economy') => {
      if (!lanes.some((lane) => lane.route.modelId === route.modelId && (lane.route.provider ?? 'bedrock') === (route.provider ?? 'bedrock'))) lanes.push({ route, tier });
    };
    const job = await this.describe(request.organizationId, request.jobType);
    if (job && job !== 'BLOCKED') add(job.route, 'flagship');
    const override = parseJobOverride(this.routing.jobOverrides?.[request.jobType]);
    const firstEffort = JOB_MODEL_MAP[request.jobType].lanes[0]?.kind === 'model' ? (JOB_MODEL_MAP[request.jobType].lanes[0] as { effort: ModelRoute['effort'] }).effort : this.configured[request.alias].effort;
    if (override && this.routing.providers.includes(override.provider)) add({ modelId: override.modelId, provider: override.provider, effort: firstEffort }, 'flagship');
    for (const lane of JOB_MODEL_MAP[request.jobType].lanes) {
      if (lane.kind === 'claude') {
        const chosen = await this.describe(request.organizationId, lane.alias);
        if (chosen === 'BLOCKED') {
          blocked = true;
          continue;
        }
        add(chosen?.route ?? this.configured[lane.alias], lane.tier);
      } else if (this.routing.providers.includes(lane.provider) && (await this.modelUsable(request.organizationId, lane.provider, lane.modelId))) {
        add({ modelId: lane.modelId, provider: lane.provider, effort: lane.effort }, lane.tier);
      }
    }
    if (lanes.length === 0) return blocked ? 'BLOCKED' : [this.configured[request.alias]];
    const ceiling = this.routing.ceilingUsd;
    if (ceiling && (await this.dealSpend(request.organizationId, request.dealId)) >= ceiling) {
      // Over the ceiling: never a flagship lane while an economy one is available (stable within each tier).
      return [...lanes.filter((lane) => lane.tier === 'economy'), ...lanes.filter((lane) => lane.tier === 'flagship')].map((lane) => lane.route);
    }
    return lanes.map((lane) => lane.route);
  }

  private async modelUsable(organizationId: string, provider: ModelProvider, modelId: string): Promise<boolean> {
    const key = `${organizationId}|${provider}|${modelId}`;
    const cached = this.usable.get(key);
    if (cached && this.now() - cached.at <= CACHE_MS) return cached.ok;
    const ok = await aiModels.modelUsable(this.sql, organizationId, provider, modelId);
    this.usable.set(key, { at: this.now(), ok });
    return ok;
  }

  private async dealSpend(organizationId: string, dealId: string): Promise<number> {
    const key = `${organizationId}|${dealId}`;
    const cached = this.spend.get(key);
    if (cached && this.now() - cached.at <= CACHE_MS) return cached.usd;
    const usd = await aiModels.dealSpend(this.sql, organizationId, dealId);
    this.spend.set(key, { at: this.now(), usd });
    return usd;
  }

  /** The alias keeps its effort; the evaluated fallback (T-096) applies only to the configured model it was evaluated with. */
  private route(key: AiRouteKey, provider: ModelProvider, modelId: string): ModelRoute {
    // A job type takes the effort of the alias its prompts run on (balanced), or of its own first lane.
    const alias: ModelAlias = key === 'fast' || key === 'balanced' || key === 'deep_review' ? key : key === 'contract_scrub' ? 'deep_review' : 'balanced';
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
    this.usable.clear();
    this.spend.clear();
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
