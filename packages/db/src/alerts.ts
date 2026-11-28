import { ALERT_CHANNELS, DEFAULT_ALERT_CHANNELS, type AlertChannel, type AlertChannelPreferences, type TenantContext } from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE, withTenant } from './tenant';

/**
 * Urgent pact alerts (T-146): a person's devices for web push, their channel choices, and the alert
 * ledger the daily cap and the 15-minute fold count. Writes go through SECURITY DEFINER functions
 * acting on the signed-in person (or, for the dispatcher, on no session). A subscription's endpoint
 * and keys are personal data: never logged, never returned to anyone but the push sender.
 */

async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

const known = (values: readonly string[]): AlertChannel[] => values.filter((value): value is AlertChannel => (ALERT_CHANNELS as readonly string[]).includes(value));

export interface PushDevice {
  readonly id: string;
  readonly label: string;
  readonly createdAt: Date;
  readonly lastSentAt: Date | null;
}

/** Where a push goes: the endpoint and the keys it is encrypted to. */
export interface PushTarget {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PendingAlertItem {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly createdAt: Date;
}

export type AlertTake = { readonly decision: 'ALERT'; readonly alertId: string } | { readonly decision: 'FOLD' | 'CAPPED' | 'NONE' };

export const pushSubscriptions = {
  /** The signed-in person's live devices, newest first. Bounded: at most 10 live a person (the function ends the oldest). */
  async list(prisma: PrismaClient, tenant: TenantContext): Promise<PushDevice[]> {
    return withTenant(prisma, tenant, async (tx) => {
      // bounded: at most 10 live subscriptions per person (app_push_subscribe ends the oldest)
      const rows = await tx.pushSubscription.findMany({
        where: { userId: tenant.userId, organizationId: tenant.organizationId, revokedAt: null },
        select: { id: true, deviceLabel: true, createdAt: true, lastSentAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({ id: row.id, label: row.deviceLabel, createdAt: row.createdAt, lastSentAt: row.lastSentAt }));
    });
  },

  async subscribe(prisma: PrismaClient, tenant: TenantContext, input: { endpoint: string; p256dh: string; auth: string; label: string }): Promise<string | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_push_subscribe(${input.endpoint}, ${input.p256dh}, ${input.auth}, ${input.label})::text AS id`;
      return row?.id ?? null;
    });
  },

  async unsubscribe(prisma: PrismaClient, tenant: TenantContext, id: string): Promise<boolean> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_push_unsubscribe(${id}::uuid) AS ok`;
      return row?.ok === true;
    });
  },

  /** The person's own device, for a test alert (3 an hour). Null when refused. */
  async claimTest(prisma: PrismaClient, tenant: TenantContext, id: string): Promise<{ deliveryId: string; target: Omit<PushTarget, 'userId'> } | null> {
    return withTenant(prisma, tenant, async (tx) => {
      const [row] = await tx.$queryRaw<{ delivery_id: string; endpoint: string; p256dh: string; auth: string }[]>`
        SELECT delivery_id::text, endpoint, p256dh, auth FROM app_push_test_claim(${id}::uuid)`;
      return row ? { deliveryId: row.delivery_id, target: { subscriptionId: id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth } } : null;
    });
  },

