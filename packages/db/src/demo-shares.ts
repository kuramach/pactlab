import type { PrismaClient } from './client';
import { asApp } from './auth-role';
import type { EmailLoginSession } from './login';
import { OperatorRequiredError, type SqlExecutor } from './ops';

/** Share lengths an operator may choose, in hours (T-113): 1 day, 3 days, 1 week. */
export const DEMO_SHARE_HOURS = [24, 72, 168] as const;
export type DemoShareHours = (typeof DEMO_SHARE_HOURS)[number];

export interface DemoSlotRow {
  organizationId: string;
  slot: number;
  organizationName: string;
  status: 'AVAILABLE' | 'SHARED' | 'RESETTING';
  resetAt: Date | null;
  lastError: string | null;
  share: { id: string; sharedWith: string; startsAt: Date; endsAt: Date; lastUsedAt: Date | null } | null;
}

export class NoDemoSlotFreeError extends Error {
  constructor() {
    super('Every demo slot is shared or resetting');
    this.name = 'NoDemoSlotFreeError';
  }
}

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function call<T>(sql: SqlExecutor, text: string, params: unknown[]): Promise<T[]> {
  try {
    return rows<T>(await sql.query(text, params));
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string; message?: string }; message?: string };
    const message = `${failure.message ?? ''} ${failure.meta?.message ?? ''}`;
    if (failure.code === '42501' || failure.meta?.code === '42501' || /\b42501\b|operator required/i.test(message)) throw new OperatorRequiredError();
    if (/NO_SLOT_FREE/.test(message)) throw new NoDemoSlotFreeError();
    throw error;
  }
}

const date = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string));

/**
 * The shareable demo pool (T-113): operator functions behind `app_ops_demo_*`
 * (operator checked in the database), and the demo-link sign-in behind
 * `app_demo_link_login` (pactlab_auth). Links are stored only as keyed hashes.
 */
export const demoShares = {
  async slots(sql: SqlExecutor, actor: string | null): Promise<DemoSlotRow[]> {
    const result = await call<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_demo_slots($1::uuid)', [actor]);
    return result.map((row) => ({
      organizationId: row['organization_id'] as string,
      slot: Number(row['slot']),
      organizationName: row['organization_name'] as string,
      status: row['status'] as DemoSlotRow['status'],
      resetAt: date(row['reset_at']),
      lastError: (row['last_error'] as string | null) ?? null,
      share: row['share_id']
        ? { id: row['share_id'] as string, sharedWith: row['shared_with'] as string, startsAt: date(row['starts_at']) as Date, endsAt: date(row['ends_at']) as Date, lastUsedAt: date(row['last_used_at']) }
        : null,
    }));
  },

  /** Lend the first free slot. Throws NoDemoSlotFreeError when all five are out. */
  async share(sql: SqlExecutor, actor: string | null, input: { sharedWith: string; hours: DemoShareHours; buyerTokenHash: string; sellerTokenHash: string }) {
    const [row] = await call<{ share_id: string; organization_id: string; slot: number; ends_at: string }>(
      sql,
      'SELECT * FROM app_ops_demo_share($1::uuid, $2, $3::int, $4, $5)',
      [actor, input.sharedWith, input.hours, input.buyerTokenHash, input.sellerTokenHash],
    );
    if (!row) throw new NoDemoSlotFreeError();
    return { shareId: row.share_id, organizationId: row.organization_id, slot: Number(row.slot), endsAt: new Date(row.ends_at) };
  },

  async end(sql: SqlExecutor, actor: string | null, shareId: string): Promise<boolean> {
    const [row] = await call<{ ended: boolean }>(sql, 'SELECT app_ops_demo_end($1::uuid, $2::uuid) AS ended', [actor, shareId]);
    return row?.ended === true;
  },

  async requestReset(sql: SqlExecutor, actor: string | null, organizationId: string): Promise<boolean> {
    const [row] = await call<{ queued: boolean }>(sql, 'SELECT app_ops_demo_reset($1::uuid, $2::uuid) AS queued', [actor, organizationId]);
    return row?.queued === true;
  },

  /** A live share's link: a session for the slot's buyer or seller, or null. */
  async login(prisma: PrismaClient, tokenHash: string): Promise<EmailLoginSession | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ session_id: string; user_id: string; subject: string; organization_id: string; expires_at: Date }[]>`
        SELECT session_id::text, user_id::text, subject, organization_id::text, expires_at FROM app_demo_link_login(${tokenHash})`,
    );
    return row ? { sessionId: row.session_id, userId: row.user_id, subject: row.subject, organizationId: row.organization_id, expiresAt: new Date(row.expires_at) } : null;
  },
};
