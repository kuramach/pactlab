import type { TenantContext } from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';
import { decodeCursor, toPage, type PageRequest, type PageResult } from './pagination';
import { APP_DB_ROLE, withTenant } from './tenant';

/**
 * Contact details (T-180, ADR 0064): the person's verified email and their message channels.
 * Every write is a SECURITY DEFINER function acting on the signed-in person; the runtime role reads
 * only its own rows. Values here are personal data: never log them, never send them to a model.
 */
export type ContactChannelKind = 'TELEGRAM' | 'WHATSAPP' | 'SLACK' | 'TEAMS' | 'LINE';
export type ContactVerificationKind = 'EMAIL' | ContactChannelKind;

export interface ContactEmail {
  readonly email: string;
  readonly source: 'AUTH0_CLAIM' | 'CODE' | 'SIGN_IN';
  readonly verifiedAt: Date | null;
}

export interface ContactChannel {
  readonly id: string;
  readonly kind: ContactChannelKind;
  readonly handle: string;
  readonly verifiedAt: Date;
  readonly consentText: string | null;
  readonly consentedAt: Date | null;
}

export interface MaskedMemberContact {
  readonly userId: string;
  readonly displayName: string;
  readonly emailMasked: string | null;
  readonly emailVerified: boolean;
  readonly telegramMasked: string | null;
  readonly whatsappMasked: string | null;
}

export interface DispatchChannel {
  readonly channelId: string;
  readonly userId: string;
  readonly kind: ContactChannelKind;
  readonly handle: string;
}

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

