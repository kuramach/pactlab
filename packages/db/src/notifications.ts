import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_EVENTS,
  isPactLink,
  notificationLink,
  type EmailMode,
  type DigestCadence,
  type NotificationAudience,
  type NotificationEventType,
  type NotificationSettings,
  type NotificationUrgency,
  type NotificationVisibility,
  type PactNotificationOverride,
  type TenantContext,
  newId,
} from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';
import { toPage, afterCursor, type PageRequest, type PageResult } from './pagination';
import { APP_DB_ROLE, withTenant } from './tenant';

/**
 * Pact activity notifications (T-145, ADR 0046). An event is recorded inside the transaction that
 * makes its change (usually through the change's audit event, `AuditEventInput.notify`); the
 * recipients are computed by `app_notify` from the pact's memberships, never from client input.
 */
export interface PactEventInput {
  readonly type: NotificationEventType;
  /** Stable per change, so a retried request or a replayed job records the event once. */
  readonly dedupeKey: string;
  readonly visibility: NotificationVisibility;
  readonly audience: NotificationAudience;
  /** A record under the event's tab to link to (a finding). */
  readonly recordId?: string | null;
  /** Another tab to link to instead of the event's own (a seller's view of questions). */
  readonly section?: string;
  /** A bidder hears only of their own bid. */
  readonly bidId?: string | null;
  /** For the USERS audience. */
  readonly users?: readonly string[];
  /** The person who made the change is told too (their own sync finished). */
  readonly includeActor?: boolean;
}

/** Record one event on `dealId` as the transaction's tenant. Returns the recipients added (0 when already recorded). */
export async function recordPactEvent(tx: TransactionClient, dealId: string, event: PactEventInput): Promise<number> {
  const definition = NOTIFICATION_EVENTS[event.type];
  const link = event.section ? `/deals/${dealId}/${event.section}` : notificationLink(event.type, dealId, event.recordId);
  if (!isPactLink(link, dealId)) throw new Error('A notification links inside its own pact');
  const users = [...(event.users ?? [])];
  const [row] = await tx.$queryRaw<{ count: number }[]>`
    SELECT app_notify(${dealId}::uuid, ${event.type}, ${definition.urgency}, ${event.dedupeKey.slice(0, 200)}, ${link}, ${event.visibility},
                      ${event.audience}, ${event.bidId ?? null}::uuid, ${users}::uuid[], ${event.includeActor ?? false}) AS count`;
  return Number(row?.count ?? 0);
}

export type NotificationEmailStatus = 'PENDING' | 'SENDING' | 'SENT' | 'IN_APP_ONLY' | 'SUPPRESSED' | 'NO_ADDRESS' | 'FAILED';

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationEventType;
  readonly urgency: NotificationUrgency;
  readonly title: string;
  readonly dealId: string;
  readonly dealName: string;
  readonly link: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly emailStatus: NotificationEmailStatus;
}

/** The signed-in person's inbox, in the organization their session is in (RLS: own rows, pacts still theirs). */
export const notificationInbox = {
  async page(prisma: PrismaClient, tenant: TenantContext, request: PageRequest & { unreadOnly?: boolean }): Promise<PageResult<NotificationItem>> {
    const where = { userId: tenant.userId, ...(request.unreadOnly ? { readAt: null } : {}) };
    return withTenant(prisma, tenant, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.notification.findMany({
          where: { ...where, ...afterCursor('id', request.cursor) },
          orderBy: { id: 'desc' },
          take: request.limit + 1,
          include: { event: { select: { type: true, linkPath: true } } },
        }),
        tx.notification.count({ where }),
      ]);
      // bounded: the pacts of one page of items
      const deals = await tx.deal.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.dealId))] } }, select: { id: true, name: true } });
      const names = new Map(deals.map((deal) => [deal.id, deal.name]));
      return toPage(rows, request, total, (row) => row.id, (row) => {
        const type = row.event.type as NotificationEventType;
        return {
          id: row.id,
          type,
          urgency: row.urgency as NotificationUrgency,
          title: NOTIFICATION_EVENTS[type].title,
          dealId: row.dealId,
          dealName: names.get(row.dealId) ?? 'A pact',
          link: row.event.linkPath,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
          emailStatus: row.emailStatus as NotificationEmailStatus,
        };
      });
    });
  },

  async unreadCount(prisma: PrismaClient, tenant: TenantContext): Promise<number> {
    return withTenant(prisma, tenant, (tx) => tx.notification.count({ where: { userId: tenant.userId, readAt: null } }));
  },

  /** True when the item is the caller's and was unread. */
  async markRead(prisma: PrismaClient, tenant: TenantContext, id: string): Promise<boolean> {
    const result = await withTenant(prisma, tenant, (tx) => tx.notification.updateMany({ where: { id, userId: tenant.userId, readAt: null }, data: { readAt: new Date() } }));
    return result.count > 0;
  },

  async markAllRead(prisma: PrismaClient, tenant: TenantContext): Promise<number> {
    const result = await withTenant(prisma, tenant, (tx) => tx.notification.updateMany({ where: { userId: tenant.userId, readAt: null }, data: { readAt: new Date() } }));
    return result.count;
  },
};

