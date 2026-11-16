import { asApp } from './auth-role';
import type { PrismaClient } from './client';

/**
 * OAuth state for the MCP server (T-084, ADR 0024) and the REST API (T-128), behind
 * pactlab_auth SECURITY DEFINER functions like sign-in. Codes and tokens arrive here already
 * hashed; nothing raw is stored.
 */

export type McpOAuthScope = 'mcp:read' | 'mcp:confidential' | 'mcp:propose';
export type ApiOAuthScope = 'api:read' | 'api:write';
export type OAuthScope = McpOAuthScope | ApiOAuthScope;

export interface OAuthTokenSubject {
  grantId: string;
  userId: string;
  subject: string;
  organizationId: string;
  clientId: string;
  scopes: OAuthScope[];
  resource: string;
}

export interface OAuthCodeRecord extends OAuthTokenSubject {
  codeChallenge: string;
  redirectUri: string;
}

export interface ConnectedApp {
  id: string;
  organizationId: string;
  organizationName: string;
  clientId: string;
  clientName: string;
  scopes: OAuthScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface OrganizationApiGrant {
  id: string;
  userName: string;
  userEmail: string | null;
  clientId: string;
  clientName: string;
  scopes: OAuthScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

type SubjectRow = { grant_id: string; user_id: string; subject: string; organization_id: string; client_id: string; scopes: string[]; resource: string };
const subjectOf = (row: SubjectRow): OAuthTokenSubject => ({
  grantId: row.grant_id,
  userId: row.user_id,
  subject: row.subject,
  organizationId: row.organization_id,
  clientId: row.client_id,
  scopes: row.scopes as OAuthScope[],
  resource: row.resource,
});

export const oauth = {
  async mcpEnabled(prisma: PrismaClient, organizationId: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ enabled: boolean }[]>`SELECT app_oauth_mcp_enabled(${organizationId}::uuid) AS enabled`);
    return row?.enabled === true;
  },