  async targets(prisma: PrismaClient, userIds: readonly string[]): Promise<PushTarget[]> {
    if (userIds.length === 0) return [];
    return asApp(prisma, async (tx) => {
      // bounded: at most 10 live subscriptions for each person in a dispatcher page
      const rows = await tx.$queryRaw<{ subscription_id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[]>`
        SELECT subscription_id::text, user_id::text, endpoint, p256dh, auth FROM app_push_dispatch_targets(${[...userIds]}::uuid[])`;
      return rows.map((row) => ({ subscriptionId: row.subscription_id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
    });
  },

  async claim(prisma: PrismaClient, input: { subscriptionId: string; alertId: string }): Promise<string | null> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app_push_delivery_claim(${input.subscriptionId}::uuid, ${input.alertId}::uuid)::text AS id`;
      return row?.id ?? null;
    });
  },

  async finish(prisma: PrismaClient, input: { deliveryId: string; outcome: 'SENT' | 'FAILED' | 'EXPIRED'; errorClass: string | null }): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const errorClass = input.errorClass ? input.errorClass.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'unknown' : null;
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_push_delivery_finish(${input.deliveryId}::uuid, ${input.outcome}, ${errorClass}) AS ok`;
      return row?.ok === true;
    });
  },

  /** The push service said 404 or 410: the subscription is gone. */
  async expire(prisma: PrismaClient, subscriptionId: string): Promise<boolean> {
    return asApp(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_push_expire(${subscriptionId}::uuid) AS ok`;
      return row?.ok === true;
    });
  },
};

/** The signed-in person's channel choices (Settings → Notifications). */
export const alertPreferences = {
  async get(prisma: PrismaClient, tenant: TenantContext): Promise<AlertChannelPreferences> {
    const row = await withTenant(prisma, tenant, (tx) => tx.notificationChannelPreference.findUnique({ where: { userId: tenant.userId } }));
    return row ? { off: known(row.channelsOff) } : DEFAULT_ALERT_CHANNELS;
  },

  async set(prisma: PrismaClient, tenant: TenantContext, preferences: AlertChannelPreferences): Promise<AlertChannelPreferences> {
    const off = [...new Set(preferences.off)];
    await withTenant(prisma, tenant, (tx) =>
      tx.notificationChannelPreference.upsert({ where: { userId: tenant.userId }, create: { userId: tenant.userId, channelsOff: off }, update: { channelsOff: off, updatedAt: new Date() } }),
    );
    return { off };
  },
};

/** The dispatcher's side of alerts: what is due, people's choices, and the cap and fold. */
export const alertDispatch = {
  async pendingPage(prisma: PrismaClient, input: { now: Date; after: string | null; limit: number }): Promise<PendingAlertItem[]> {
    const rows = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ notification_id: string; user_id: string; organization_id: string; deal_id: string; created_at: Date }[]>`
        SELECT notification_id::text, user_id::text, organization_id::text, deal_id::text, created_at
          FROM app_channel_pending(${input.now}::timestamptz, ${input.after}::uuid, ${input.limit}::int)`,
    );
    return rows.map((row) => ({ id: row.notification_id, userId: row.user_id, organizationId: row.organization_id, dealId: row.deal_id, createdAt: new Date(row.created_at) }));
  },

  async preferences(prisma: PrismaClient, userIds: readonly string[]): Promise<Map<string, AlertChannelPreferences>> {
    const result = new Map<string, AlertChannelPreferences>();
    if (userIds.length === 0) return result;
    const rows = await asApp(prisma, (tx) => tx.$queryRaw<{ user_id: string; channels_off: string[] }[]>`SELECT user_id::text, channels_off FROM app_channel_preferences(${[...new Set(userIds)]}::uuid[])`);
    for (const row of rows) result.set(row.user_id, { off: known(row.channels_off) });
    return result;
  },

  /** The cap and the fold, decided under the person's lock (mirrors `decideAlert`). */
  async take(prisma: PrismaClient, input: { userId: string; dealId: string; ids: readonly string[]; now: Date; cap: number; foldMinutes: number }): Promise<AlertTake> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ decision: string; alert_id: string | null }[]>`
        SELECT decision, alert_id::text FROM app_channel_alert_take(${input.userId}::uuid, ${input.dealId}::uuid, ${[...input.ids]}::uuid[], ${input.now}::timestamptz, ${input.cap}::int, ${input.foldMinutes}::int)`,
    );
    if (row?.decision === 'ALERT' && row.alert_id) return { decision: 'ALERT', alertId: row.alert_id };
    return { decision: (row?.decision ?? 'NONE') as 'FOLD' | 'CAPPED' | 'NONE' };
  },

  async skip(prisma: PrismaClient, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT app_channel_alert_skip(${[...ids]}::uuid[]) AS n`);
    return Number(row?.n ?? 0);
  },
};
