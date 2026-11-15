import { callOps, type SqlExecutor } from './ops';

/** A Cost Explorer line: spend for one period, environment tag and AWS product. Amounts are decimal strings. */
export interface HostingCostLine {
  readonly periodStart: string;
  readonly environment: string;
  readonly service: string;
  readonly amount: string;
  readonly currency: string;
  readonly estimated: boolean;
}

export type CostGranularity = 'MONTHLY' | 'DAILY';
export const COST_RATE_KINDS = ['BEDROCK_INPUT_PER_MTOK', 'BEDROCK_OUTPUT_PER_MTOK', 'S3_STORAGE_GB_MONTH'] as const;
export type CostRateKind = (typeof COST_RATE_KINDS)[number];

export interface CostRate {
  readonly id: string;
  readonly kind: CostRateKind;
  readonly key: string;
  readonly unitPrice: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly sourceNote: string;
  readonly createdAt: string;
}

export interface AiUsageRow {
  readonly day: string;
  readonly modelId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly authMethod: string;
  readonly dealId: string;
  readonly dealName: string;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface StorageUsageRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly authMethod: string;
  readonly dealId: string;
  readonly dealName: string;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly documents: number;
  /** Bytes held × days held, as a decimal string. */
  readonly byteDays: string;
}

const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const decimal = (value: unknown) => (value === null || value === undefined ? '0' : String(value));
const nullable = (value: unknown) => (value === null || value === undefined ? null : String(value));

/**
 * Hosting cost (2026-11-15): Cost Explorer lines, operator rates and metered usage, all behind
 * operator-checked `app_ops_cost_*` functions. Counts and amounts only, never deal content.
 */
export const hostingCost = {
  /** Replace one window of lines (a refresh never duplicates). The number of lines stored. */
  async replace(sql: SqlExecutor, actor: string | null, granularity: CostGranularity, from: string, to: string, lines: readonly HostingCostLine[]): Promise<number> {
    const [row] = await callOps<{ stored: number }>(sql, 'SELECT app_ops_cost_replace($1::uuid, $2, $3::date, $4::date, $5::jsonb) AS stored', [
      actor,
      granularity,
      from,
      to,
      JSON.stringify(lines.map((line) => ({ period_start: line.periodStart, environment: line.environment, service: line.service, amount: line.amount, currency: line.currency, estimated: line.estimated }))),
    ]);
    return Number(row?.stored ?? 0);
  },

  /** Record a refresh, at the time it started (the caller's clock). */
  async logSync(sql: SqlExecutor, actor: string | null, outcome: { status: 'SUCCEEDED' | 'FAILED'; lines: number; errorClass: string | null; at: Date }): Promise<void> {
    await callOps(sql, 'SELECT app_ops_cost_sync_log($1::uuid, $2, $3::int, $4, $5::timestamptz)::text AS done', [actor, outcome.status, outcome.lines, outcome.errorClass, outcome.at.toISOString()]);
  },

  async syncState(sql: SqlExecutor, actor: string | null): Promise<{ lastAttemptAt: Date | null; lastStatus: string | null; lastError: string | null; lastSuccessAt: Date | null }> {
    const [row] = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_sync_state($1::uuid)', [actor]);
    const at = (value: unknown) => (value ? new Date(value as string) : null);
    return { lastAttemptAt: at(row?.['last_attempt_at']), lastStatus: nullable(row?.['last_status']), lastError: nullable(row?.['last_error']), lastSuccessAt: at(row?.['last_success_at']) };
  },

  async lines(sql: SqlExecutor, actor: string | null, granularity: CostGranularity, from: string, to: string): Promise<HostingCostLine[]> {
    return (await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_lines($1::uuid, $2, $3::date, $4::date)', [actor, granularity, from, to])).map((row) => ({
      periodStart: day(row['period_start']),
      environment: String(row['environment']),
      service: String(row['service']),
      amount: decimal(row['amount']),
      currency: String(row['currency']),
      estimated: row['estimated'] === true,
    }));
  },

  async rates(sql: SqlExecutor, actor: string | null): Promise<CostRate[]> {
    return (await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_rates($1::uuid)', [actor])).map((row) => ({
      id: String(row['id']),
      kind: String(row['kind']) as CostRateKind,
      key: String(row['key']),
      unitPrice: decimal(row['unit_price']),
      currency: String(row['currency']),
      effectiveFrom: day(row['effective_from']),
      sourceNote: String(row['source_note'] ?? ''),
      createdAt: new Date(row['created_at'] as string).toISOString(),
    }));
  },

  async setRate(sql: SqlExecutor, actor: string | null, rate: { kind: CostRateKind; key: string; unitPrice: string; currency: string; effectiveFrom: string; sourceNote: string }): Promise<string> {
    const [row] = await callOps<{ id: string }>(sql, 'SELECT app_ops_cost_rate_set($1::uuid, $2, $3, $4::numeric, $5, $6::date, $7)::text AS id', [
      actor,
      rate.kind,
      rate.key,
      rate.unitPrice,
      rate.currency,
      rate.effectiveFrom,
      rate.sourceNote,
    ]);
    return String(row?.id);
  },

  async deleteRate(sql: SqlExecutor, actor: string | null, id: string): Promise<boolean> {
    const [row] = await callOps<{ deleted: boolean }>(sql, 'SELECT app_ops_cost_rate_delete($1::uuid, $2::uuid) AS deleted', [actor, id]);
    return row?.deleted === true;
  },

  async aiUsage(sql: SqlExecutor, actor: string | null, from: string, to: string): Promise<AiUsageRow[]> {
    return (await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_ai_usage($1::uuid, $2::date, $3::date)', [actor, from, to])).map((row) => ({
      day: day(row['day']),
      modelId: String(row['model_id']),
      organizationId: String(row['organization_id']),
      organizationName: String(row['organization_name']),
      authMethod: String(row['auth_method']),
      dealId: String(row['deal_id']),
      dealName: String(row['deal_name']),
      userId: nullable(row['user_id']),
      userEmail: nullable(row['user_email']),
      runs: Number(row['runs']),
      inputTokens: Number(row['input_tokens']),
      outputTokens: Number(row['output_tokens']),
    }));
  },

  async storageUsage(sql: SqlExecutor, actor: string | null, from: string, to: string): Promise<StorageUsageRow[]> {
    return (await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_storage_usage($1::uuid, $2::date, $3::date)', [actor, from, to])).map((row) => ({
      organizationId: String(row['organization_id']),
      organizationName: String(row['organization_name']),
      authMethod: String(row['auth_method']),
      dealId: String(row['deal_id']),
      dealName: String(row['deal_name']),
      userId: nullable(row['user_id']),
      userEmail: nullable(row['user_email']),
      documents: Number(row['documents']),
      byteDays: decimal(row['byte_days']),
    }));
  },
};