function personSettings(row: { actNow: string | null; fyi: string | null; digest: string | null; timeZone: string | null; quietStart: number | null; quietEnd: number | null; actNowThroughQuiet: boolean | null } | null | undefined): NotificationSettings {
  if (!row) return DEFAULT_NOTIFICATION_SETTINGS;
  return {
    actNow: (row.actNow ?? DEFAULT_NOTIFICATION_SETTINGS.actNow) as EmailMode,
    fyi: (row.fyi ?? DEFAULT_NOTIFICATION_SETTINGS.fyi) as EmailMode,
    digest: (row.digest ?? DEFAULT_NOTIFICATION_SETTINGS.digest) as DigestCadence,
    timeZone: row.timeZone ?? DEFAULT_NOTIFICATION_SETTINGS.timeZone,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    actNowThroughQuiet: row.actNowThroughQuiet ?? false,
  };
}

/** The signed-in person's settings (Settings → Notifications), and their override per pact. */
export const notificationPreferences = {
  async get(prisma: PrismaClient, tenant: TenantContext): Promise<NotificationSettings> {
    const row = await withTenant(prisma, tenant, (tx) => tx.notificationPreference.findFirst({ where: { userId: tenant.userId, dealId: null } }));
    return personSettings(row);
  },

  async set(prisma: PrismaClient, tenant: TenantContext, settings: NotificationSettings): Promise<NotificationSettings> {
    const data = { ...settings, updatedAt: new Date() };
    await withTenant(prisma, tenant, async (tx) => {
      const existing = await tx.notificationPreference.findFirst({ where: { userId: tenant.userId, dealId: null }, select: { id: true } });
      if (existing) await tx.notificationPreference.update({ where: { id: existing.id }, data });
      else await tx.notificationPreference.create({ data: { id: newId(), userId: tenant.userId, ...data } });
    });
    return settings;
  },

  async getPact(prisma: PrismaClient, tenant: TenantContext, dealId: string): Promise<PactNotificationOverride> {
    const row = await withTenant(prisma, tenant, (tx) => tx.notificationPreference.findFirst({ where: { userId: tenant.userId, dealId } }));
    return { actNow: (row?.actNow ?? null) as EmailMode | null, fyi: (row?.fyi ?? null) as EmailMode | null };
  },

  async setPact(prisma: PrismaClient, tenant: TenantContext, dealId: string, override: PactNotificationOverride): Promise<PactNotificationOverride> {
    await withTenant(prisma, tenant, async (tx) => {
      const existing = await tx.notificationPreference.findFirst({ where: { userId: tenant.userId, dealId }, select: { id: true } });
      const data = { actNow: override.actNow, fyi: override.fyi, updatedAt: new Date() };
      if (existing) await tx.notificationPreference.update({ where: { id: existing.id }, data });
      else await tx.notificationPreference.create({ data: { id: newId(), userId: tenant.userId, organizationId: tenant.organizationId, dealId, ...data } });
    });
    return override;
  },
};

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

export interface PendingNotification {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly dealName: string;
  readonly type: NotificationEventType;
  readonly urgency: NotificationUrgency;
  readonly link: string;
  readonly createdAt: Date;
  /** The person's sign-in address; null when they sign in with Auth0 and none is held. */
  readonly email: string | null;
  /** T-174b: the pact's working language (`en | de | fr | ja`); null follows the organization. */
  readonly workingLanguage: string | null;
}

export interface RecipientSettings {
  readonly person: NotificationSettings;
  readonly pacts: ReadonlyMap<string, PactNotificationOverride>;
  readonly lastDigestAt: Date | null;
}

export type DeliveryKind = 'IMMEDIATE' | 'DIGEST';
export type DeliveryOutcome = 'SENT' | 'SUPPRESSED' | 'FAILED';

/**
 * The dispatcher's reads and writes (no tenant session: it works across organizations), through
 * SECURITY DEFINER functions. Claims make every email at-most-once.
 */
