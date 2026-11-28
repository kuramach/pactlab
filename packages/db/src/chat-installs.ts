import type { TenantContext } from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';
import { decodeCursor, toPage, type PageRequest, type PageResult } from './pagination';
import { APP_DB_ROLE, withTenant } from './tenant';

/**
 * Slack and Microsoft Teams (T-181, ADR 0065): the organization's install, the person's link, and where
 * each link sends. Workspace and tenant ids, platform user ids, token references and Teams conversation
 * references are personal or credential data: every read and write is a SECURITY DEFINER function, and
 * nothing here is ever returned to a client as it is. Never log these values.
 */
export type ChatProvider = 'SLACK' | 'TEAMS';

export interface ChatInstallStatus {
  readonly provider: ChatProvider;
  readonly installedAt: Date;
  /** Owners and admins only; null for everyone else. */
  readonly linkedCount: number | null;
}

export interface ChatInstallTarget {
  readonly installId: string;
  readonly externalTenant: string;
  readonly credentialRef: string | null;
}

export interface ChatTarget {
  readonly channelId: string;
  readonly userId: string;
  readonly kind: ChatProvider;
  /** `<team>:<member>` or `<tenant>:<object id>`. */
  readonly handle: string;
  readonly credentialRef: string | null;
  readonly serviceUrl: string | null;
  readonly conversationId: string | null;
}

export interface ChatMemberLink {
  readonly userId: string;
  readonly displayName: string;
  readonly linked: boolean;
}

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

type TargetRow = { channel_id: string; user_id: string; kind: string; handle: string; credential_ref: string | null; service_url: string | null; conversation_id: string | null };
const toTarget = (row: TargetRow): ChatTarget => ({
  channelId: row.channel_id,
  userId: row.user_id,
  kind: row.kind as ChatProvider,
  handle: row.handle,
  credentialRef: row.credential_ref,
  serviceUrl: row.service_url,
  conversationId: row.conversation_id,
});