  /** False when the address registered too many clients this hour. */
  async registerClient(prisma: PrismaClient, input: { clientId: string; clientName: string; redirectUris: string[]; ipHash: string }): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`SELECT app_oauth_register_client(${input.clientId}, ${input.clientName}, ${input.redirectUris}::text[], ${input.ipHash}) AS ok`,
    );
    return row?.ok === true;
  },

  async client(prisma: PrismaClient, clientId: string): Promise<{ clientName: string; redirectUris: string[] } | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ client_name: string; redirect_uris: string[] }[]>`SELECT client_name, redirect_uris FROM app_oauth_client(${clientId})`);
    return row ? { clientName: row.client_name, redirectUris: row.redirect_uris } : null;
  },

  /** The grant id, or null when the session cannot authorize (no organization chosen, MCP off). */
  async authorize(
    prisma: PrismaClient,
    input: { sessionId: string; clientId: string; clientName: string; scopes: OAuthScope[]; codeHash: string; codeChallenge: string; redirectUri: string; resource: string },
  ): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_oauth_authorize(${input.sessionId}::uuid, ${input.clientId}, ${input.clientName}, ${input.scopes}::text[], ${input.codeHash},
                                   ${input.codeChallenge}, ${input.redirectUri}, ${input.resource})::text AS id`,
    );
    return row?.id ?? null;
  },

  /** Consumes the code: one attempt. */
  async takeCode(prisma: PrismaClient, codeHash: string): Promise<OAuthCodeRecord | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<(SubjectRow & { code_challenge: string; redirect_uri: string })[]>`
        SELECT grant_id::text, user_id::text, subject, organization_id::text, client_id, scopes, code_challenge, redirect_uri, resource
          FROM app_oauth_take_code(${codeHash})`,
    );
    return row ? { ...subjectOf(row), codeChallenge: row.code_challenge, redirectUri: row.redirect_uri } : null;
  },

  async issueRefresh(prisma: PrismaClient, input: { grantId: string; tokenHash: string; scopes: OAuthScope[]; resource: string }): Promise<void> {
    await asApp(prisma, (tx) => tx.$executeRaw`SELECT app_oauth_issue_refresh(${input.grantId}::uuid, ${input.tokenHash}, ${input.scopes}::text[], ${input.resource})`);
  },

  /** Valid once; a reused token revokes the grant and returns null. */
  async useRefresh(prisma: PrismaClient, tokenHash: string): Promise<OAuthTokenSubject | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<SubjectRow[]>`SELECT grant_id::text, user_id::text, subject, organization_id::text, client_id, scopes, resource FROM app_oauth_use_refresh(${tokenHash})`,
    );
    return row ? subjectOf(row) : null;
  },

  /** For every API or MCP request: the grant is usable, and which resources are switched on. */
  async grantAccess(prisma: PrismaClient, grantId: string, subject: string): Promise<{ active: boolean; mcpEnabled: boolean; apiEnabled: boolean }> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ active: boolean; mcp_enabled: boolean; api_enabled: boolean }[]>`SELECT active, mcp_enabled, api_enabled FROM app_oauth_grant_access(${grantId}::uuid, ${subject})`,
    );
    return { active: row?.active === true, mcpEnabled: row?.mcp_enabled === true, apiEnabled: row?.api_enabled === true };
  },

  async apiEnabled(prisma: PrismaClient, organizationId: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ enabled: boolean }[]>`SELECT app_oauth_api_enabled(${organizationId}::uuid) AS enabled`);
    return row?.enabled === true;
  },

  // --- Device authorization (RFC 8628) ---------------------------------------------------------

  /** False when the address asked for too many codes this hour. */
  async deviceStart(
    prisma: PrismaClient,
    input: { clientId: string; clientName: string; scopes: OAuthScope[]; resource: string; deviceCodeHash: string; userCode: string; ipHash: string },
  ): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`
        SELECT app_oauth_device_start(${input.clientId}, ${input.clientName}, ${input.scopes}::text[], ${input.resource}, ${input.deviceCodeHash}, ${input.userCode}, ${input.ipHash}) AS ok`,
    );
    return row?.ok === true;
  },

  /** A pending, unexpired code's request; null otherwise. */
  async deviceLookup(prisma: PrismaClient, userCode: string): Promise<{ clientId: string; clientName: string; scopes: OAuthScope[]; resource: string; expiresAt: Date } | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ client_id: string; client_name: string; scopes: string[]; resource: string; expires_at: Date }[]>`
        SELECT client_id, client_name, scopes, resource, expires_at FROM app_oauth_device_lookup(${userCode})`,
    );
    return row ? { clientId: row.client_id, clientName: row.client_name, scopes: row.scopes as OAuthScope[], resource: row.resource, expiresAt: new Date(row.expires_at) } : null;
  },

  /** The grant id when approved; null when declined or not allowed. */
  async deviceDecide(prisma: PrismaClient, sessionId: string, userCode: string, approve: boolean): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_oauth_device_decide(${sessionId}::uuid, ${userCode}, ${approve})::text AS id`);
    return row?.id ?? null;
  },

  async devicePoll(
    prisma: PrismaClient,
    deviceCodeHash: string,
  ): Promise<{ outcome: 'PENDING' | 'SLOW_DOWN' | 'DENIED' | 'EXPIRED' | 'UNKNOWN' } | { outcome: 'APPROVED'; subject: OAuthTokenSubject }> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<(Partial<SubjectRow> & { outcome: string })[]>`
        SELECT outcome, grant_id::text, user_id::text, subject, organization_id::text, client_id, scopes, resource FROM app_oauth_device_poll(${deviceCodeHash})`,
    );
    if (row?.outcome === 'APPROVED' && row.grant_id) return { outcome: 'APPROVED', subject: subjectOf(row as SubjectRow) };
    // APPROVED without a row: the grant was revoked between approval and the poll.
    const outcome = row?.outcome;
    return { outcome: outcome === 'PENDING' || outcome === 'SLOW_DOWN' || outcome === 'DENIED' || outcome === 'EXPIRED' ? outcome : 'UNKNOWN' };
  },

  // --- Organization admins: API access ---------------------------------------------------------

  /** False when the session is not an organization owner or admin. */
  async setApiEnabled(prisma: PrismaClient, sessionId: string, enabled: boolean): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_oauth_set_api_enabled(${sessionId}::uuid, ${enabled}) AS ok`);
    return row?.ok === true;
  },

  /** The organization the session administers, or null. */
  async adminOrganization(prisma: PrismaClient, sessionId: string): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_oauth_admin_org(${sessionId}::uuid)::text AS id`);
    return row?.id ?? null;
  },

  /** A page of the organization's API grants, newest first (`limit` + 1 rows ask whether more follow). */
  async organizationApiGrants(
    prisma: PrismaClient,
    sessionId: string,
    after: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<{ rows: OrganizationApiGrant[]; total: number }> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string; user_name: string; user_email: string | null; client_id: string; client_name: string; scopes: string[]; created_at: Date; last_used_at: Date | null; total: bigint }[]>`
        SELECT id::text, user_name, user_email, client_id, client_name, scopes, created_at, last_used_at, total
          FROM app_oauth_org_api_grants(${sessionId}::uuid, ${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid, ${limit})`,
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      rows: rows.map((row) => ({
        id: row.id,
        userName: row.user_name,
        userEmail: row.user_email,
        clientId: row.client_id,
        clientName: row.client_name,
        scopes: row.scopes as OAuthScope[],
        createdAt: new Date(row.created_at),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      })),
    };
  },

  async adminRevoke(prisma: PrismaClient, sessionId: string, grantId: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_oauth_admin_revoke(${sessionId}::uuid, ${grantId}::uuid) AS ok`);
    return row?.ok === true;
  },

  async grantState(prisma: PrismaClient, grantId: string, subject: string): Promise<{ active: boolean; mcpEnabled: boolean }> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ active: boolean; mcp_enabled: boolean }[]>`SELECT active, mcp_enabled FROM app_oauth_grant_state(${grantId}::uuid, ${subject})`,
    );
    return { active: row?.active === true, mcpEnabled: row?.mcp_enabled === true };
  },

  async connectedApps(prisma: PrismaClient, sessionId: string): Promise<ConnectedApp[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ id: string; organization_id: string; organization_name: string; client_id: string; client_name: string; scopes: string[]; created_at: Date; last_used_at: Date | null }[]>`
        SELECT id::text, organization_id::text, organization_name, client_id, client_name, scopes, created_at, last_used_at FROM app_oauth_grants(${sessionId}::uuid)`,
    );
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      clientId: row.client_id,
      clientName: row.client_name,
      scopes: row.scopes as OAuthScope[],
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    }));
  },

  async revokeGrant(prisma: PrismaClient, sessionId: string, grantId: string): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_oauth_revoke_grant(${sessionId}::uuid, ${grantId}::uuid) AS ok`);
    return row?.ok === true;
  },

  async revokeRefresh(prisma: PrismaClient, tokenHash: string): Promise<void> {
    await asApp(prisma, (tx) => tx.$executeRaw`SELECT app_oauth_revoke_refresh(${tokenHash})`);
  },
};
