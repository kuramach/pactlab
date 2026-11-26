import { newId, type DealId, type OrganizationId, type TenantContext, type UserId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAuditEvent } from './audit';
import { notificationDispatch, notificationInbox, notificationPreferences, recordPactEvent, type PactEventInput } from './notifications';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/**
 * T-145: recipients follow access. A seller is never told of a buyer-only finding or valuation, a
 * bidder hears only of their own bid, nobody outside the pact hears anything, and a claimed email
 * is never claimed twice.
 */
describe('pact notifications', () => {
  let db: TestDatabase;
  let buyer: SyntheticTenant;
  let other: SyntheticTenant;
  let analyst: { userId: string; context: TenantContext };
  let seller: { userId: string; context: TenantContext };
  let bidderA: { userId: string; context: TenantContext };
  let bidA: string;
  let bidB: string;

  async function addBidder(bid: string, label: string) {
    const userId = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, `${label}@bidder.test`]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5)`, [newId(), buyer.organizationId, buyer.dealId, userId, bid]);
    const context: TenantContext = { organizationId: buyer.organizationId as OrganizationId, userId: userId as UserId, organizationRole: 'GUEST', dealIds: [buyer.dealId as DealId] };
    return { userId, context };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    buyer = await createSyntheticTenant(db.owner, 'notifybuyer');
    other = await createSyntheticTenant(db.owner, 'notifyother');
    await db.owner.query(`UPDATE users SET email = 'lead@buyer.test' WHERE id = $1`, [buyer.userId]);
    analyst = await addSyntheticDealMember(db.owner, buyer, 'ANALYST');
    seller = await addSyntheticDealMember(db.owner, buyer, 'TARGET_CONTRIBUTOR');
    [bidA, bidB] = [newId(), newId()];
    for (const [id, firm] of [[bidA, 'Firm A'], [bidB, 'Firm B']] as const) {
      await db.owner.query(`INSERT INTO bids (id, organization_id, deal_id, firm_name, created_by) VALUES ($1, $2, $3, $4, $5)`, [id, buyer.organizationId, buyer.dealId, firm, buyer.userId]);
    }
    bidderA = await addBidder(bidA, 'bidder-a');
    await addBidder(bidB, 'bidder-b');
  }, 60_000);
  afterAll(async () => db?.stop());

  const record = (context: TenantContext, dealId: string, event: PactEventInput) => withTenant(db.prisma, context, (tx) => recordPactEvent(tx, dealId, event));
  const recipients = async (dedupeKey: string) => {
    const result = await db.owner.query<{ user_id: string }>(`SELECT n.user_id FROM notifications n JOIN notification_events e ON e.id = n.event_id WHERE e.dedupe_key = $1 ORDER BY n.user_id`, [dedupeKey]);
    return result.rows.map((row) => row.user_id).sort();
  };

  it('never tells a counterparty of a buyer-only finding, and never the person who made it', async () => {
    await record(buyer.context, buyer.dealId, { type: 'FINDING_DRAFTED', dedupeKey: 'finding:1', visibility: 'BUYER_ONLY', audience: 'ALL', recordId: newId() });
    expect(await recipients('finding:1')).toEqual([analyst.userId].sort());
  });

  it('tells the seller of a shared document, and a bidder only of their own bid', async () => {
    await record(analyst.context, buyer.dealId, { type: 'DOCUMENT_ADDED', dedupeKey: 'doc:1', visibility: 'SHARED', audience: 'COUNTERPARTY', bidId: bidA });
    expect(await recipients('doc:1')).toEqual([seller.userId, bidderA.userId].sort());
  });

  it('reaches the other side’s lead only, and records an event once', async () => {
    const event: PactEventInput = { type: 'TERMS_COUNTERED', dedupeKey: 'terms:1', visibility: 'SHARED', audience: 'OWN_LEADS' };
    expect(await record(seller.context, buyer.dealId, event)).toBe(1);
    expect(await record(seller.context, buyer.dealId, event)).toBe(0);
    expect(await recipients('terms:1')).toEqual([buyer.userId]);
  });

  it('keeps a buyer-only event a counterparty causes to the own side, and refuses any event from outside the pact', async () => {
    await record(seller.context, buyer.dealId, { type: 'FINDING_DRAFTED', dedupeKey: 'finding:from-seller-import', visibility: 'BUYER_ONLY', audience: 'ALL' });
    expect(await recipients('finding:from-seller-import')).toEqual([buyer.userId, analyst.userId].sort());
    await expect(record(other.context, buyer.dealId, { type: 'MEMBER_ADDED', dedupeKey: 'member:x', visibility: 'SHARED', audience: 'ALL' })).rejects.toThrow();
    expect(await recipients('member:x')).toEqual([]);
  });

  it('records the event through the change’s own audit write', async () => {
    await withTenant(db.prisma, buyer.context, (tx) =>
      appendAuditEvent(tx, { organizationId: buyer.organizationId, dealId: buyer.dealId, actorUserId: buyer.userId, action: 'valuation.submitted', targetType: 'valuation_scenario', targetId: 's1', outcome: 'SUCCEEDED', notify: { type: 'VALUATION_SUBMITTED', dedupeKey: 'val:1', visibility: 'BUYER_ONLY', audience: 'OWN_SIDE' } }),
    );
    expect(await recipients('val:1')).toEqual([analyst.userId]);
  });

  it('shows a person only their own items, and marks them read', async () => {
    const sellerInbox = await notificationInbox.page(db.prisma, seller.context, { limit: 50 });
    expect(sellerInbox.items.map((item) => item.type)).toEqual(['DOCUMENT_ADDED']);
    expect(sellerInbox.items[0]?.link).toBe(`/deals/${buyer.dealId}/documents`);
    const analystInbox = await notificationInbox.page(db.prisma, analyst.context, { limit: 1 });
    expect(analystInbox.total).toBe(3);
    expect(analystInbox.nextCursor).not.toBeNull();
    const next = await notificationInbox.page(db.prisma, analyst.context, { limit: 50, cursor: analystInbox.nextCursor ?? undefined });
    expect(next.items).toHaveLength(2);
    expect(await notificationInbox.markRead(db.prisma, seller.context, analystInbox.items[0]!.id)).toBe(false);
    expect(await notificationInbox.markRead(db.prisma, analyst.context, analystInbox.items[0]!.id)).toBe(true);
    expect(await notificationInbox.unreadCount(db.prisma, analyst.context)).toBe(2);
    expect(await notificationInbox.markAllRead(db.prisma, analyst.context)).toBe(2);
    expect(await notificationInbox.unreadCount(db.prisma, analyst.context)).toBe(0);
    expect((await notificationInbox.page(db.prisma, other.context, { limit: 50 })).total).toBe(0);
  });

  it('hides a buyer-only item once its person is no longer on the own side', async () => {
    await db.owner.query(`UPDATE deal_memberships SET role = 'TARGET_CONTRIBUTOR' WHERE user_id = $1`, [analyst.userId]);
    expect((await notificationInbox.page(db.prisma, analyst.context, { limit: 50 })).total).toBe(0);
    await db.owner.query(`UPDATE deal_memberships SET role = 'ANALYST' WHERE user_id = $1`, [analyst.userId]);
  });

  it('keeps preferences per person and per pact, own rows only', async () => {
    await notificationPreferences.set(db.prisma, seller.context, { actNow: 'EMAIL_NOW', fyi: 'IN_APP', digest: 'HOURLY', timeZone: 'Europe/London', quietStart: 1320, quietEnd: 420, actNowThroughQuiet: true });
    await notificationPreferences.setPact(db.prisma, seller.context, buyer.dealId, { actNow: null, fyi: 'EMAIL_NOW' });
    expect((await notificationPreferences.get(db.prisma, seller.context)).fyi).toBe('IN_APP');
    expect(await notificationPreferences.getPact(db.prisma, seller.context, buyer.dealId)).toEqual({ actNow: null, fyi: 'EMAIL_NOW' });
    expect((await notificationPreferences.get(db.prisma, analyst.context)).fyi).toBe('EMAIL_DIGEST');
    await expect(notificationPreferences.setPact(db.prisma, other.context, buyer.dealId, { actNow: 'IN_APP', fyi: null })).rejects.toThrow();
    const settings = await notificationDispatch.settings(db.prisma, [seller.userId]);
    expect(settings.get(seller.userId)?.person.timeZone).toBe('Europe/London');
    expect(settings.get(seller.userId)?.pacts.get(buyer.dealId)?.fyi).toBe('EMAIL_NOW');
  });

  it('claims an email once, however many times it is retried', async () => {
    const pending = (await notificationDispatch.pendingPage(db.prisma, { after: null, limit: 100 })).filter((item) => item.userId === buyer.userId && item.type === 'TERMS_COUNTERED');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe('lead@buyer.test');
    expect(pending[0]?.dealName).toBe(buyer.dealName);
    const ids = pending.map((item) => item.id);
    const delivery = await notificationDispatch.claim(db.prisma, { userId: buyer.userId, kind: 'IMMEDIATE', ids });
    expect(delivery).not.toBeNull();
    expect(await notificationDispatch.claim(db.prisma, { userId: buyer.userId, kind: 'IMMEDIATE', ids })).toBeNull();
    expect(await notificationDispatch.finish(db.prisma, { deliveryId: delivery!, outcome: 'SENT', errorClass: null })).toBe(true);
    expect(await notificationDispatch.finish(db.prisma, { deliveryId: delivery!, outcome: 'FAILED', errorClass: 'Again' })).toBe(false);
    const items = await notificationInbox.page(db.prisma, buyer.context, { limit: 50 });
    expect(items.items.find((item) => item.id === ids[0])?.emailStatus).toBe('SENT');
  });

  it('records a letter’s exclusivity running out once, for both sides', async () => {
    const batch = newId();
    await db.owner.query(`INSERT INTO term_proposal_batches (id, organization_id, deal_id, version, currency, initiated_by_side, created_by) VALUES ($1, $2, $3, 1, 'USD', 'SELLER', $4)`, [batch, buyer.organizationId, buyer.dealId, buyer.userId]);
    await db.owner.query(
      `INSERT INTO loi_versions (id, organization_id, deal_id, batch_id, version, status, fields, created_by, sent_at, countersigned_at, exclusivity_ends_at)
       VALUES ($1, $2, $3, $4, 1, 'COUNTERSIGNED', '{}'::jsonb, $5, now(), now(), now() + interval '1 day')`,
      [newId(), buyer.organizationId, buyer.dealId, batch, buyer.userId],
    );
    expect(await notificationDispatch.deadlines(db.prisma, new Date())).toBe(3);
    expect(await notificationDispatch.deadlines(db.prisma, new Date())).toBe(0);
  });
});
