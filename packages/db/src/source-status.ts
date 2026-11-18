import { callOps, type SqlExecutor } from './ops';

/** A public data source live depends on (T-137 follow-up): whether live can reach it, as last checked. */
export interface SourceStatusRow {
  source: string;
  status: 'OK' | 'FAILING' | null;
  checkedAt: Date | null;
  lastOkAt: Date | null;
  failingSince: Date | null;
  detail: string | null;
}

const date = (value: unknown) => (value ? new Date(value as string) : null);

export const sourceStatus = {
  /** Claim the next check: true when none ran within the interval. Atomic across API tasks. */
  async claim(sql: SqlExecutor, source: string, intervalMinutes: number): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_source_check_claim($1, $2::int) AS ok', [source, intervalMinutes]);
    return row?.ok === true;
  },

  /** Record a finished check; returns the status before it (null on the first). */
  async record(sql: SqlExecutor, source: string, ok: boolean, detail: string | null): Promise<'OK' | 'FAILING' | null> {
    const [row] = await callOps<{ before: 'OK' | 'FAILING' | null }>(sql, 'SELECT app_source_check_record($1, $2, $3) AS before', [source, ok, detail]);
    return row?.before ?? null;
  },

  /** Operators only (Admin → Health). One row per source. */
  async list(sql: SqlExecutor, actor: string): Promise<SourceStatusRow[]> {
    const rows = await callOps<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_source_status($1::uuid)', [actor]);
    return rows.map((row) => ({
      source: row['source'] as string,
      status: (row['status'] as SourceStatusRow['status']) ?? null,
      checkedAt: date(row['checked_at']),
      lastOkAt: date(row['last_ok_at']),
      failingSince: date(row['failing_since']),
      detail: (row['detail'] as string | null) ?? null,
    }));
  },
};
