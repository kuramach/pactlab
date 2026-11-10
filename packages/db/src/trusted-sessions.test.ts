import { createHash } from 'node:crypto';
import { newId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authSessions, emailLogin, type EmailLoginSession } from './login';
import { startTestDatabase, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const HOUR = 3_600_000;

/** T-112: trusted devices — longer sign-ins within the organization's cap, ending when idle. */
describe('trusted sessions', () => {
  let db: TestDatabase;
  let counter = 0;

  async function organization(label: string, capHours = 168): Promise<string> {
    const id = newId();
    await db.owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, trusted_session_max_hours, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', $4, now())`,
      [id, `${label} (synthetic)`, `${label.toLowerCase()}-${id.slice(-8)}`, capHours],
    );
    return id;
  }

  async function member(organizationIds: string[]): Promise<{ userId: string; subject: string; email: string }> {
    const userId = newId();
    const subject = `pactlab|${userId}`;
    const email = `trusted-${userId.slice(-8)}@example.test`;
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Trusted (synthetic)', $3)`, [userId, subject, email]);
    for (const organizationId of organizationIds) {
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), organizationId, userId]);
    }
    return { userId, subject, email };
  }

  async function signIn(email: string): Promise<EmailLoginSession> {
    counter += 1;
    const code = hash(`code-${counter}`);
    await emailLogin.begin(db.prisma, { email, codeHash: code, ipHash: hash(`ip-${counter}`) });
    return (await emailLogin.verify(db.prisma, { email, codeHash: code }))!;
  }

  const check = (session: EmailLoginSession, subject: string, organizationId = session.organizationId) =>
    authSessions.check(db.prisma, { sessionId: session.sessionId, subject, organizationId });
  const hoursFrom = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / HOUR);
  const shift = (sessionId: string, column: 'signed_in_at' | 'last_seen_at', hours: number) =>
    db.owner.query(`UPDATE auth_sessions SET ${column} = ${column} - make_interval(hours => $2) WHERE id = $1`, [sessionId, hours]);

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('extends a fresh sign-in to the trusted length, clamped to the organization cap, once', async () => {
    const weekOrg = await organization('Week');
    const person = await member([weekOrg]);
    const session = await signIn(person.email);
    expect(hoursFrom(new Date(), session.expiresAt)).toBe(8);
    const expires = await authSessions.trust(db.prisma, { sessionId: session.sessionId, hours: 720, deviceLabel: 'Chrome on macOS' });
    // 30 days asked, the organization allows a week.
    expect(hoursFrom(new Date(), expires!)).toBe(168);
    expect(await authSessions.trust(db.prisma, { sessionId: session.sessionId, hours: 24, deviceLabel: null })).toBeNull();
    expect((await check(session, person.subject))?.signedInAt).toBeInstanceOf(Date);
    const audit = await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND action = 'session.trusted'`, [person.userId]);
    expect((audit.rows[0] as { n: number }).n).toBe(1);
  });

  it('refuses to trust a sign-in older than 2 minutes, and an organization with trust off keeps 8 hours', async () => {
    const person = await member([await organization('Late')]);
    const late = await signIn(person.email);
    await shift(late.sessionId, 'signed_in_at', 1);
    expect(await authSessions.trust(db.prisma, { sessionId: late.sessionId, hours: 24, deviceLabel: null })).toBeNull();

    const offPerson = await member([await organization('Off', 0)]);
    const off = await signIn(offPerson.email);
    const expires = await authSessions.trust(db.prisma, { sessionId: off.sessionId, hours: 168, deviceLabel: null });
    expect(hoursFrom(new Date(), expires!)).toBe(8);
  });

  it('ends a trusted session after 24 idle hours, or when the cap is lowered past its age', async () => {
    const org = await organization('Idle', 720);
    const person = await member([org]);
    const idle = await signIn(person.email);
    await authSessions.trust(db.prisma, { sessionId: idle.sessionId, hours: 720, deviceLabel: null });
    await shift(idle.sessionId, 'last_seen_at', 23);
    expect(await check(idle, person.subject)).not.toBeNull();
    // That check counted as use; 25 hours with none ends it.
    await shift(idle.sessionId, 'last_seen_at', 25);
    expect(await check(idle, person.subject)).toBeNull();

    const aged = await signIn(person.email);
    await authSessions.trust(db.prisma, { sessionId: aged.sessionId, hours: 720, deviceLabel: null });
    await shift(aged.sessionId, 'signed_in_at', 30);
    expect(await check(aged, person.subject)).not.toBeNull();
    await db.owner.query(`UPDATE organizations SET trusted_session_max_hours = 24 WHERE id = $1`, [org]);
    expect(await check(aged, person.subject)).toBeNull();
  });

  it('keeps the sign-in time and trust when moving into an organization, clamped to its cap', async () => {
    const roomy = await organization('Roomy', 720);
    const strict = await organization('Strict', 24);
    const person = await member([roomy, strict]);
    const session = await signIn(person.email);
    expect(session.organizationId).toBeNull();
    const expires = await authSessions.trust(db.prisma, { sessionId: session.sessionId, hours: 720, deviceLabel: 'Safari on iOS' });
    expect(hoursFrom(new Date(), expires!)).toBe(720);
    const moved = await authSessions.rescope(db.prisma, session.sessionId, strict);
    expect(hoursFrom(new Date(), moved!.expiresAt)).toBe(24);
    const devices = await authSessions.list(db.prisma, moved!.sessionId);
    expect(devices).toEqual([expect.objectContaining({ id: moved!.sessionId, trusted: true, deviceLabel: 'Safari on iOS', current: true })]);
  });

  it('lists and signs out only the person’s own sessions', async () => {
    const org = await organization('Devices');
    const person = await member([org]);
    const other = await member([org]);
    const laptop = await signIn(person.email);
    const phone = await signIn(person.email);
    const tablet = await signIn(person.email);
    const stranger = await signIn(other.email);
    expect((await authSessions.list(db.prisma, laptop.sessionId)).map((device) => device.id).sort()).toEqual([laptop, phone, tablet].map((s) => s.sessionId).sort());
    expect(await authSessions.revokeOwn(db.prisma, { sessionId: laptop.sessionId, targetId: stranger.sessionId })).toBe(false);
    expect(await check(stranger, other.subject)).not.toBeNull();
    expect(await authSessions.revokeOwn(db.prisma, { sessionId: laptop.sessionId, targetId: phone.sessionId })).toBe(true);
    expect(await check(phone, person.subject)).toBeNull();
    expect(await authSessions.revokeOthers(db.prisma, laptop.sessionId)).toBe(1);
    expect(await check(tablet, person.subject)).toBeNull();
    expect(await check(laptop, person.subject)).not.toBeNull();
    expect(await check(stranger, other.subject)).not.toBeNull();
  });
});
