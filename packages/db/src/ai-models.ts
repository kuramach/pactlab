import { callOps, type SqlExecutor } from './ops';

/**
 * AI models managed in the admin console (T-131): typed wrappers over the `app_ai_*` and
 * `app_ops_ai_*` SECURITY DEFINER functions. Operators change the catalog; the API reads the
 * resolved routes for each organization.
 */
export type AiProvider = 'bedrock' | 'anthropic' | 'openai' | 'google' | 'fixture';
export type AiAlias = 'fast' | 'balanced' | 'deep_review';
export const AI_ALIASES: readonly AiAlias[] = ['fast', 'balanced', 'deep_review'];

export interface ResolvedAiRoute {
  alias: AiAlias;
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
  platformAliases: AiAlias[];
}

export const aiModels = {
  /** The routes an organization's calls resolve to; aliases with no row use the code default. */
  async routesFor(sql: SqlExecutor, organizationId: string): Promise<ResolvedAiRoute[]> {
    const rows = await callOps<{ alias: AiAlias; provider: AiProvider | null; provider_model_id: string | null; label: string | null; blocked: boolean }>(sql, 'SELECT * FROM app_ai_routes_for($1::uuid)', [organizationId]);
    return rows.map((row) => ({ alias: row.alias, provider: row.provider, providerModelId: row.provider_model_id, label: row.label, blocked: row.blocked === true }));
  },

  /** At boot: the deployment's configured models into an empty catalog (EVALUATED; platform routes where none). */
  async adoptRoutes(sql: SqlExecutor, routes: readonly { alias: AiAlias; provider: AiProvider; modelId: string; label: string }[]): Promise<number> {
    const [row] = await callOps<{ added: number }>(sql, 'SELECT app_ai_adopt_routes($1::jsonb) AS added', [JSON.stringify(routes)]);
    return Number(row?.added ?? 0);
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
      platformAliases: (row['platform_aliases'] as AiAlias[] | null) ?? [],
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
  async setPlatformRoute(sql: SqlExecutor, actor: string, alias: AiAlias, modelId: string): Promise<boolean> {
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

  async organizationModels(sql: SqlExecutor, actor: string, organizationId: string): Promise<{ allowed: string[]; routes: Partial<Record<AiAlias, string>> }> {
    // bounded: one organization's allow-list and its three routes
    const rows = await callOps<{ kind: 'ALLOWED' | 'ROUTE'; alias: AiAlias | null; model_id: string }>(sql, 'SELECT kind, alias, model_id::text FROM app_ops_ai_org_models($1::uuid, $2::uuid)', [actor, organizationId]);
    return {
      allowed: rows.filter((row) => row.kind === 'ALLOWED').map((row) => row.model_id),
      routes: Object.fromEntries(rows.filter((row) => row.kind === 'ROUTE' && row.alias).map((row) => [row.alias, row.model_id])) as Partial<Record<AiAlias, string>>,
    };
  },

  async setOrganizationModels(
    sql: SqlExecutor,
    actor: string,
    organizationId: string,
    input: { allowed: readonly string[]; routes: Partial<Record<AiAlias, string>> },
  ): Promise<'SAVED' | 'NOT_FOUND' | 'NOT_EVALUATED' | 'BAD_ALIAS' | 'ROUTE_NOT_ALLOWED'> {
    const [row] = await callOps<{ outcome: 'SAVED' | 'NOT_FOUND' | 'NOT_EVALUATED' | 'BAD_ALIAS' | 'ROUTE_NOT_ALLOWED' }>(
      sql,
      'SELECT app_ops_ai_org_models_set($1::uuid, $2::uuid, $3::uuid[], $4::jsonb) AS outcome',
      [actor, organizationId, [...input.allowed], JSON.stringify(input.routes)],
    );
    return row?.outcome ?? 'NOT_FOUND';
  },
};
