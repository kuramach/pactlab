import { callOps, type SqlExecutor } from './ops';

/**
 * AI models managed in the admin console (T-131): typed wrappers over the `app_ai_*` and
 * `app_ops_ai_*` SECURITY DEFINER functions. Operators change the catalog; the API reads the
 * resolved routes for each organization.
 */
export type AiProvider = 'bedrock' | 'anthropic' | 'openai' | 'google' | 'fixture';
export type AiAlias = 'fast' | 'balanced' | 'deep_review';
export const AI_ALIASES: readonly AiAlias[] = ['fast', 'balanced', 'deep_review'];

/** The routes the console may set: the three aliases, and the job types of best-of-breed routing (T-132). */
export type AiRouteKey = AiAlias | 'contract_scrub' | 'extraction' | 'classification' | 'document_qa' | 'vision';

export interface ResolvedAiRoute {
  alias: AiRouteKey;
  provider: AiProvider | null;
  providerModelId: string | null;
  label: string | null;
  /** The organization's allow-list covers no model for this alias: refuse, never fall back. */
  blocked: boolean;
}

export interface AiEvaluation {
  passed: boolean;
  goldenPassed: number;
  goldenTotal: number;
  probesBlocked: number;
  probesTotal: number;
  citationRecall: number;
  citationPrecision: number;
  promptHashes: Record<string, string>;
  ranAt: string;
  failures?: string[];
  basis?: string;
}

/** A provider outside AWS: its models serve only with a data-processing agreement and zero retention on record. */
export interface ProviderTerms {
  provider: 'anthropic' | 'openai' | 'google';
  dpaInPlace: boolean;
  zeroRetention: boolean;
  region: string | null;
  notes: string | null;
  recordedAt: Date;
  recordedByName: string | null;
}

export interface AiModelRow {
  id: string;
  provider: AiProvider;
  providerModelId: string;
  label: string;
  status: 'ADDED' | 'EVALUATED' | 'RETIRED';
  evaluation: Partial<AiEvaluation> | null;
  evaluatingSince: Date | null;
  createdAt: Date;
  organizations: number;
  platformAliases: AiRouteKey[];
}