export const chatInstalls = {
  /** An admin's install. Null when refused: not an admin, or another organization holds the workspace or tenant. */
  async save(prisma: PrismaClient, tenant: TenantContext, input: { provider: ChatProvider; externalTenant: string; credentialRef: string | null }): Promise<{ installId: string; replacedRef: string | null } | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ install_id: string; replaced_ref: string | null }[]>`
        SELECT install_id::text, replaced_ref FROM app_chat_install_save(${input.provider}, ${input.externalTenant}, ${input.credentialRef})`;
      return row ? { installId: row.install_id, replacedRef: row.replaced_ref } : null;
    });
  },

  /** An admin removes the install. The credential reference to revoke (empty for Teams), or null when nothing was installed. */
  async remove(prisma: PrismaClient, tenant: TenantContext, provider: ChatProvider): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ ref: string | null }[]>`SELECT app_chat_install_remove(${provider}) AS ref`;
      return row?.ref ?? null;
    });
  },

  /** From a verified webhook: uninstalled or tokens revoked. The reference to destroy, or null. */
  async providerEvent(prisma: PrismaClient, input: { provider: ChatProvider; externalTenant: string; reason: 'UNINSTALLED' | 'TOKENS_REVOKED' }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ ref: string | null }[]>`SELECT app_chat_install_provider_event(${input.provider}, ${input.externalTenant}, ${input.reason}) AS ref`;
      return row?.ref ?? null;
    });
  },

  async status(prisma: PrismaClient, tenant: TenantContext): Promise<ChatInstallStatus[]> {
    return withTenant(prisma, tenant, async (tx) => {
      // bounded: at most one live install per platform
      const rows = await tx.$queryRaw<{ provider: string; installed_at: Date; linked_count: number | null }[]>`SELECT provider, installed_at, linked_count FROM app_chat_install_status()`;
      return rows.map((row) => ({ provider: row.provider as ChatProvider, installedAt: new Date(row.installed_at), linkedCount: row.linked_count === null ? null : Number(row.linked_count) }));
    });
  },

  async forCaller(prisma: PrismaClient, tenant: TenantContext, provider: ChatProvider): Promise<ChatInstallTarget | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ install_id: string; external_tenant: string; credential_ref: string | null }[]>`
        SELECT install_id::text, external_tenant, credential_ref FROM app_chat_install_for_caller(${provider})`;
      return row ? { installId: row.install_id, externalTenant: row.external_tenant, credentialRef: row.credential_ref } : null;
    });
  },

  /** From a verified event: the live install of a workspace or tenant. */
  async forTenant(prisma: PrismaClient, provider: ChatProvider, externalTenant: string): Promise<{ installId: string; credentialRef: string | null } | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ install_id: string; credential_ref: string | null }[]>`
        SELECT install_id::text, credential_ref FROM app_chat_install_for_tenant(${provider}, ${externalTenant})`;
      return row ? { installId: row.install_id, credentialRef: row.credential_ref } : null;
    });
  },

  /** Start a link: the confirmation token's hash, for the member the person's verified email matched. Null when refused. */
  async beginLink(prisma: PrismaClient, tenant: TenantContext, input: { provider: ChatProvider; handle: string; secretHash: string }): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_chat_link_begin(${input.provider}, ${input.handle}, ${input.secretHash})::text AS id`;
      return row?.id ?? null;
    });
  },

  /** From a verified interaction: the member pressed Confirm. The channel id, or null. */
  async confirmLink(prisma: PrismaClient, input: { provider: ChatProvider; handle: string; secretHash: string }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_chat_link_confirm(${input.provider}, ${input.handle}, ${input.secretHash})::text AS id`;
      return row?.id ?? null;
    });
  },

  async linked(prisma: PrismaClient, provider: ChatProvider, handle: string): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ linked: boolean }[]>`SELECT app_chat_linked(${provider}, ${handle}) AS linked`;
      return row?.linked === true;
    });
  },

  async targets(prisma: PrismaClient, userIds: readonly string[]): Promise<ChatTarget[]> {
    if (userIds.length === 0) return [];
    return asApp(prisma, async (tx) => {
      // bounded: at most two live chat links for each person in a dispatcher page
      const rows = await tx.$queryRaw<TargetRow[]>`
        SELECT channel_id::text, user_id::text, kind, handle, credential_ref, service_url, conversation_id FROM app_chat_dispatch_targets(${[...userIds]}::uuid[])`;
      return rows.map(toTarget);
    });
  },

  async targetForCaller(prisma: PrismaClient, tenant: TenantContext, channelId: string): Promise<ChatTarget | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<TargetRow[]>`
        SELECT channel_id::text, user_id::text, kind, handle, credential_ref, service_url, conversation_id FROM app_chat_target_for_caller(${channelId}::uuid)`;
      return row ? toTarget(row) : null;
    });
  },

  /** Owners and admins: who is linked, by name; every call audited. Empty for anyone else. */
  async adminMembers(prisma: PrismaClient, tenant: TenantContext, provider: ChatProvider, request: PageRequest): Promise<PageResult<ChatMemberLink>> {
    const after = decodeCursor(request.cursor)?.id ?? null;
    return withTenant(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string; display_name: string; linked: boolean }[]>`
        SELECT user_id::text, display_name, linked FROM app_chat_admin_members(${provider}, ${after}::uuid, ${request.limit + 1}::int)`;
      const total = rows.length === 0 && after === null ? 0 : await tx.organizationMembership.count({ where: { organizationId: tenant.organizationId, status: 'ACTIVE' } });
      return toPage(
        rows.map((row) => ({ ...row, id: row.user_id })),
        request,
        total,
        () => null,
        (row) => ({ userId: row.user_id, displayName: row.display_name, linked: row.linked }),
      );
    });
  },
};

/** Teams conversation references, written only from verified Bot Framework activities. */
export const teamsRefs = {
  async capture(prisma: PrismaClient, input: { tenantId: string; aadObjectId: string; emailHash: string | null; serviceUrl: string; conversationId: string }): Promise<void> {
    await asApp(prisma, async (tx) => {
      await tx.$queryRaw`SELECT app_teams_ref_capture(${input.tenantId}, ${input.aadObjectId}, ${input.emailHash}, ${input.serviceUrl}, ${input.conversationId})::text`;
    });
  },

  async remove(prisma: PrismaClient, input: { tenantId: string; aadObjectId: string }): Promise<number> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT app_teams_ref_remove(${input.tenantId}, ${input.aadObjectId}) AS n`;
      return Number(row?.n ?? 0);
    });
  },

  async forCaller(prisma: PrismaClient, tenant: TenantContext, emailHash: string): Promise<{ aadObjectId: string; serviceUrl: string; conversationId: string } | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ aad_object_id: string; service_url: string; conversation_id: string }[]>`
        SELECT aad_object_id, service_url, conversation_id FROM app_teams_ref_for_caller(${emailHash})`;
      return row ? { aadObjectId: row.aad_object_id, serviceUrl: row.service_url, conversationId: row.conversation_id } : null;
    });
  },

  async forMember(prisma: PrismaClient, input: { tenantId: string; aadObjectId: string }): Promise<{ serviceUrl: string; conversationId: string } | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ service_url: string; conversation_id: string }[]>`
        SELECT service_url, conversation_id FROM app_teams_ref_for_member(${input.tenantId}, ${input.aadObjectId})`;
      return row ? { serviceUrl: row.service_url, conversationId: row.conversation_id } : null;
    });
  },
};
