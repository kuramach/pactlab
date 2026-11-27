import { defaultPromptRegistry, JOB_MODEL_MAP, JOB_TYPES, modelLabel as readableModel, parseJobOverride, TransportClaudeGateway, type JobType, type ModelAlias, type ModelProvider, type ModelRoute, type ModelTransport } from '@pactlab/ai';
import { checkModelHealth } from '@pactlab/ai/evals';
import { aiModels, prismaExecutor, type AiEvaluation, type AiRouteKey, type PrismaClient, type SqlExecutor } from '@pactlab/db';

const CACHE_MS = 60_000;
/** The routing view's platform scope: an id no organization has, so only platform routes apply. */
const PLATFORM_SCOPE = '00000000-0000-0000-0000-000000000000';

/**
 * Jobs a console route can be stored for. The product-help chat (T-175) runs on its registry chain only
 * until the route tables list it (packages/db, follow-up T-185).
 */
const storedRouteKey = (jobType: JobType): AiRouteKey | null => (jobType === 'support_chat' ? null : jobType);
const PROVIDER_NAMES: Partial<Record<ModelProvider, string>> = { bedrock: 'AWS Bedrock', anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };

/** Where a choice comes from: this organization, the platform default, or the deployment's own config. */
export type RouteSource = 'ORGANIZATION' | 'PLATFORM' | 'DEPLOYMENT';
/** A job's first lane: chosen in the console (organization or platform), by env (`MODEL_JOB_*`), or the registry chain. */
export type JobSource = 'ORGANIZATION' | 'PLATFORM' | 'DEPLOYMENT' | 'REGISTRY';
export interface RoutingLane {
  readonly provider: ModelProvider;
  readonly modelId: string;
  readonly label: string;
  /** False: the lane is skipped today (reason says why). */
  readonly available: boolean;
  readonly reason: string | null;
}
export interface RoutingView {
  readonly scope: 'PLATFORM' | 'ORGANIZATION';
  readonly roles: readonly { alias: ModelAlias; source: RouteSource; lane: RoutingLane | null }[];
  readonly jobs: readonly { jobType: JobType; label: string; source: JobSource; lanes: readonly RoutingLane[] }[];
}

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
  /**
   * At boot: the deployment's configured model per role goes live (2026-11-20: configured frontier models
   * are trusted; the console's check is a health check, not a gate). Each is in the catalog as serving, and
   * becomes the platform default for its role unless an operator chose that role in the console.
   */
  async adopt(provider: ModelProvider): Promise<void> {
    await aiModels.syncDeployment(
      this.sql,
      (Object.keys(this.configured) as ModelAlias[]).map((alias) => ({ alias, provider, modelId: this.configured[alias].modelId, label: readableModel(this.configured[alias].modelId) })),
    );
    this.invalidate();
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
    const key = storedRouteKey(request.jobType);
    const job = key ? await this.describe(request.organizationId, key) : null;
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

  /**
   * The routing diagram (Admin → AI models, Settings → AI models): every job's lanes as they would
   * resolve now, including the ones that cannot serve and why, and where the first choice comes from.
   * Platform scope (no organization): no allow-list and no organization routes.
   */
  async describeJobs(organizationId: string | null): Promise<RoutingView> {
    const org = organizationId ?? PLATFORM_SCOPE;
    const [orgRoutes, platformRoutes, approved] = await Promise.all([
      organizationId ? aiModels.organizationRouteKeys(this.sql, organizationId) : Promise.resolve(new Set<string>()),
      aiModels.platformRouteKeys(this.sql),
      aiModels.organizationChoices(this.sql, PLATFORM_SCOPE),
    ]);
    // The catalog's names for models (what operators named them), else a readable form of the id.
    const names = new Map(approved.map((model) => [`${model.provider}|${model.providerModelId}`, model.label]));
    const modelLabel = (modelId: string, provider: ModelProvider = 'bedrock') => names.get(`${provider}|${modelId}`) ?? readableModel(modelId);
    const sourceOf = (key: AiRouteKey): RouteSource => (orgRoutes.has(key) ? 'ORGANIZATION' : platformRoutes.has(key) ? 'PLATFORM' : 'DEPLOYMENT');
    const lane = (route: ModelRoute, label: string, available: boolean, reason: string | null): RoutingLane => ({ provider: route.provider ?? 'bedrock', modelId: route.modelId, label, available, reason });
    const roles = await Promise.all(
      (['fast', 'balanced', 'deep_review'] as const).map(async (alias) => {
        const chosen = await this.describe(org, alias);
        if (chosen === 'BLOCKED') return { alias, source: sourceOf(alias), lane: null };
        const route = chosen?.route ?? this.configured[alias];
        return { alias, source: sourceOf(alias), lane: lane(route, chosen?.label ?? modelLabel(route.modelId, route.provider ?? 'bedrock'), true, null) };
      }),
    );
    const roleLane = new Map(roles.map((role) => [role.alias, role.lane]));
    const jobs = await Promise.all(
      JOB_TYPES.map(async (jobType) => {
        const lanes: RoutingLane[] = [];
        const push = (next: RoutingLane) => {
          if (!lanes.some((l) => l.modelId === next.modelId && l.provider === next.provider)) lanes.push(next);
        };
        const key = storedRouteKey(jobType);
        const own = key ? await this.describe(org, key) : null;
        let source: JobSource = 'REGISTRY';
        if (own && own !== 'BLOCKED') {
          push(lane(own.route, own.label, true, null));
          source = orgRoutes.has(jobType) ? 'ORGANIZATION' : 'PLATFORM';
        }
        const override = parseJobOverride(this.routing.jobOverrides?.[jobType]);
        if (override) {
          const connected = this.routing.providers.includes(override.provider);
          push({ provider: override.provider, modelId: override.modelId, label: modelLabel(override.modelId, override.provider), available: connected, reason: connected ? null : `${override.provider} not connected` });
          if (source === 'REGISTRY' && connected) source = 'DEPLOYMENT';
        }
        for (const step of JOB_MODEL_MAP[jobType].lanes) {
          if (step.kind === 'claude') {
            const role = roleLane.get(step.alias);
            push(role ?? { provider: 'bedrock', modelId: this.configured[step.alias].modelId, label: modelLabel(this.configured[step.alias].modelId), available: false, reason: 'not on this organization’s allow-list' });
          } else if (!this.routing.providers.includes(step.provider)) {
            push({ provider: step.provider, modelId: step.modelId, label: modelLabel(step.modelId, step.provider), available: false, reason: `${PROVIDER_NAMES[step.provider] ?? step.provider} not connected` });
          } else {
            const usable = await this.modelUsable(org, step.provider, step.modelId);
            push({ provider: step.provider, modelId: step.modelId, label: modelLabel(step.modelId, step.provider), available: usable, reason: usable ? null : 'not evaluated, terms not recorded, or not allowed' });
          }
        }
        return { jobType, label: JOB_MODEL_MAP[jobType].label, source, lanes };
      }),
    );
    return { scope: organizationId ? 'ORGANIZATION' : 'PLATFORM', roles, jobs };
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

/** The health check for one model (2026-11-20): can we call it, does it return a valid cited answer. */
export type ModelEvaluator = (model: { provider: ModelProvider; providerModelId: string }) => Promise<AiEvaluation>;

/** The health check for this deployment: one synthetic question to the model; fixture deployments always pass. */
export function modelEvaluator(transport: ModelTransport | null, configured: Readonly<Record<ModelAlias, ModelRoute>>): ModelEvaluator {
  return async (model) => {
    const health = transport
      ? await checkModelHealth(
          new TransportClaudeGateway({
            transport,
            registry: defaultPromptRegistry(),
            routes: Object.fromEntries((Object.keys(configured) as ModelAlias[]).map((alias) => [alias, { modelId: model.providerModelId, provider: model.provider, effort: configured[alias].effort }])) as Record<ModelAlias, ModelRoute>,
          }),
        )
      : { passed: true, latencyMs: 0, failures: [] };
    return healthRecord(health);
  };
}

/** What is stored with the model: the health check's verdict, how long it took, and why it failed. */
export function healthRecord(health: { passed: boolean; latencyMs: number; failures: readonly string[] }): AiEvaluation {
  return {
    kind: 'health',
    passed: health.passed,
    latencyMs: health.latencyMs,
    goldenPassed: health.passed ? 1 : 0,
    goldenTotal: 1,
    probesBlocked: 0,
    probesTotal: 0,
    citationRecall: health.passed ? 1 : 0,
    citationPrecision: health.passed ? 1 : 0,
    promptHashes: {},
    ranAt: new Date().toISOString(),
    ...(health.failures.length > 0 ? { failures: [...health.failures] } : {}),
  };
}
