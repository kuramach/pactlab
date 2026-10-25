import type { PrismaClient } from './client';
import { APP_DB_ROLE } from './tenant';

/**
 * Operator-only access across organizations (T-072): thin typed wrappers over
 * the `app_ops_*` and `app_bug_*` SECURITY DEFINER functions, which check the
 * actor is a platform operator before doing anything. The same wrappers serve
 * the ops CLI (schema-owner session, actor null) and the API (runtime role,
 * actor = the verified operator).
 */
export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Run the functions from the API's runtime connection, as the app role (the
 * runtime login is NOINHERIT: it holds EXECUTE only after SET ROLE).
 */
export function prismaExecutor(prisma: PrismaClient): SqlExecutor {
  return {
    query: async (sql, params = []) => ({
      rows: await prisma.$transaction(async (tx) => {
        // Constant statement: no user input reaches SET ROLE.
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
        return tx.$queryRawUnsafe(sql, ...params);
      }),
    }),
  };
}

export class OperatorRequiredError extends Error {
  constructor() {
    super('Platform operator required');
    this.name = 'OperatorRequiredError';
  }
}

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function call<T>(sql: SqlExecutor, text: string, params: unknown[]): Promise<T[]> {
  try {
    return rows<T>(await sql.query(text, params));
  } catch (error) {
    // 42501 (insufficient privilege) from the functions: not an operator, or an action they refuse.
    // pg reports it as `code`; Prisma wraps it as P2010 with the database code in `meta.code`.
    const failure = error as { code?: string; meta?: { code?: string }; message?: string };
    if (failure.code === '42501' || failure.meta?.code === '42501' || /\b42501\b|operator required/i.test(String(failure.message))) throw new OperatorRequiredError();
    throw error;
  }
}

export interface PendingOrganization {
  slug: string;
  name: string;
  ssoRequested: boolean;
  createdAt: Date;
  owners: string;
}

export interface OperatorOrganization {
  id: string;
  slug: string;
  name: string;
  status: string;
  authMethod: string;
  ssoRequested: boolean;
  createdAt: Date;
  owners: string;
  members: number;
  deals: { pre: number; diligence: number; post: number };
  aiTokens: { input: number; output: number };
  flags: { pilotMode: boolean; liveConnectors: boolean };
}

export interface OperatorUser {
  userId: string;
  displayName: string;
  email: string | null;
  organizationId: string;
  organizationName: string;
  role: string;
  status: string;
  platformOperator: boolean;
}

export interface BugListRow {
  id: string;
  number: number;
  organizationId: string;
  organizationName: string;
  dealId: string | null;
  reporterUserId: string | null;
  trigger: string;
  title: string;
  severity: string;
  status: string;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hasScreenshot: boolean;
}

export interface BugDetailRow extends BugListRow {
  fingerprint: string;
  whatHappened: string | null;
  expected: string | null;
  context: Record<string, unknown>;
  internalNotes: string | null;
  screenshot: Uint8Array | null;
  screenshotType: string | null;
}

const num = (value: unknown) => Number(value ?? 0);