export const notificationDispatch = {
  async pendingPage(prisma: PrismaClient, input: { after: string | null; limit: number }): Promise<PendingNotification[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ notification_id: string; user_id: string; organization_id: string; deal_id: string; deal_name: string; type: string; urgency: string; link_path: string; created_at: Date; email: string | null }[]>`
        SELECT notification_id::text, user_id::text, organization_id::text, deal_id::text, deal_name, type, urgency, link_path, created_at, email
          FROM app_notification_pending_page(${input.after}::uuid, ${input.limit}::int)`,
    );
    const dealIds = [...new Set(rows.map((row) => row.deal_id))];
    const languages = new Map<string, string>();
    if (dealIds.length > 0) {
      const found = await asApp(prisma, (tx) =>
        tx.$queryRaw<{ deal_id: string; working_language: string }[]>`
          SELECT deal_id::text, working_language FROM app_notification_deal_languages(${dealIds}::uuid[])`,
      );
      for (const row of found) languages.set(row.deal_id, row.working_language);
    }
    return rows.map((row) => ({
      id: row.notification_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      dealId: row.deal_id,
      dealName: row.deal_name,
      type: row.type as NotificationEventType,
      urgency: row.urgency as NotificationUrgency,
      link: row.link_path,
      createdAt: new Date(row.created_at),
      email: row.email,
      workingLanguage: languages.get(row.deal_id) ?? null,
    }));
  },

  async settings(prisma: PrismaClient, userIds: readonly string[]): Promise<Map<string, RecipientSettings>> {
    const ids = [...new Set(userIds)];
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ user_id: string; deal_id: string | null; act_now: string | null; fyi: string | null; digest: string | null; time_zone: string | null; quiet_start: number | null; quiet_end: number | null; act_now_through_quiet: boolean | null; last_digest_at: Date | null }[]>`
        SELECT user_id::text, deal_id::text, act_now, fyi, digest, time_zone, quiet_start, quiet_end, act_now_through_quiet, last_digest_at
          FROM app_notification_settings(${ids}::uuid[])`,
    );
    const result = new Map<string, { person: NotificationSettings; pacts: Map<string, PactNotificationOverride>; lastDigestAt: Date | null }>();
    for (const id of ids) result.set(id, { person: DEFAULT_NOTIFICATION_SETTINGS, pacts: new Map(), lastDigestAt: null });
    for (const row of rows) {
      const entry = result.get(row.user_id);
      if (!entry) continue;
      if (row.last_digest_at) entry.lastDigestAt = new Date(row.last_digest_at);
      else if (row.deal_id) entry.pacts.set(row.deal_id, { actNow: row.act_now as EmailMode | null, fyi: row.fyi as EmailMode | null });
      else
        entry.person = personSettings({ actNow: row.act_now, fyi: row.fyi, digest: row.digest, timeZone: row.time_zone, quietStart: row.quiet_start === null ? null : Number(row.quiet_start), quietEnd: row.quiet_end === null ? null : Number(row.quiet_end), actNowThroughQuiet: row.act_now_through_quiet });
    }
    return result;
  },

  /** Claim one person's pending items for one email; null when another dispatcher already took them. */
  async claim(prisma: PrismaClient, input: { userId: string; kind: DeliveryKind; ids: readonly string[] }): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ delivery: string | null }[]>`SELECT app_notification_claim(${input.userId}::uuid, ${input.kind}, ${[...input.ids]}::uuid[])::text AS delivery`);
    return row?.delivery ?? null;
  },

  async finish(prisma: PrismaClient, input: { deliveryId: string; outcome: DeliveryOutcome; errorClass: string | null }): Promise<boolean> {
    const errorClass = input.errorClass ? input.errorClass.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || 'unknown' : null;
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ done: boolean }[]>`SELECT app_notification_finish(${input.deliveryId}::uuid, ${input.outcome}, ${errorClass}) AS done`);
    return row?.done === true;
  },

  /** Items that are never emailed: in-app only, or no address. */
  async settle(prisma: PrismaClient, input: { ids: readonly string[]; status: 'IN_APP_ONLY' | 'NO_ADDRESS' }): Promise<number> {
    if (input.ids.length === 0) return 0;
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ count: number }[]>`SELECT app_notification_settle(${[...input.ids]}::uuid[], ${input.status}) AS count`);
    return Number(row?.count ?? 0);
  },

  /** Records "a deadline is less than two days away" for letters of intent, once per letter and deadline. */
  async deadlines(prisma: PrismaClient, now: Date): Promise<number> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ count: number }[]>`SELECT app_notify_deadlines(${now}::timestamptz) AS count`);
    return Number(row?.count ?? 0);
  },
};
