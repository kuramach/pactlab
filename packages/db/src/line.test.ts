import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskContact } from '@pactlab/domain';
import { contactDispatch, contacts, lineQuota } from './contacts';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

// Fictional LINE user IDs (the documented shape: U and 32 hex digits).
const LINE_A = `U${'a'.repeat(30)}0f`;
const LINE_B = `U${'b'.repeat(30)}1e`;

/**
 * T-182: a LINE user ID becomes a person's channel only after LINE Login and the friendship; `unfollow` stops it
 * at once; the runtime role sees only its own row; every push comes out of the monthly allowance.
 */
describe('LINE channel', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'linea');
    b = await createSyntheticTenant(db.owner, 'lineb');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
  }, 60_000);
  afterAll(async () => db?.stop());

  const audits = async (action: string, userId: string) =>
    (await db.owner.query<{ outcome: string }>(`SELECT outcome FROM audit_events WHERE action = $1 AND target_id = $2 ORDER BY occurred_at`, [action, userId])).rows.map((row) => row.outcome);

  it('connects at once when LINE Login says the person is already a friend', async () => {
    expect(await contacts.connectLine(db.prisma, a.context, { lineUserId: LINE_A, friend: true })).toBe('LINKED');
    expect((await contacts.channels(db.prisma, a.context)).map((row) => [row.kind, row.handle])).toEqual([['LINE', LINE_A]]);
    expect(await contacts.linePending(db.prisma, a.context)).toBe(false);
    expect(await audits('contact.line_connected', a.userId)).toEqual(['SUCCEEDED']);
  });

  it('waits for the follow when the person is not a friend yet, and completes it once', async () => {
    expect(await contacts.connectLine(db.prisma, member.context, { lineUserId: LINE_B, friend: false })).toBe('PENDING');
    expect(await contacts.channels(db.prisma, member.context)).toEqual([]);
    expect(await contacts.linePending(db.prisma, member.context)).toBe(true);
    expect(await contacts.lineFollowed(db.prisma, LINE_B)).toBe(true);
    expect((await contacts.channels(db.prisma, member.context)).map((row) => row.handle)).toEqual([LINE_B]);
    // A redelivered follow changes nothing.
    expect(await contacts.lineFollowed(db.prisma, LINE_B)).toBe(false);
    // A follow from a LINE user nobody connected makes nothing.
    expect(await contacts.lineFollowed(db.prisma, `U${'c'.repeat(32)}`)).toBe(false);
    expect(await contacts.connectLine(db.prisma, member.context, { lineUserId: 'not-a-line-id', friend: true })).toBeNull();
  });

  it('keeps a LINE user ID to its person: RLS refuses another person and another organization', async () => {
    const seen = await withTenant(db.prisma, b.context, (tx) => tx.$queryRaw<{ handle: string }[]>`SELECT handle FROM user_contact_channels`);
    expect(seen).toEqual([]);
    const own = await withTenant(db.prisma, member.context, (tx) => tx.$queryRaw<{ handle: string }[]>`SELECT handle FROM user_contact_channels`);
    expect(own.map((row) => row.handle)).toEqual([LINE_B]);
    await expect(withTenant(db.prisma, a.context, (tx) => tx.$executeRaw`UPDATE user_contact_channels SET handle = handle`)).rejects.toThrow();
    await expect(withTenant(db.prisma, a.context, (tx) => tx.$queryRaw`SELECT * FROM line_monthly_usage`)).rejects.toThrow();
  });

  it('shows an admin the LINE channel masked, and nothing to a non-admin', async () => {
    const page = (await contacts.adminPage(db.prisma, a.context, { limit: 50 })).items;
    expect(page.find((row) => row.userId === a.userId)?.lineMasked).toBe(maskContact('LINE', LINE_A));
    expect(await contacts.mask(db.prisma, 'LINE', LINE_A)).toBe('LINE ••0f');
    expect(JSON.stringify(page)).not.toContain(LINE_A);
    expect((await contacts.adminPage(db.prisma, member.context, { limit: 50 })).items).toEqual([]);
  });

  it('stops at once on unfollow, so nothing more is dispatched', async () => {
    expect((await contactDispatch.channels(db.prisma, [member.userId])).map((row) => row.kind)).toEqual(['LINE']);
    expect(await contacts.stop(db.prisma, { kind: 'LINE', handle: LINE_B, reason: 'BLOCKED' })).toBe(1);
    expect(await contactDispatch.channels(db.prisma, [member.userId])).toEqual([]);
    expect(await audits('contact.line_stopped', member.userId)).toEqual(['SUCCEEDED']);
  });

  it('takes pushes from the monthly allowance and refuses beyond it; operators read the count', async () => {
    await db.owner.query(`DELETE FROM line_monthly_usage`);
    expect(await lineQuota.take(db.prisma, 2)).toBe(true);
    expect(await lineQuota.take(db.prisma, 2)).toBe(true);
    expect(await lineQuota.take(db.prisma, 2)).toBe(false);
    await lineQuota.release(db.prisma);
    // Once reached, the month stays stopped.
    expect(await lineQuota.take(db.prisma, 2)).toBe(false);
    await expect(lineQuota.usage(db.prisma, a.userId)).rejects.toThrow();
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [a.userId]);
    const usage = await lineQuota.usage(db.prisma, a.userId);
    expect(usage.sent).toBe(1);
    expect(usage.reachedAt).not.toBeNull();
    await db.owner.query(`DELETE FROM line_monthly_usage`);
    await lineQuota.exhausted(db.prisma);
    expect(await lineQuota.take(db.prisma, 200)).toBe(false);
    await db.owner.query(`DELETE FROM line_monthly_usage`);
  });
});