export const contacts = {
  /** The person's own name, as their profile shows it. */
  async displayName(prisma: PrismaClient, tenant: TenantContext): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => (await tx.user.findUnique({ where: { id: tenant.userId }, select: { displayName: true } }))?.displayName ?? null);
  },

  /** The person's own email: the verified contact address, else the sign-in address (always verified by its code). */
  async email(prisma: PrismaClient, tenant: TenantContext): Promise<ContactEmail | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ email: string; source: string; verified_at: Date }[]>`
        SELECT email, source, verified_at FROM user_contact_emails WHERE user_id = ${tenant.userId}::uuid`;
      if (row) return { email: row.email, source: row.source as 'AUTH0_CLAIM' | 'CODE', verifiedAt: new Date(row.verified_at) };
      const user = await tx.user.findUnique({ where: { id: tenant.userId }, select: { email: true } });
      return user?.email ? { email: user.email, source: 'SIGN_IN', verifiedAt: null } : null;
    });
  },

  /** Auth0 / SSO: the identity provider's email, already checked `email_verified`. True when stored now. */
  async storeVerifiedClaim(prisma: PrismaClient, tenant: TenantContext, email: string): Promise<boolean> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ stored: boolean }[]>`SELECT app_contact_email_from_claim(${email}) AS stored`;
      return row?.stored === true;
    });
  },

  /** A code or link token, stored only as its hash. The verification id, or null (rate limit). */
  async beginVerification(
    prisma: PrismaClient,
    tenant: TenantContext,
    input: { kind: ContactVerificationKind; target: string | null; secretHash: string; minutes: number; consentText: string | null },
  ): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_contact_verification_begin(${input.kind}, ${input.target}, ${input.secretHash}, ${input.minutes}::int, ${input.consentText})::text AS id`;
      return row?.id ?? null;
    });
  },

  /** A correct email code: the address is the person's now. The previous address (to tell), or null on a wrong code. */
  async confirmEmail(prisma: PrismaClient, tenant: TenantContext, secretHash: string): Promise<{ previousEmail: string | null; email: string } | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ previous_email: string | null; email: string }[]>`
        SELECT previous_email, email FROM app_contact_email_confirm(${secretHash})`;
      return row ? { previousEmail: row.previous_email, email: row.email } : null;
    });
  },

  async confirmWhatsApp(prisma: PrismaClient, tenant: TenantContext, secretHash: string): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_contact_whatsapp_confirm(${secretHash})::text AS id`;
      return row?.id ?? null;
    });
  },

  /** From the verified Telegram webhook: `/start <token>` from a chat. The channel id, or null. */
  async linkTelegram(prisma: PrismaClient, input: { secretHash: string; chatId: string }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_contact_telegram_link(${input.secretHash}, ${input.chatId})::text AS id`;
      return row?.id ?? null;
    });
  },

  async channels(prisma: PrismaClient, tenant: TenantContext): Promise<ContactChannel[]> {
    return withTenant(prisma, tenant, async (tx) => {
      // bounded: at most one live channel per kind per person (unique index)
      const rows = await tx.$queryRaw<{ id: string; kind: string; handle: string; verified_at: Date; consent_text: string | null; consented_at: Date | null }[]>`
        SELECT id::text, kind, handle, verified_at, consent_text, consented_at FROM user_contact_channels
         WHERE user_id = ${tenant.userId}::uuid AND revoked_at IS NULL ORDER BY kind`;
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as ContactChannelKind,
        handle: row.handle,
        verifiedAt: new Date(row.verified_at),
        consentText: row.consent_text,
        consentedAt: row.consented_at ? new Date(row.consented_at) : null,
      }));
    });
  },

  /** The person disconnects their own channel. Its kind and handle (to say goodbye), or null. */
  async revoke(prisma: PrismaClient, tenant: TenantContext, channelId: string): Promise<{ kind: ContactChannelKind; handle: string } | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ kind: string; handle: string }[]>`SELECT kind, handle FROM app_contact_channel_revoke(${channelId}::uuid)`;
      return row ? { kind: row.kind as ContactChannelKind, handle: row.handle } : null;
    });
  },

  /**
   * Back from LINE Login (T-182): the signed-in person's own open LINE verification, by its state's hash.
   * A friend is linked now; otherwise only a keyed hash of the LINE user id is kept until the follow arrives.
   */
  async completeLineLogin(
    prisma: PrismaClient,
    tenant: TenantContext,
    input: { stateHash: string; userHash: string; lineUserId: string; isFriend: boolean },
  ): Promise<{ status: 'LINKED' | 'AWAITING_FRIEND' | 'INVALID'; channelId: string | null }> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string; channel_id: string | null }[]>`
        SELECT status, channel_id::text FROM app_line_login_complete(${input.stateHash}, ${input.userHash}, ${input.isFriend ? input.lineUserId : null}, ${input.isFriend})`;
      const status = row?.status === 'LINKED' && row.channel_id ? 'LINKED' : row?.status === 'AWAITING_FRIEND' ? 'AWAITING_FRIEND' : 'INVALID';
      return { status, channelId: status === 'LINKED' ? (row?.channel_id ?? null) : null };
    });
  },

  /** From the verified LINE `follow` webhook: the friend a person was waiting to add. The channel id, or null. */
  async lineFollow(prisma: PrismaClient, input: { userHash: string; lineUserId: string }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_line_follow(${input.userHash}, ${input.lineUserId})::text AS id`;
      return row?.id ?? null;
    });
  },

  /** The person signed in with LINE and has yet to add Pactlab as a friend. */
  async linePending(prisma: PrismaClient, tenant: TenantContext): Promise<boolean> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ pending: boolean }[]>`SELECT app_line_pending() AS pending`;
      return row?.pending === true;
    });
  },

  /** From a verified provider webhook: blocked, /stop or STOP. How many channels ended. */
  async stop(prisma: PrismaClient, input: { kind: ContactChannelKind; handle: string; reason: 'BLOCKED' | 'STOP' }): Promise<number> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT app_contact_channel_stop(${input.kind}, ${input.handle}, ${input.reason}) AS n`;
      return Number(row?.n ?? 0);
    });
  },

  /**
   * Organization owners and admins: members' contact details, masked in the database, one keyset page
   * by user id; every call audited. Empty when the caller is not an owner or admin.
   */
  async adminPage(prisma: PrismaClient, tenant: TenantContext, request: PageRequest): Promise<PageResult<MaskedMemberContact>> {
    const after = decodeCursor(request.cursor)?.id ?? null;
    return withTenant(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRaw<
        { user_id: string; display_name: string; email_masked: string | null; email_verified: boolean; telegram_masked: string | null; whatsapp_masked: string | null }[]
      >`SELECT user_id::text, display_name, email_masked, email_verified, telegram_masked, whatsapp_masked
          FROM app_contact_admin_list(${after}::uuid, ${request.limit + 1}::int)`;
      const total = rows.length === 0 && after === null ? 0 : await tx.organizationMembership.count({ where: { organizationId: tenant.organizationId, status: 'ACTIVE' } });
      return toPage(
        rows.map((row) => ({ ...row, id: row.user_id })),
        request,
        total,
        () => null,
        (row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          emailMasked: row.email_masked,
          emailVerified: row.email_verified,
          telegramMasked: row.telegram_masked,
          whatsappMasked: row.whatsapp_masked,
        }),
      );
    });
  },

  /** Operator console: this month's LINE use (Japan time) and whether the allowance was reached. Throws for a non-operator. */
  async lineAllowance(prisma: PrismaClient, actor: string, now: Date): Promise<{ month: string; used: number; reachedAt: Date | null }> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ month: Date; used: number; reached_at: Date | null }[]>`
        SELECT month, used, reached_at FROM app_ops_line_allowance(${actor}::uuid, ${now}::timestamptz)`;
      if (!row) throw new Error('app_ops_line_allowance returned no row');
      return { month: new Date(row.month).toISOString().slice(0, 7), used: Number(row.used), reachedAt: row.reached_at ? new Date(row.reached_at) : null };
    });
  },

  /** The same mask the database applies (for tests that compare both). */
  async mask(prisma: PrismaClient, kind: 'EMAIL' | ContactChannelKind, value: string): Promise<string> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ masked: string }[]>`SELECT app_contact_mask(${kind}, ${value}) AS masked`;
      return row?.masked ?? '';
    });
  },
};

/** The dispatcher's side: who has a verified channel, and at-most-once claims for each message. */
export const contactDispatch = {
  async channels(prisma: PrismaClient, userIds: readonly string[]): Promise<DispatchChannel[]> {
    if (userIds.length === 0) return [];
    return asApp(prisma, async (tx) => {
      // bounded: at most two live channels for each person in a dispatcher page
      const rows = await tx.$queryRaw<{ channel_id: string; user_id: string; kind: string; handle: string }[]>`
        SELECT channel_id::text, user_id::text, kind, handle FROM app_contact_dispatch_channels(${[...userIds]}::uuid[])`;
      return rows.map((row) => ({ channelId: row.channel_id, userId: row.user_id, kind: row.kind as ContactChannelKind, handle: row.handle }));
    });
  },

  /** Claim one notification on one channel; null when it was already claimed (never send twice). */
  async claim(prisma: PrismaClient, input: { channelId: string; notificationId: string }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_contact_delivery_claim(${input.channelId}::uuid, ${input.notificationId}::uuid)::text AS id`;
      return row?.id ?? null;
    });
  },

  /**
   * LINE (T-182): claim within the official account's monthly allowance, platform-wide. A notification
   * (no tenant: the dispatcher) or the person's own test (tenant). `reached` when the allowance is used up.
   */
  async claimLine(
    prisma: PrismaClient,
    input: { channelId: string; notificationId: string | null; now: Date; allowance: number; tenant?: TenantContext },
  ): Promise<{ deliveryId: string | null; reached: boolean }> {
    const run = async (tx: TransactionClient) => {
      const [row] = await tx.$queryRaw<{ delivery_id: string | null; reached: boolean }[]>`
        SELECT delivery_id::text, reached FROM app_line_delivery_claim(${input.channelId}::uuid, ${input.notificationId}::uuid, ${input.now}::timestamptz, ${input.allowance}::int)`;
      return { deliveryId: row?.delivery_id ?? null, reached: row?.reached === true };
    };
    return input.tenant ? withTenant(prisma, input.tenant, run) : asApp(prisma, run);
  },

  /** LINE answered "monthly limit": the month is reached. True the first time this month. */
  async lineAllowanceReached(prisma: PrismaClient, input: { now: Date; allowance: number }): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_line_allowance_reached(${input.now}::timestamptz, ${input.allowance}::int) AS ok`;
      return row?.ok === true;
    });
  },

  /** Operators are told once a month: true for the first caller after the allowance is reached. */
  async lineAllowanceNotify(prisma: PrismaClient, now: Date): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_line_allowance_notify(${now}::timestamptz) AS ok`;
      return row?.ok === true;
    });
  },

  /** The person's own test message: their channel, at most 3 an hour. Null when refused. */
  async claimTest(prisma: PrismaClient, tenant: TenantContext, channelId: string): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_contact_delivery_claim(${channelId}::uuid, NULL)::text AS id`;
      return row?.id ?? null;
    });
  },

  async finish(prisma: PrismaClient, input: { deliveryId: string; outcome: 'SENT' | 'FAILED'; errorClass: string | null }): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const errorClass = input.errorClass ? input.errorClass.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'unknown' : null;
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_contact_delivery_finish(${input.deliveryId}::uuid, ${input.outcome}, ${errorClass}) AS ok`;
      return row?.ok === true;
    });
  },
};
