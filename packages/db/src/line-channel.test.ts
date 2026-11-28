import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contactDispatch, contacts } from './contacts';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const LEAD = 'U0123456789abcdef0123456789abcdef';
const OTHER = 'Ufedcba9876543210fedcba9876543210';

/**
 * T-182: a LINE user id is stored against a person only after LINE Login and the friend added; until
 * then only a keyed hash. Unfollow ends the channel. The monthly allowance is one platform-wide count,
 * claimed under a lock, so two dispatchers never both send past it.
 */
describe('LINE channel', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;
  const now = new Date();

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'linea');
    b = await createSyntheticTenant(db.owner, 'lineb');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
  }, 60_000);
  afterAll(async () => db?.stop());

  const begin = (tenant: SyntheticTenant['context'], state: string) =>
    contacts.beginVerification(db.prisma, tenant, {
      kind: 'LINE',
      target: null,
      secretHash: hash(state),
      minutes: 10,
      consentText: null,
    });

  it('waits for the friend holding only a hash, then links on follow, once', async () => {
    await begin(a.context, 'state-a');
    // Someone else's state is not theirs to complete.
    expect(
      await contacts.completeLineLogin(db.prisma, member.context, {
        stateHash: hash('state-a'),
        userHash: hash(`u:${LEAD}`),
        lineUserId: LEAD,
        isFriend: true,
      }),
    ).toEqual({ status: 'INVALID', channelId: null });
    expect(
      await contacts.completeLineLogin(db.prisma, a.context, {
        stateHash: hash('state-a'),
        userHash: hash(`u:${LEAD}`),
        lineUserId: LEAD,
        isFriend: false,
      }),
    ).toEqual({ status: 'AWAITING_FRIEND', channelId: null });
    expect(await contacts.linePending(db.prisma, a.context)).toBe(true);
    expect(await contacts.linePending(db.prisma, member.context)).toBe(false);
    const raw = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contact_verifications v WHERE v::text LIKE $1`,
      [`%${LEAD}%`],
    );
    expect(raw.rows[0]?.n).toBe(0);
    // The same state cannot be completed again.
    expect(
      (
        await contacts.completeLineLogin(db.prisma, a.context, {
          stateHash: hash('state-a'),
          userHash: hash(`u:${LEAD}`),
          lineUserId: LEAD,
          isFriend: true,
        })
      ).status,
    ).toBe('INVALID');
    // A follow from someone else links nothing.
    expect(
      await contacts.lineFollow(db.prisma, { userHash: hash(`u:${OTHER}`), lineUserId: OTHER }),
    ).toBeNull();
    expect(
      await contacts.lineFollow(db.prisma, { userHash: hash(`u:${LEAD}`), lineUserId: LEAD }),
    ).not.toBeNull();
    expect(
      await contacts.lineFollow(db.prisma, { userHash: hash(`u:${LEAD}`), lineUserId: LEAD }),
    ).toBeNull();
    expect(
      (await contacts.channels(db.prisma, a.context)).map((row) => [row.kind, row.handle]),
    ).toEqual([['LINE', LEAD]]);
    // The hash is cleared once linked.
    const left = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contact_verifications WHERE kind = 'LINE' AND target IS NOT NULL`,
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it('keeps the channel to its person and organization, and refuses a handle that is not a LINE user id', async () => {
    expect(await contacts.channels(db.prisma, member.context)).toEqual([]);
    expect(await contacts.channels(db.prisma, b.context)).toEqual([]);
    const seen = await withTenant(
      db.prisma,
      b.context,
      (tx) =>
        tx.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM user_contact_channels WHERE kind = 'LINE'`,
    );
    expect(seen[0]?.n).toBe(0);
    await expect(
      db.owner.query(
        `INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at) VALUES (uuidv7(), $1, $2, 'LINE', 'not-a-line-id', now())`,
        [b.organizationId, b.userId],
      ),
    ).rejects.toThrow();
  });

  it('stops at the monthly allowance under concurrent claims, and records the month once', async () => {
    const [channel] = (await contactDispatch.channels(db.prisma, [a.userId])).filter(
      (row) => row.kind === 'LINE',
    );
    const notifications: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [event, notification] = [crypto.randomUUID(), crypto.randomUUID()];
      await db.owner.query(
        `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
        [event, a.organizationId, a.dealId, `line-${i}`, `/deals/${a.dealId}/terms`],
      );
      await db.owner.query(
        `INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`,
        [notification, a.organizationId, a.dealId, event, a.userId],
      );
      notifications.push(notification);
    }
    const claims = await Promise.all(
      notifications.map((notificationId) =>
        contactDispatch.claimLine(db.prisma, {
          channelId: channel!.channelId,
          notificationId,
          now,
          allowance: 3,
        }),
      ),
    );
    expect(claims.filter((claim) => claim.deliveryId)).toHaveLength(3);
    expect(claims.filter((claim) => claim.reached)).toHaveLength(2);
    const months = await db.owner.query<{ allowance: number }>(
      `SELECT allowance FROM line_allowance_months`,
    );
    expect(months.rows).toEqual([{ allowance: 3 }]);
    expect(await contactDispatch.lineAllowanceNotify(db.prisma, now)).toBe(true);
    expect(await contactDispatch.lineAllowanceNotify(db.prisma, now)).toBe(false);
    // A failed send does not count; but once the month is reached it stays reached.
    expect(
      (
        await contactDispatch.claimLine(db.prisma, {
          channelId: channel!.channelId,
          notificationId: null,
          now,
          allowance: 200,
          tenant: a.context,
        })
      ).reached,
    ).toBe(true);
    // Operators only.
    await expect(contacts.lineAllowance(db.prisma, a.userId, now)).rejects.toThrow();
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [a.userId]);
    expect(await contacts.lineAllowance(db.prisma, a.userId, now)).toMatchObject({
      used: 3,
      reachedAt: expect.any(Date),
    });
  });

  it('unfollow ends the channel at once', async () => {
    expect(await contacts.stop(db.prisma, { kind: 'LINE', handle: LEAD, reason: 'BLOCKED' })).toBe(
      1,
    );
    expect(
      (await contactDispatch.channels(db.prisma, [a.userId])).filter((row) => row.kind === 'LINE'),
    ).toEqual([]);
    const audit = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.line_stopped' AND actor_user_id = $1`,
      [a.userId],
    );
    expect(audit.rows[0]?.n).toBe(1);
  });
});
