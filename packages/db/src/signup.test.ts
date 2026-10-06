import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authSessions, emailLogin } from './login';
import { signup } from './signup';
import { resolvePrincipal, withTenant } from './tenant';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let ipCounter = 0;
const freshIp = () => hash(`ip-${ipCounter++}`);

describe('self-serve sign-up', () => {
  let db: TestDatabase;
  let existing: SyntheticTenant;

  const start = (email: string, code: string, overrides: Partial<Parameters<typeof signup.begin>[1]> = {}) =>
    signup.begin(db.prisma, {
      email,
      displayName: 'Dana Buyer',
      organizationName: 'Northwind Capital',
      ssoRequested: false,
      codeHash: hash(code),
      ipHash: freshIp(),
      ...overrides,
    });

  beforeAll(async () => {
    db = await startTestDatabase();
    existing = await createSyntheticTenant(db.owner, 'Alpha');
    await db.owner.query(`UPDATE users SET email = 'taken@alpha.example' WHERE id = $1`, [existing.userId]);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('creates a pending email-code organization with its owner only when the code verifies', async () => {
    expect(await start('  Dana@Northwind.example ', '111111', { ssoRequested: true })).toMatchObject({ kind: 'code' });
    const before = (await db.owner.query(`SELECT count(*)::int AS n FROM organizations`)) as { rows: { n: number }[] };
    expect(await signup.verify(db.prisma, { email: 'dana@northwind.example', codeHash: hash('999999'), requiresApproval: true })).toBeNull();
    const created = await signup.verify(db.prisma, { email: 'dana@northwind.example', codeHash: hash('111111'), requiresApproval: true });
    expect(created).toMatchObject({ status: 'PENDING_APPROVAL', organizationName: 'Northwind Capital', ownerName: 'Dana Buyer', ssoRequested: true });
    expect(created?.slug).toMatch(/^northwind-capital-[0-9a-f]{6}$/);

    const org = (await db.owner.query(
      `SELECT o.auth_method, o.status, o.created_via, o.sso_requested, m.role, u.auth0_subject, u.email
         FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id JOIN users u ON u.id = m.user_id
        WHERE o.id = $1`,
      [created!.organizationId],
    )) as { rows: Record<string, unknown>[] };
    expect(org.rows).toEqual([
      {
        auth_method: 'EMAIL_CODE',
        status: 'PENDING_APPROVAL',
        created_via: 'SIGNUP',
        sso_requested: true,
        role: 'ORG_OWNER',
        auth0_subject: `pactlab|${created!.ownerUserId}`,
        email: 'dana@northwind.example',
      },
    ]);
    const after = (await db.owner.query(`SELECT count(*)::int AS n FROM organizations`)) as { rows: { n: number }[] };
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
    // A used code never creates a second organization.
    expect(await signup.verify(db.prisma, { email: 'dana@northwind.example', codeHash: hash('111111'), requiresApproval: true })).toBeNull();
  });

  it('keeps a pending organization closed until an operator approves it', async () => {
    await start('lee@pending.example', '222222', { organizationName: 'Pending Partners' });
    const created = await signup.verify(db.prisma, { email: 'lee@pending.example', codeHash: hash('222222'), requiresApproval: true });
    const claims = { subject: `pactlab|${created!.ownerUserId}`, externalOrganizationId: created!.organizationId, issuer: 'PACTLAB' as const };
    // No login code and no principal while pending.
    expect(await emailLogin.begin(db.prisma, { email: 'lee@pending.example', codeHash: hash('1'), ipHash: freshIp() })).toBeNull();
    expect(await resolvePrincipal(db.prisma, claims)).toBeNull();

    await db.owner.query(`UPDATE organizations SET status = 'ACTIVE' WHERE id = $1`, [created!.organizationId]);
    expect(await emailLogin.begin(db.prisma, { email: 'lee@pending.example', codeHash: hash('333333'), ipHash: freshIp() })).toBeTruthy();
    const session = await emailLogin.verify(db.prisma, { email: 'lee@pending.example', codeHash: hash('333333') });
    expect(session?.organizationId).toBe(created!.organizationId);
    expect(await resolvePrincipal(db.prisma, claims)).toMatchObject({ organizationId: created!.organizationId, organizationRole: 'ORG_OWNER' });

    // Suspension closes it again, even for a session already open.
    await db.owner.query(`UPDATE organizations SET status = 'SUSPENDED' WHERE id = $1`, [created!.organizationId]);
    expect(await resolvePrincipal(db.prisma, claims)).toBeNull();
    expect(await authSessions.isActive(db.prisma, { sessionId: session!.sessionId, subject: claims.subject, organizationId: created!.organizationId })).toBe(true);
  });

  it('can create an organization that is active immediately when approval is off', async () => {
    await start('kim@instant.example', '444444', { organizationName: 'Instant & Co.' });
    const created = await signup.verify(db.prisma, { email: 'kim@instant.example', codeHash: hash('444444'), requiresApproval: false });
    expect(created).toMatchObject({ status: 'ACTIVE' });
    expect(created?.slug).toMatch(/^instant-co-[0-9a-f]{6}$/);
  });

  it('never sends a code to an address that already has an account', async () => {
    expect(await start('taken@alpha.example', '555555')).toEqual({ kind: 'existing-user' });
    expect(await signup.verify(db.prisma, { email: 'taken@alpha.example', codeHash: hash('555555'), requiresApproval: true })).toBeNull();
  });

  it('rate-limits per address and per client, and locks a code after five misses', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push((await start('busy@limit.example', `c${i}`)).kind);
    expect(results).toEqual(['code', 'code', 'code', 'throttled']);

    const ip = hash('one-client');
    const perClient = [];
    for (let i = 0; i < 11; i += 1) perClient.push((await start(`p${i}@client.example`, 'x', { ipHash: ip })).kind);
    expect(perClient.filter((kind) => kind === 'throttled')).toHaveLength(1);

    await start('lock@limit.example', '666666');
    for (let i = 0; i < 5; i += 1) {
      expect(await signup.verify(db.prisma, { email: 'lock@limit.example', codeHash: hash(`no-${i}`), requiresApproval: true })).toBeNull();
    }
    expect(await signup.verify(db.prisma, { email: 'lock@limit.example', codeHash: hash('666666'), requiresApproval: true })).toBeNull();
  });

  it('expires codes after ten minutes', async () => {
    await start('late@expire.example', '777777');
    await db.owner.query(`UPDATE signup_challenges SET expires_at = now() - interval '1 second' WHERE email = 'late@expire.example'`);
    expect(await signup.verify(db.prisma, { email: 'late@expire.example', codeHash: hash('777777'), requiresApproval: true })).toBeNull();
  });

  it('gives the runtime role no direct access to sign-up state', async () => {
    for (const sql of [
      `SELECT count(*) FROM signup_challenges`,
      `INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES (gen_random_uuid(), 'x', 'x', 'EMAIL_CODE', now())`,
    ]) {
      await expect(withTenant(db.prisma, existing.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied|row-level security/);
    }
  });
});