export const operatorOps = {
  async isOperator(sql: SqlExecutor, userId: string): Promise<boolean> {
    const [row] = await call<{ ok: boolean }>(sql, 'SELECT app_is_platform_operator($1::uuid) AS ok', [userId]);
    return row?.ok === true;
  },

  async pendingOrganizations(sql: SqlExecutor, actor: string | null): Promise<PendingOrganization[]> {
    return (
      await call<{ slug: string; name: string; sso_requested: boolean; created_at: Date; owners: string }>(sql, 'SELECT * FROM app_ops_pending_organizations($1::uuid)', [actor])
    ).map((row) => ({ slug: row.slug, name: row.name, ssoRequested: row.sso_requested, createdAt: new Date(row.created_at), owners: row.owners }));
  },

  async decideOrganization(sql: SqlExecutor, actor: string | null, slug: string, decision: 'approve' | 'reject') {
    const [row] = await call<{ outcome: 'changed' | 'unchanged' | 'not-found'; organization_name: string | null; status: string | null; owner_emails: string[] }>(
      sql,
      'SELECT * FROM app_ops_decide_organization($1::uuid, $2, $3)',
      [actor, slug, decision],
    );
    return { outcome: row?.outcome ?? 'not-found', name: row?.organization_name ?? null, status: row?.status ?? null, ownerEmails: row?.owner_emails ?? [] };
  },

  async organizations(sql: SqlExecutor, actor: string): Promise<OperatorOrganization[]> {
    return (await call<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_organizations($1::uuid)', [actor])).map((row) => ({
      id: String(row['id']),
      slug: String(row['slug']),
      name: String(row['name']),
      status: String(row['status']),
      authMethod: String(row['auth_method']),
      ssoRequested: row['sso_requested'] === true,
      createdAt: new Date(row['created_at'] as string),
      owners: String(row['owners'] ?? ''),
      members: num(row['members']),
      deals: { pre: num(row['deals_pre']), diligence: num(row['deals_diligence']), post: num(row['deals_post']) },
      aiTokens: { input: num(row['ai_input_tokens']), output: num(row['ai_output_tokens']) },
      flags: { pilotMode: row['pilot_mode'] === true, liveConnectors: row['live_connectors'] !== false },
    }));
  },

  async setOrganizationStatus(sql: SqlExecutor, actor: string, organizationId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<boolean> {
    const [row] = await call<{ ok: boolean }>(sql, 'SELECT app_ops_set_organization_status($1::uuid, $2::uuid, $3) AS ok', [actor, organizationId, status]);
    return row?.ok === true;
  },

  async setFlags(sql: SqlExecutor, actor: string, organizationId: string, flags: { pilotMode: boolean; liveConnectors: boolean }): Promise<void> {
    // The function returns void; cast so drivers can read the row.
    await call(sql, 'SELECT app_ops_set_flags($1::uuid, $2::uuid, $3, $4)::text AS done', [actor, organizationId, flags.pilotMode, flags.liveConnectors]);
  },

  /** The flags of the caller's own organization; defaults when none were set. */
  async organizationFlags(sql: SqlExecutor, organizationId: string, userId: string): Promise<{ pilotMode: boolean; liveConnectors: boolean }> {
    const [row] = await call<{ pilot_mode: boolean; live_connectors: boolean }>(sql, 'SELECT * FROM app_organization_flags($1::uuid, $2::uuid)', [organizationId, userId]);
    return { pilotMode: row?.pilot_mode === true, liveConnectors: row ? row.live_connectors !== false : true };
  },

  async users(sql: SqlExecutor, actor: string, filter: { organizationId?: string | null; query?: string | null }): Promise<OperatorUser[]> {
    return (await call<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_users($1::uuid, $2::uuid, $3)', [actor, filter.organizationId ?? null, filter.query ?? null])).map((row) => ({
      userId: String(row['user_id']),
      displayName: String(row['display_name']),
      email: (row['email'] as string | null) ?? null,
      organizationId: String(row['organization_id']),
      organizationName: String(row['organization_name']),
      role: String(row['role']),
      status: String(row['status']),
      platformOperator: row['platform_operator'] === true,
    }));
  },

  async setMemberStatus(sql: SqlExecutor, actor: string, organizationId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<boolean> {
    const [row] = await call<{ ok: boolean }>(sql, 'SELECT app_ops_set_member_status($1::uuid, $2::uuid, $3::uuid, $4) AS ok', [actor, organizationId, userId, status]);
    return row?.ok === true;
  },

  async connections(sql: SqlExecutor, actor: string) {
    return (await call<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_connections($1::uuid)', [actor])).map((row) => ({
      organizationName: String(row['organization_name']),
      provider: String(row['provider']),
      displayName: String(row['display_name']),
      connectionStatus: String(row['connection_status']),
      lastRunStatus: (row['last_run_status'] as string | null) ?? null,
      lastRunAt: row['last_run_at'] ? new Date(row['last_run_at'] as string) : null,
      lastError: (row['last_error'] as string | null) ?? null,
    }));
  },

  async auditEvents(sql: SqlExecutor, actor: string, filter: { action?: string | null; since?: Date | null; limit?: number }) {
    return (
      await call<Record<string, unknown>>(sql, 'SELECT * FROM app_ops_audit_events($1::uuid, $2, $3::timestamptz, $4::int)', [actor, filter.action ?? null, filter.since ?? null, filter.limit ?? 200])
    ).map((row) => ({
      occurredAt: new Date(row['occurred_at'] as string),
      organizationName: String(row['organization_name']),
      actorName: (row['actor_name'] as string | null) ?? null,
      action: String(row['action']),
      targetType: String(row['target_type']),
      targetId: (row['target_id'] as string | null) ?? null,
    }));
  },

  async fileBug(
    sql: SqlExecutor,
    input: {
      organizationId: string;
      dealId: string | null;
      reporterUserId: string | null;
      trigger: string;
      fingerprint: string;
      title: string;
      whatHappened: string | null;
      expected: string | null;
      severity: string;
      context: Record<string, unknown>;
      screenshot: Uint8Array | null;
      screenshotType: string | null;
    },
  ): Promise<{ id: string; number: number; deduplicated: boolean }> {
    const [row] = await call<{ id: string; number: number; deduplicated: boolean }>(
      sql,
      'SELECT * FROM app_bug_file($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::bytea, $12)',
      [
        input.organizationId,
        input.dealId,
        input.reporterUserId,
        input.trigger,
        input.fingerprint,
        input.title,
        input.whatHappened,
        input.expected,
        input.severity,
        JSON.stringify(input.context),
        input.screenshot ? Buffer.from(input.screenshot) : null,
        input.screenshotType,
      ],
    );
    if (!row) throw new Error('Bug was not filed');
    return { id: row.id, number: Number(row.number), deduplicated: row.deduplicated };
  },

  async bugs(sql: SqlExecutor, actor: string, mine: boolean): Promise<BugListRow[]> {
    return (await call<Record<string, unknown>>(sql, 'SELECT * FROM app_bug_list($1::uuid, $2)', [actor, mine])).map(bugRow);
  },

  async bug(sql: SqlExecutor, actor: string, id: string): Promise<BugDetailRow | null> {
    const [row] = await call<Record<string, unknown>>(sql, 'SELECT * FROM app_bug_get($1::uuid, $2::uuid)', [actor, id]);
    if (!row) return null;
    return {
      ...bugRow(row),
      hasScreenshot: row['screenshot'] != null,
      fingerprint: String(row['fingerprint']),
      whatHappened: (row['what_happened'] as string | null) ?? null,
      expected: (row['expected'] as string | null) ?? null,
      context: (row['context'] as Record<string, unknown>) ?? {},
      internalNotes: (row['internal_notes'] as string | null) ?? null,
      screenshot: row['screenshot'] ? new Uint8Array(row['screenshot'] as Uint8Array) : null,
      screenshotType: (row['screenshot_type'] as string | null) ?? null,
    };
  },

  async triageBug(sql: SqlExecutor, actor: string, id: string, input: { status: string; severity: string; internalNotes: string | null }): Promise<boolean> {
    const [row] = await call<{ ok: boolean }>(sql, 'SELECT app_bug_triage($1::uuid, $2::uuid, $3, $4, $5) AS ok', [actor, id, input.status, input.severity, input.internalNotes]);
    return row?.ok === true;
  },
};

function bugRow(row: Record<string, unknown>): BugListRow {
  return {
    id: String(row['id']),
    number: num(row['number']),
    organizationId: String(row['organization_id']),
    organizationName: String(row['organization_name']),
    dealId: (row['deal_id'] as string | null) ?? null,
    reporterUserId: (row['reporter_user_id'] as string | null) ?? null,
    trigger: String(row['trigger']),
    title: String(row['title']),
    severity: String(row['severity']),
    status: String(row['status']),
    occurrences: num(row['occurrences']),
    firstSeenAt: new Date(row['first_seen_at'] as string),
    lastSeenAt: new Date(row['last_seen_at'] as string),
    hasScreenshot: row['has_screenshot'] === true,
  };
}
