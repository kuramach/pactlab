import { callOps, type SqlExecutor } from './ops';
import { decodeCursor, encodeCursor, type PageRequest, type PageResult } from './pagination';

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

/** `job` and `pact_job` (T-132): AI spend per job type, and per pact and job type. */
export const METERED_DIMENSIONS = ['organization', 'pact', 'person', 'auth', 'model', 'job', 'pact_job'] as const;
export type MeteredDimension = (typeof METERED_DIMENSIONS)[number];

/** One row of a metered breakdown, priced and summed in the database. Amounts are decimal strings. */
export interface MeteredRow {
  readonly key: string;
  readonly label: string;
  readonly detail: string | null;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly gbMonths: string;
  readonly ai: string;
  readonly storage: string;
  readonly total: string;
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

  /** One breakdown of the metered estimate, most expensive first, a page at a time (T-126). */
  async meteredPage(sql: SqlExecutor, actor: string | null, period: { from: string; to: string }, dimension: MeteredDimension, request: PageRequest): Promise<PageResult<MeteredRow>> {
    const position = decodeCursor(request.cursor, { textId: true });
    const afterTotal = position && typeof position.key === 'string' && /^-?\d+(\.\d+)?$/.test(position.key) ? position.key : null;
    const found = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_metered_page($1::uuid, $2::date, $3::date, $4, $5::numeric, $6, $7::int)', [
      actor,
      period.from,
      period.to,
      dimension,
      afterTotal,
      afterTotal ? position?.id ?? null : null,
      request.limit + 1,
    ]);
    const page = found.slice(0, request.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        key: String(row['key']),
        label: String(row['label'] ?? row['key']),
        detail: nullable(row['detail']),
        runs: Number(row['runs']),
        inputTokens: Number(row['input_tokens']),
        outputTokens: Number(row['output_tokens']),
        gbMonths: decimal(row['gb_months']),
        ai: decimal(row['ai']),
        storage: decimal(row['storage']),
        total: decimal(row['total']),
      })),
      nextCursor: last && found.length > request.limit ? encodeCursor(decimal(last['total']), String(last['key'])) : null,
      total: Number(found[0]?.['total_rows'] ?? 0),
      limit: request.limit,
    };
  },

  /** The metered totals and the rates still missing, summed in the database. */
  async meteredTotals(sql: SqlExecutor, actor: string | null, period: { from: string; to: string }): Promise<{ ai: string; storage: string; missingRates: string[] }> {
    const [row] = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_cost_metered_totals($1::uuid, $2::date, $3::date)', [actor, period.from, period.to]);
    return { ai: decimal(row?.['ai']), storage: decimal(row?.['storage']), missingRates: Array.isArray(row?.['missing_rates']) ? (row['missing_rates'] as string[]) : [] };
  },
};
