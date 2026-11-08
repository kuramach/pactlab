import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { emailLogin, passkeys } from './login';
import { startTestDatabase, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const IP = hash('198.51.100.9');
const KEY = new Uint8Array([1, 2, 3, 4, 5]);
const credential = () => `cred_${newId().replace(/-/g, '')}`;

/**
 * T-108 passkey state at the database: functions act only for the session's user,
 * challenges are single-use, a backwards counter is refused, and the runtime role
 * cannot read the table.
 */
describe('passkeys (database)', () => {
  let db: TestDatabase;
  const code = hash('code');

  async function member(label: string, method: 'EMAIL_CODE' | 'AUTH0' = 'EMAIL_CODE') {
    const organizationId = newId();
    await db.owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, auth0_organization_id, updated_at) VALUES ($1, $2, $3, $4, $5, now())`,
      [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`, method, method === 'AUTH0' ? `org_${organizationId.slice(-12)}` : null],
    );
    const userId = newId();
    const email = `${label.toLowerCase()}-${userId.slice(-8)}@example.test`;
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, email]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), organizationId, userId]);
    return { organizationId, userId, email };
  }

  /** An email-code session, as `/v1/auth/email/verify` opens one. */
  async function signIn(email: string): Promise<string> {
    await emailLogin.begin(db.prisma, { email, codeHash: code, ipHash: IP });
    const session = await emailLogin.verify(db.prisma, { email, codeHash: code });
    if (!session) throw new Error('no session');
    return session.sessionId;
  }

  async function add(sessionId: string, credentialId = credential()) {
    return passkeys.register(db.prisma, { sessionId, credentialId, publicKey: KEY, counter: 0, transports: ['internal'], name: 'Synthetic laptop' });
  }

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 60_000);
  afterAll(async () => db?.stop());

  it('a recent session adds a passkey; it is listed without the key, and audited', async () => {
    const ana = await member('Ana');
    const session = await signIn(ana.email);
    const account = await passkeys.account(db.prisma, session);
    expect(account).toMatchObject({ userId: ana.userId, email: ana.email, offerDismissed: false });
    const challenge = await passkeys.beginChallenge(db.prisma, { purpose: 'REGISTER', sessionId: session, challenge: 'register-challenge', ipHash: IP });
    expect(challenge).not.toBeNull();
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: challenge!, purpose: 'REGISTER', sessionId: session })).toBe('register-challenge');
    const id = await add(session);
    expect(id).not.toBeNull();
    const list = await passkeys.list(db.prisma, session);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!)).not.toContain('publicKey');
    const audit = await db.owner.query(`SELECT outcome FROM audit_events WHERE actor_user_id = $1 AND action = 'login.passkey_added'`, [ana.userId]);
    expect(audit.rows).toEqual([{ outcome: 'SUCCEEDED' }]);
  });

  it('challenges are single-use, purpose-bound, and a REGISTER challenge belongs to its user', async () => {
    const ben = await member('Ben');
    const cara = await member('Cara');
    const benSession = await signIn(ben.email);
    const caraSession = await signIn(cara.email);
    const signInChallenge = await passkeys.beginChallenge(db.prisma, { purpose: 'SIGN_IN', sessionId: null, challenge: 'sign-in-challenge', ipHash: IP });
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: signInChallenge!, purpose: 'REGISTER', sessionId: benSession })).toBeNull();
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: signInChallenge!, purpose: 'SIGN_IN', sessionId: null })).toBe('sign-in-challenge');
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: signInChallenge!, purpose: 'SIGN_IN', sessionId: null })).toBeNull();
    const benChallenge = await passkeys.beginChallenge(db.prisma, { purpose: 'REGISTER', sessionId: benSession, challenge: 'ben-only', ipHash: IP });
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: benChallenge!, purpose: 'REGISTER', sessionId: caraSession })).toBeNull();
    const expired = await passkeys.beginChallenge(db.prisma, { purpose: 'SIGN_IN', sessionId: null, challenge: 'old', ipHash: IP });
    await db.owner.query(`UPDATE passkey_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [expired]);
    expect(await passkeys.takeChallenge(db.prisma, { challengeId: expired!, purpose: 'SIGN_IN', sessionId: null })).toBeNull();
  });

  it('adding needs a sign-in within 15 minutes, even after the session changed organization', async () => {
    const dan = await member('Dan');
    const session = await signIn(dan.email);
    // As if signed in 20 minutes ago: rescope keeps the expiry, so the expiry is the clock.
    await db.owner.query(`UPDATE auth_sessions SET expires_at = now() + interval '7 hours 40 minutes', created_at = now() WHERE id = $1`, [session]);
    expect(await passkeys.beginChallenge(db.prisma, { purpose: 'REGISTER', sessionId: session, challenge: 'late', ipHash: IP })).toBeNull();
    expect(await add(session)).toBeNull();
  });

  it('signs in with a known passkey, opens the email-code session shape, and refuses a counter going backwards', async () => {
    const eve = await member('Eve');
    const session = await signIn(eve.email);
    const credentialId = credential();
    await passkeys.register(db.prisma, { sessionId: session, credentialId, publicKey: KEY, counter: 5, transports: [], name: 'Synthetic phone' });
    expect(await passkeys.lookup(db.prisma, credentialId)).toMatchObject({ counter: 5 });
    const opened = await passkeys.login(db.prisma, { credentialId, newCounter: 6 });
    expect(opened).toMatchObject({ userId: eve.userId, organizationId: eve.organizationId, subject: `pactlab|${eve.userId}` });
    expect(opened!.expiresAt.getTime() - Date.now()).toBeGreaterThan(7.9 * 3_600_000);
    expect(await passkeys.login(db.prisma, { credentialId, newCounter: 6 })).toBeNull();
    const denied = await db.owner.query(`SELECT 1 FROM audit_events WHERE actor_user_id = $1 AND action = 'login.passkey_failed'`, [eve.userId]);
    expect(denied.rows).toHaveLength(1);
    // Authenticators that never count stay at 0 and keep working.
    const zero = credential();
    await passkeys.register(db.prisma, { sessionId: session, credentialId: zero, publicKey: KEY, counter: 0, transports: [], name: 'Synced passkey' });
    expect(await passkeys.login(db.prisma, { credentialId: zero, newCounter: 0 })).not.toBeNull();
    expect(await passkeys.login(db.prisma, { credentialId: zero, newCounter: 0 })).not.toBeNull();
    expect(await passkeys.login(db.prisma, { credentialId: credential(), newCounter: 1 })).toBeNull();
  });

  it('a user with no email-code organization cannot sign in with a passkey', async () => {
    const fay = await member('Fay');
    const session = await signIn(fay.email);
    const credentialId = credential();
    await add(session, credentialId);
    await db.owner.query(`UPDATE organization_memberships SET status = 'SUSPENDED' WHERE user_id = $1`, [fay.userId]).catch(async () => {
      await db.owner.query(`DELETE FROM organization_memberships WHERE user_id = $1`, [fay.userId]);
    });
    expect(await passkeys.lookup(db.prisma, credentialId)).toBeNull();
    expect(await passkeys.login(db.prisma, { credentialId, newCounter: 0 })).toBeNull();
  });

  it('at most 10 passkeys, each credential once; only the owner can remove one, and removed ones stop working', async () => {
    const gus = await member('Gus');
    const hal = await member('Hal');
    const gusSession = await signIn(gus.email);
    const halSession = await signIn(hal.email);
    const shared = credential();
    expect(await add(gusSession, shared)).not.toBeNull();
    expect(await add(halSession, shared)).toBeNull();
    for (let i = 1; i < 10; i += 1) expect(await add(gusSession)).not.toBeNull();
    expect(await add(gusSession)).toBeNull();
    const [first] = await passkeys.list(db.prisma, gusSession);
    expect(await passkeys.revoke(db.prisma, { sessionId: halSession, passkeyId: first!.id })).toBeNull();
    expect(await passkeys.list(db.prisma, halSession)).toEqual([]);
    expect(await passkeys.revoke(db.prisma, { sessionId: gusSession, passkeyId: first!.id })).toBe('Synthetic laptop');
    expect(await passkeys.login(db.prisma, { credentialId: first!.credentialId, newCounter: 0 })).toBeNull();
    expect(await passkeys.list(db.prisma, gusSession)).toHaveLength(9);
  });

  it('remembers "not now" on the offer', async () => {
    const ivy = await member('Ivy');
    const session = await signIn(ivy.email);
    await passkeys.dismissOffer(db.prisma, session);
    expect(await passkeys.account(db.prisma, session)).toMatchObject({ offerDismissed: true });
  });

  it('the runtime role cannot touch passkey tables directly', async () => {
    for (const table of ['user_passkeys', 'passkey_challenges']) {
      await expect(
        db.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
          await tx.$queryRawUnsafe(`SELECT * FROM ${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
