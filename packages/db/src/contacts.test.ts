import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskContact } from '@pactlab/domain';
import { contactDispatch, contacts } from './contacts';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CONSENT = 'Pactlab may message me on WhatsApp about pacts that need me. Reply STOP to end.';

/**
 * T-180: contact details are the person's own. A person reads only their own channels; an admin sees
 * them masked and the read is audited; codes and link tokens work once; STOP ends a channel at once.
 */
describe('contact details', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'contacta');
    b = await createSyntheticTenant(db.owner, 'contactb');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
  }, 60_000);
  afterAll(async () => db?.stop());

  const audits = async (action: string, userId: string) =>
    (await db.owner.query<{ outcome: string }>(`SELECT outcome FROM audit_events WHERE action = $1 AND actor_user_id = $2 ORDER BY occurred_at`, [action, userId])).rows.map((row) => row.outcome);

  it('stores a verified identity-provider email once, and never over a confirmed one', async () => {
    expect(await contacts.email(db.prisma, a.context)).toBeNull();
    expect(await contacts.storeVerifiedClaim(db.prisma, a.context, 'Lead@ContactA.test')).toBe(true);
    expect(await contacts.email(db.prisma, a.context)).toMatchObject({ email: 'lead@contacta.test', source: 'AUTH0_CLAIM' });
    expect(await contacts.storeVerifiedClaim(db.prisma, a.context, 'other@contacta.test')).toBe(false);
    expect(await audits('contact.email_verified', a.userId)).toEqual(['SUCCEEDED']);
  });

  it('confirms an email by code: wrong codes count, the right one changes the address and names the old one', async () => {
    expect(await contacts.beginVerification(db.prisma, member.context, { kind: 'EMAIL', target: 'Analyst@ContactA.test', secretHash: hash('123456'), minutes: 10, consentText: null })).not.toBeNull();
    expect(await contacts.confirmEmail(db.prisma, member.context, hash('000000'))).toBeNull();
    expect(await contacts.confirmEmail(db.prisma, member.context, hash('123456'))).toEqual({ previousEmail: null, email: 'analyst@contacta.test' });
    // The code works once.
    expect(await contacts.confirmEmail(db.prisma, member.context, hash('123456'))).toBeNull();
    await contacts.beginVerification(db.prisma, member.context, { kind: 'EMAIL', target: 'new@contacta.test', secretHash: hash('654321'), minutes: 10, consentText: null });
    expect(await contacts.confirmEmail(db.prisma, member.context, hash('654321'))).toEqual({ previousEmail: 'analyst@contacta.test', email: 'new@contacta.test' });
    expect(await audits('contact.email_changed', member.userId)).toEqual(['SUCCEEDED']);
    expect(await audits('contact.verification_failed', member.userId)).toContain('DENIED');
  });

  it('links Telegram from a single-use, expiring token and refuses it twice', async () => {
    await contacts.beginVerification(db.prisma, a.context, { kind: 'TELEGRAM', target: null, secretHash: hash('tg-token-a'), minutes: 10, consentText: null });
    expect(await contacts.linkTelegram(db.prisma, { secretHash: hash('wrong'), chatId: '111' })).toBeNull();
    const channel = await contacts.linkTelegram(db.prisma, { secretHash: hash('tg-token-a'), chatId: '424242' });
    expect(channel).not.toBeNull();
    expect(await contacts.linkTelegram(db.prisma, { secretHash: hash('tg-token-a'), chatId: '424242' })).toBeNull();
    // An expired token is refused.
    await contacts.beginVerification(db.prisma, b.context, { kind: 'TELEGRAM', target: null, secretHash: hash('tg-token-b'), minutes: 10, consentText: null });
    await db.owner.query(`UPDATE contact_verifications SET expires_at = now() - interval '1 second' WHERE secret_hash = $1`, [hash('tg-token-b')]);
    expect(await contacts.linkTelegram(db.prisma, { secretHash: hash('tg-token-b'), chatId: '999' })).toBeNull();
    expect((await contacts.channels(db.prisma, a.context)).map((row) => [row.kind, row.handle])).toEqual([['TELEGRAM', '424242']]);
  });

  it('verifies a WhatsApp number with explicit consent recorded', async () => {
    await contacts.beginVerification(db.prisma, a.context, { kind: 'WHATSAPP', target: '+919876543212', secretHash: hash('wa-111111'), minutes: 10, consentText: CONSENT });
    const id = await contacts.confirmWhatsApp(db.prisma, a.context, hash('wa-111111'));
    expect(id).not.toBeNull();
    const whatsapp = (await contacts.channels(db.prisma, a.context)).find((row) => row.kind === 'WHATSAPP');
    expect(whatsapp).toMatchObject({ handle: '+919876543212', consentText: CONSENT });
    expect(whatsapp?.consentedAt).toBeInstanceOf(Date);
  });

  it('keeps channels to their person: RLS refuses another person and another organization', async () => {
    expect(await contacts.channels(db.prisma, member.context)).toEqual([]);
    expect(await contacts.channels(db.prisma, b.context)).toEqual([]);
    const seen = await withTenant(db.prisma, member.context, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM user_contact_channels`);
    expect(seen[0]?.n).toBe(0);
    const emails = await withTenant(db.prisma, member.context, (tx) => tx.$queryRaw<{ user_id: string }[]>`SELECT user_id::text FROM user_contact_emails`);
    expect(emails.map((row) => row.user_id)).toEqual([member.userId]);
    // The runtime role cannot write the tables directly.
    await expect(withTenant(db.prisma, a.context, (tx) => tx.$executeRaw`UPDATE user_contact_channels SET revoked_at = now()`)).rejects.toThrow();
    // Nor disconnect someone else's channel.
    const [channel] = await contacts.channels(db.prisma, a.context);
    expect(await contacts.revoke(db.prisma, member.context, channel!.id)).toBeNull();
  });

  it('shows an admin masked values only, audits the read, and refuses a non-admin', async () => {
    const page = (await contacts.adminPage(db.prisma, a.context, { limit: 50 })).items;
    const lead = page.find((row) => row.userId === a.userId);
    expect(lead).toMatchObject({ emailMasked: 'l•••@contacta.test', telegramMasked: 'Telegram ••42', whatsappMasked: '+91 •••• ••12' });
    expect(JSON.stringify(page)).not.toContain('9876543212');
    expect(JSON.stringify(page)).not.toContain('lead@');
    expect(await audits('contact.admin_viewed', a.userId)).toEqual(['SUCCEEDED']);
    expect((await contacts.adminPage(db.prisma, member.context, { limit: 50 })).items).toEqual([]);
    // Pages: one row a page reaches every member exactly once.
    const first = await contacts.adminPage(db.prisma, a.context, { limit: 1 });
    const second = await contacts.adminPage(db.prisma, a.context, { limit: 1, cursor: first.nextCursor! });
    expect([first.items[0]?.userId, second.items[0]?.userId].sort()).toEqual([a.userId, member.userId].sort());
    expect(first.total).toBe(2);
    expect(await audits('contact.admin_viewed', member.userId)).toEqual(['DENIED']);
    expect(await contacts.mask(db.prisma, 'WHATSAPP', '+14155550123')).toBe('+1 •••• ••23');
    // The database and the domain mask alike.
    for (const value of ['+447700900123', '+4915112345678', '+33612345678', '+819012345678', '+35312345678', '+919876543212']) {
      expect(await contacts.mask(db.prisma, 'WHATSAPP', value)).toBe(maskContact('WHATSAPP', value));
    }
    expect(await contacts.mask(db.prisma, 'EMAIL', 'kumar@example.com')).toBe(maskContact('EMAIL', 'kumar@example.com'));
  });

  it('claims a notification once per channel, and STOP ends every message at once', async () => {
    const [channel] = (await contactDispatch.channels(db.prisma, [a.userId])).filter((row) => row.kind === 'WHATSAPP');
    const [notification, event] = ['00000000-0000-7000-8000-00000000c180', '00000000-0000-7000-8000-00000000e180'];
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility)
       VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', 'contacts-test', $4, 'SHARED')`,
      [event, a.organizationId, a.dealId, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`, [notification, a.organizationId, a.dealId, event, a.userId]);
    const delivery = await contactDispatch.claim(db.prisma, { channelId: channel!.channelId, notificationId: notification });
    expect(delivery).not.toBeNull();
    expect(await contactDispatch.claim(db.prisma, { channelId: channel!.channelId, notificationId: notification })).toBeNull();
    expect(await contactDispatch.finish(db.prisma, { deliveryId: delivery!, outcome: 'SENT', errorClass: null })).toBe(true);
    // A test message is the person's own: another person cannot claim one on this channel.
    expect(await contactDispatch.claimTest(db.prisma, member.context, channel!.channelId)).toBeNull();
    expect(await contactDispatch.claimTest(db.prisma, a.context, channel!.channelId)).not.toBeNull();
    expect(await contacts.stop(db.prisma, { kind: 'WHATSAPP', handle: '+919876543212', reason: 'STOP' })).toBe(1);
    expect((await contactDispatch.channels(db.prisma, [a.userId])).map((row) => row.kind)).toEqual(['TELEGRAM']);
    expect(await audits('contact.whatsapp_stopped', a.userId)).toEqual(['SUCCEEDED']);
    expect(await contacts.stop(db.prisma, { kind: 'TELEGRAM', handle: '424242', reason: 'BLOCKED' })).toBe(1);
    expect(await contactDispatch.channels(db.prisma, [a.userId])).toEqual([]);
  });

  it('limits a person to 5 verification requests of a kind per 15 minutes', async () => {
    const results: (string | null)[] = [];
    for (let i = 0; i < 6; i += 1) results.push(await contacts.beginVerification(db.prisma, b.context, { kind: 'EMAIL', target: `x${i}@contactb.test`, secretHash: hash(`b${i}`), minutes: 10, consentText: null }));
    expect(results.filter((id) => id === null)).toHaveLength(1);
    expect(results.at(-1)).toBeNull();
  });
  it('links LINE only after both steps, stores no user id while waiting, and unfollow stops it (T-182)', async () => {
    const lineUser = `U${'1'.repeat(30)}ab`;
    const userHash = hash(`line:${lineUser}`);
    await contacts.beginVerification(db.prisma, b.context, { kind: 'LINE', target: null, secretHash: hash('line-state-b'), minutes: 10, consentText: null });
    // Another person cannot use b's login state.
    expect(await contacts.lineLogin(db.prisma, a.context, { stateHash: hash('line-state-b'), lineUserHash: userHash, lineUserId: lineUser, friend: true })).toBeNull();
    expect(await contacts.lineLogin(db.prisma, b.context, { stateHash: hash('line-state-b'), lineUserHash: userHash, lineUserId: lineUser, friend: false })).toBe('AWAITING_FRIEND');
    // Used once.
    expect(await contacts.lineLogin(db.prisma, b.context, { stateHash: hash('line-state-b'), lineUserHash: userHash, lineUserId: lineUser, friend: true })).toBeNull();
    // Not a friend yet: no channel and no LINE user id anywhere in the tables.
    expect((await contacts.channels(db.prisma, b.context)).filter((row) => row.kind === 'LINE')).toEqual([]);
    const stored = await db.owner.query(`SELECT count(*)::int AS n FROM contact_verifications WHERE target = $1 OR secret_hash = $1`, [lineUser]);
    expect(stored.rows[0]).toEqual({ n: 0 });
    // A follow from someone nobody waits for does nothing; the right one connects, once.
    expect(await contacts.lineFollow(db.prisma, { lineUserHash: hash('line:other'), lineUserId: `U${'2'.repeat(32)}` })).toBeNull();
    expect(await contacts.lineFollow(db.prisma, { lineUserHash: userHash, lineUserId: lineUser })).not.toBeNull();
    expect(await contacts.lineFollow(db.prisma, { lineUserHash: userHash, lineUserId: lineUser })).toBeNull();
    expect((await contacts.channels(db.prisma, b.context)).map((row) => [row.kind, row.handle])).toContainEqual(['LINE', lineUser]);
    expect(await audits('contact.line_connected', b.userId)).toEqual(['SUCCEEDED']);
    // RLS: another person never reads it.
    expect((await contacts.channels(db.prisma, a.context)).some((row) => row.kind === 'LINE')).toBe(false);
    expect(await contacts.mask(db.prisma, 'LINE', lineUser)).toBe(maskContact('LINE', lineUser));
    // Unfollow (block) stops it at once.
    expect(await contacts.stop(db.prisma, { kind: 'LINE', handle: lineUser, reason: 'BLOCKED' })).toBe(1);
    expect((await contactDispatch.channels(db.prisma, [b.userId])).some((row) => row.kind === 'LINE')).toBe(false);
    expect(await audits('contact.line_stopped', b.userId)).toEqual(['SUCCEEDED']);
  });

  it('connects LINE at once when the person is already a friend, and counts LINE sends for operators only', async () => {
    const lineUser = `U${'3'.repeat(32)}`;
    await contacts.beginVerification(db.prisma, member.context, { kind: 'LINE', target: null, secretHash: hash('line-state-m'), minutes: 10, consentText: null });
    expect(await contacts.lineLogin(db.prisma, member.context, { stateHash: hash('line-state-m'), lineUserHash: hash(`line:${lineUser}`), lineUserId: lineUser, friend: true })).toBe('CONNECTED');
    const [channel] = (await contactDispatch.channels(db.prisma, [member.userId])).filter((row) => row.kind === 'LINE');
    const delivery = await contactDispatch.claimTest(db.prisma, member.context, channel!.channelId);
    await contactDispatch.finish(db.prisma, { deliveryId: delivery!, outcome: 'FAILED', errorClass: 'LineAllowanceReached' });
    await expect(contactDispatch.lineMonth(db.prisma, member.userId)).rejects.toThrow();
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [b.userId]);
    expect(await contactDispatch.lineMonth(db.prisma, b.userId)).toMatchObject({ heldBack: 1 });
    const page = await contacts.adminPage(db.prisma, a.context, { limit: 25 });
    expect(page.items.find((row) => row.userId === member.userId)?.lineMasked).toBe(maskContact('LINE', lineUser));
  });
});