export const aiModels = {
  /** The routes an organization's calls resolve to; aliases with no row use the code default. */
  async routesFor(sql: SqlExecutor, organizationId: string): Promise<ResolvedAiRoute[]> {
    const rows = await callOps<{ alias: AiRouteKey; provider: AiProvider | null; provider_model_id: string | null; label: string | null; blocked: boolean }>(sql, 'SELECT * FROM app_ai_routes_for($1::uuid)', [organizationId]);
    return rows.map((row) => ({ alias: row.alias, provider: row.provider, providerModelId: row.provider_model_id, label: row.label, blocked: row.blocked === true }));
  },

  /** Whether a specific model may serve this organization (EVALUATED, terms recorded, allowed): the lane chain asks (T-132). */
  async modelUsable(sql: SqlExecutor, organizationId: string, provider: AiProvider, providerModelId: string): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_ai_model_usable($1::uuid, $2, $3) AS ok', [organizationId, provider, providerModelId]);
    return row?.ok === true;
  },

  /** A pact's metered AI spend so far, in USD (tokens x the rates on record), for the cost ceiling (T-132). */
  async dealSpend(sql: SqlExecutor, organizationId: string, dealId: string): Promise<number> {
    const [row] = await callOps<{ usd: string | number | null }>(sql, 'SELECT app_ai_deal_spend($1::uuid, $2::uuid) AS usd', [organizationId, dealId]);
    return Number(row?.usd ?? 0);
  },

  /** At boot: the deployment's configured models into an empty catalog (EVALUATED; platform routes where none). */
  async adoptRoutes(sql: SqlExecutor, routes: readonly { alias: AiAlias; provider: AiProvider; modelId: string; label: string }[]): Promise<number> {
    const [row] = await callOps<{ added: number }>(sql, 'SELECT app_ai_adopt_routes($1::jsonb) AS added', [JSON.stringify(routes)]);
    return Number(row?.added ?? 0);
  },

  /**
   * At boot: the deployment's configured model per role (empty catalog: adopted as serving; otherwise added
   * for evaluation, or switched in at once when already evaluated). Returns the models still to be evaluated.
   */
  async syncDeployment(sql: SqlExecutor, routes: readonly { alias: AiAlias; provider: AiProvider; modelId: string; label: string }[]): Promise<{ id: string; provider: AiProvider; providerModelId: string; label: string }[]> {
    // bounded: at most one model per role (three)
    const rows = await callOps<{ model_id: string; provider: AiProvider; provider_model_id: string; label: string }>(sql, 'SELECT * FROM app_ai_deployment_sync($1::jsonb)', [JSON.stringify(routes)]);
    return rows.map((row) => ({ id: row.model_id, provider: row.provider, providerModelId: row.provider_model_id, label: row.label }));
  },

  /** Claim a configured model's evaluation (no person); false when another task has it or it no longer needs one. */
  async startDeploymentEvaluation(sql: SqlExecutor, modelId: string): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_ai_deployment_evaluating($1::uuid) AS ok', [modelId]);
    return row?.ok === true;
  },

  /** Record a configured model's evaluation; a pass switches it in for these roles where they follow the deployment. */
  async recordDeploymentEvaluation(sql: SqlExecutor, modelId: string, evaluation: AiEvaluation, aliases: readonly AiAlias[]): Promise<AiAlias[]> {
    const [row] = await callOps<{ switched: AiAlias[] | null }>(sql, 'SELECT app_ai_deployment_evaluated($1::uuid, $2, $3::jsonb, $4::text[]) AS switched', [modelId, evaluation.passed, JSON.stringify(evaluation), [...aliases]]);
    return row?.switched ?? [];
  },

  // bounded: the model catalog (tens of rows; the function caps it at 500)
  async list(sql: SqlExecutor, actor: string): Promise<AiModelRow[]> {
    const rows = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_ai_models($1::uuid)', [actor]);
    return rows.map((row) => ({
      id: String(row['id']),
      provider: row['provider'] as AiProvider,
      providerModelId: String(row['provider_model_id']),
      label: String(row['label']),
      status: row['status'] as AiModelRow['status'],
      evaluation: (row['evaluation'] as Partial<AiEvaluation> | null) ?? null,
      evaluatingSince: row['evaluating_since'] ? new Date(row['evaluating_since'] as string) : null,
      createdAt: new Date(row['created_at'] as string),
      organizations: Number(row['organizations'] ?? 0),
      platformAliases: (row['platform_aliases'] as AiRouteKey[] | null) ?? [],
    }));
  },

  async add(sql: SqlExecutor, actor: string, input: { provider: AiProvider; providerModelId: string; label: string }): Promise<string> {
    const [row] = await callOps<{ id: string }>(sql, 'SELECT app_ops_ai_model_add($1::uuid, $2, $3, $4)::text AS id', [actor, input.provider, input.providerModelId, input.label]);
    return String(row?.id);
  },

  /** False when the model is retired or already being evaluated. */
  async startEvaluation(sql: SqlExecutor, actor: string, modelId: string): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_ops_ai_model_evaluating($1::uuid, $2::uuid) AS ok', [actor, modelId]);
    return row?.ok === true;
  },

  async recordEvaluation(sql: SqlExecutor, actor: string, modelId: string, evaluation: AiEvaluation): Promise<void> {
    await callOps(sql, 'SELECT app_ops_ai_model_evaluated($1::uuid, $2::uuid, $3, $4::jsonb)::text AS done', [actor, modelId, evaluation.passed, JSON.stringify(evaluation)]);
  },

  async retire(sql: SqlExecutor, actor: string, modelId: string): Promise<'RETIRED' | 'IN_USE' | 'NOT_FOUND'> {
    const [row] = await callOps<{ outcome: 'RETIRED' | 'IN_USE' | 'NOT_FOUND' }>(sql, 'SELECT app_ops_ai_model_retire($1::uuid, $2::uuid) AS outcome', [actor, modelId]);
    return row?.outcome ?? 'NOT_FOUND';
  },

  /** False when the model is not EVALUATED. */
  async setPlatformRoute(sql: SqlExecutor, actor: string, alias: AiRouteKey, modelId: string): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_ops_ai_platform_route_set($1::uuid, $2, $3::uuid) AS ok', [actor, alias, modelId]);
    return row?.ok === true;
  },

  // bounded: one row per provider outside AWS (two today)
  async providerTerms(sql: SqlExecutor, actor: string): Promise<ProviderTerms[]> {
    const rows = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_ai_provider_terms($1::uuid)', [actor]);
    return rows.map((row) => ({
      provider: row['provider'] as 'anthropic' | 'openai' | 'google',
      dpaInPlace: row['dpa_in_place'] === true,
      zeroRetention: row['zero_retention'] === true,
      region: (row['region'] as string | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
      recordedAt: new Date(row['recorded_at'] as string),
      recordedByName: (row['recorded_by_name'] as string | null) ?? null,
    }));
  },

  async setProviderTerms(sql: SqlExecutor, actor: string, terms: { provider: 'anthropic' | 'openai' | 'google'; dpaInPlace: boolean; zeroRetention: boolean; region: string | null; notes: string | null }): Promise<void> {
    await callOps(sql, 'SELECT app_ops_ai_provider_terms_set($1::uuid, $2, $3, $4, $5, $6)::text AS done', [actor, terms.provider, terms.dpaInPlace, terms.zeroRetention, terms.region, terms.notes]);
  },

  /** A job type's platform route removed: the job follows its lane chain (T-132). False for the three aliases. */
  async clearPlatformRoute(sql: SqlExecutor, actor: string, key: AiRouteKey): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_ops_ai_platform_route_clear($1::uuid, $2) AS ok', [actor, key]);
    return row?.ok === true;
  },

  /** Which route keys the platform has set (the routing diagram's "platform default" marks). */
  async platformRouteKeys(sql: SqlExecutor): Promise<Set<string>> {
    // bounded: one row per route key (eight)
    const rows = await callOps<{ alias: string }>(sql, 'SELECT alias FROM app_ai_platform_route_keys()', []);
    return new Set(rows.map((row) => row.alias));
  },

  /** Which route keys an organization has set itself (the routing diagram's "this organization" marks). */
  async organizationRouteKeys(sql: SqlExecutor, organizationId: string): Promise<Set<string>> {
    // bounded: one row per route key (eight)
    const rows = await callOps<{ alias: string }>(sql, 'SELECT alias FROM app_ai_org_route_keys($1::uuid)', [organizationId]);
    return new Set(rows.map((row) => row.alias));
  },

  /**
   * An organization's own admin sets (modelId) or clears (null) one route (Settings → AI models). The
   * database re-checks the actor is an active owner or admin of it, and the model is EVALUATED, its
   * terms recorded and on the organization's allow-list when it has one. Never touches the allow-list.
   */
  async setOrganizationRoute(sql: SqlExecutor, actor: string, organizationId: string, key: AiRouteKey, modelId: string | null): Promise<'SAVED' | 'CLEARED' | 'NOT_ADMIN' | 'NOT_ALLOWED' | 'BAD_KEY'> {
    const [row] = await callOps<{ outcome: 'SAVED' | 'CLEARED' | 'NOT_ADMIN' | 'NOT_ALLOWED' | 'BAD_KEY' }>(sql, 'SELECT app_ai_org_route_set($1::uuid, $2::uuid, $3, $4::uuid) AS outcome', [actor, organizationId, key, modelId]);
    return row?.outcome ?? 'NOT_ADMIN';
  },

  /** The models an organization may choose from: EVALUATED, terms recorded, and on its allow-list when it has one. */
  async organizationChoices(sql: SqlExecutor, organizationId: string): Promise<{ id: string; provider: AiProvider; providerModelId: string; label: string }[]> {
    // bounded: the evaluated catalog (a handful of models)
    const rows = await callOps<{ id: string; provider: AiProvider; provider_model_id: string; label: string }>(sql, 'SELECT * FROM app_ai_org_choices($1::uuid)', [organizationId]);
    return rows.map((row) => ({ id: row.id, provider: row.provider, providerModelId: row.provider_model_id, label: row.label }));
  },

  async organizationModels(sql: SqlExecutor, actor: string, organizationId: string): Promise<{ allowed: string[]; routes: Partial<Record<AiRouteKey, string>> }> {
    // bounded: one organization's allow-list and its three routes
    const rows = await callOps<{ kind: 'ALLOWED' | 'ROUTE'; alias: AiRouteKey | null; model_id: string }>(sql, 'SELECT kind, alias, model_id::text FROM app_ops_ai_org_models($1::uuid, $2::uuid)', [actor, organizationId]);
    return {
      allowed: rows.filter((row) => row.kind === 'ALLOWED').map((row) => row.model_id),
      routes: Object.fromEntries(rows.filter((row) => row.kind === 'ROUTE' && row.alias).map((row) => [row.alias, row.model_id])) as Partial<Record<AiRouteKey, string>>,
    };
  },

  async setOrganizationModels(
    sql: SqlExecutor,
    actor: string,
    organizationId: string,
    input: { allowed: readonly string[]; routes: Partial<Record<AiRouteKey, string>> },
  ): Promise<'SAVED' | 'NOT_FOUND' | 'NOT_EVALUATED' | 'BAD_ALIAS' | 'ROUTE_NOT_ALLOWED'> {
    const [row] = await callOps<{ outcome: 'SAVED' | 'NOT_FOUND' | 'NOT_EVALUATED' | 'BAD_ALIAS' | 'ROUTE_NOT_ALLOWED' }>(
      sql,
      'SELECT app_ops_ai_org_models_set($1::uuid, $2::uuid, $3::uuid[], $4::jsonb) AS outcome',
      [actor, organizationId, [...input.allowed], JSON.stringify(input.routes)],
    );
    return row?.outcome ?? 'NOT_FOUND';
  },
};
