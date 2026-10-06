import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { authSessions, emailLogin } from './login';
import { resolvePrincipal, withTenant } from './tenant';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const IP = hash('203.0.113.7');

interface EmailCodeMember {
  organizationId: string;
  userId: string;
  subject: string;
  email: string;
  dealId: string;
}

describe('email-code sign-in', () => {
  let db: TestDatabase;
  let auth0Tenant: SyntheticTenant;
  let solo: EmailCodeMember;

  async function emailCodeOrganization(label: string): Promise<string> {
    const id = newId();
    await db.owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`,
      [id, `${label} (synthetic)`, `${label.toLowerCase()}-${id.slice(-8)}`],
    );
    return id;
  }

  async function emailCodeMember(label: string, organizationIds: string[]): Promise<EmailCodeMember> {
    const userId = newId();
    const subject = `pactlab|${userId}`;
    const email = `${label.toLowerCase()}-${userId.slice(-8)}@example.test`;
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [
      userId,
      subject,
      `${label} (synthetic)`,
      email,
    ]);
    const dealId = newId();
    for (const [index, organizationId] of organizationIds.entries()) {
      await db.owner.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`,
        [newId(), organizationId, userId],
      );
      if (index === 0) {
        await db.owner.query(
          `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
           VALUES ($1, $2, 'Project Code', 'Code Target (synthetic)', 'PRIVATE_ACQUIRER', $3, now())`,
          [dealId, organizationId, userId],
        );
        await db.owner.query(
          `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')`,
          [newId(), organizationId, dealId, userId],
        );
      }
    }
    return { organizationId: organizationIds[0]!, userId, subject, email, dealId };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    auth0Tenant = await createSyntheticTenant(db.owner, 'Alpha');
    solo = await emailCodeMember('Solo', [await emailCodeOrganization('Charlie')]);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('signs a single-organization member in and resolves an org-scoped principal', async () => {
    expect(await emailLogin.begin(db.prisma, { email: `  ${solo.email.toUpperCase()} `, codeHash: hash('111111'), ipHash: IP })).toBeTruthy();
    const session = await emailLogin.verify(db.prisma, { email: solo.email, codeHash: hash('111111') });
    expect(session).toMatchObject({ userId: solo.userId, subject: solo.subject, organizationId: solo.organizationId });
    expect(await authSessions.isActive(db.prisma, { sessionId: session!.sessionId, subject: solo.subject, organizationId: solo.organizationId })).toBe(true);

    const tenant = await resolvePrincipal(db.prisma, {
      subject: solo.subject,
      externalOrganizationId: solo.organizationId,
      issuer: 'PACTLAB',
    });
    expect(tenant).toMatchObject({ organizationId: solo.organizationId, userId: solo.userId, dealIds: [solo.dealId] });
    // A used code never works twice.
    expect(await emailLogin.verify(db.prisma, { email: solo.email, codeHash: hash('111111') })).toBeNull();
  });

  it('never crosses sign-in methods', async () => {
    // An email-code token cannot enter an Auth0 organization, nor an Auth0 token an email-code one.
    expect(
      await resolvePrincipal(db.prisma, { subject: solo.subject, externalOrganizationId: auth0Tenant.organizationId, issuer: 'PACTLAB' }),
    ).toBeNull();
    expect(
      await resolvePrincipal(db.prisma, { subject: solo.subject, externalOrganizationId: solo.organizationId, issuer: 'AUTH0' }),
    ).toBeNull();
    // Auth0-organization members get no code, even with an email on file.
    await db.owner.query(`UPDATE users SET email = 'alpha-lead@example.test' WHERE id = $1`, [auth0Tenant.userId]);
    expect(await emailLogin.begin(db.prisma, { email: 'alpha-lead@example.test', codeHash: hash('1'), ipHash: IP })).toBeNull();
    expect(await emailLogin.begin(db.prisma, { email: 'nobody@example.test', codeHash: hash('1'), ipHash: IP })).toBeNull();
  });

  it('locks a code after five wrong attempts and only honours the newest code', async () => {
    const member = await emailCodeMember('Locked', [await emailCodeOrganization('Delta')]);
    await emailLogin.begin(db.prisma, { email: member.email, codeHash: hash('222222'), ipHash: IP });
    await emailLogin.begin(db.prisma, { email: member.email, codeHash: hash('333333'), ipHash: IP });
    expect(await emailLogin.verify(db.prisma, { email: member.email, codeHash: hash('222222') })).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      expect(await emailLogin.verify(db.prisma, { email: member.email, codeHash: hash(`wrong-${i}`) })).toBeNull();
    }
    // Five failures (including the superseded code) lock the newest code too.
    expect(await emailLogin.verify(db.prisma, { email: member.email, codeHash: hash('333333') })).toBeNull();
    const failed = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND action = 'login.failed'`,
      [member.userId],
    )) as { rows: { n: number }[] };
    expect(failed.rows[0]?.n).toBe(6);
  });

  it('rejects expired codes and rate-limits requests per address', async () => {
    const member = await emailCodeMember('Expired', [await emailCodeOrganization('Echo')]);
    await emailLogin.begin(db.prisma, { email: member.email, codeHash: hash('444444'), ipHash: hash('198.51.100.1') });
    await db.owner.query(`UPDATE login_challenges SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [member.userId]);
    expect(await emailLogin.verify(db.prisma, { email: member.email, codeHash: hash('444444') })).toBeNull();
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await emailLogin.begin(db.prisma, { email: member.email, codeHash: hash(`c${i}`), ipHash: hash('198.51.100.1') }));
    }
    // Five codes per 15 minutes per address, including the expired one above.
    expect(ids.filter(Boolean)).toHaveLength(4);
  });

  it('opens an unscoped session for multi-organization members and rescopes it', async () => {
    const first = await emailCodeOrganization('Foxtrot');
    const second = await emailCodeOrganization('Golf');
    const member = await emailCodeMember('Multi', [first, second]);
    await emailLogin.begin(db.prisma, { email: member.email, codeHash: hash('555555'), ipHash: IP });
    const session = await emailLogin.verify(db.prisma, { email: member.email, codeHash: hash('555555') });
    expect(session?.organizationId).toBeNull();
    // Not into an organization the user is not an email-code member of.
    expect(await authSessions.rescope(db.prisma, session!.sessionId, auth0Tenant.organizationId)).toBeNull();
    const scoped = await authSessions.rescope(db.prisma, session!.sessionId, second);
    expect(scoped).toBeTruthy();
    expect(await authSessions.isActive(db.prisma, { sessionId: session!.sessionId, subject: member.subject, organizationId: null })).toBe(false);
    expect(await authSessions.isActive(db.prisma, { sessionId: scoped!.sessionId, subject: member.subject, organizationId: second })).toBe(true);
    // The claims must match the session exactly.
    expect(await authSessions.isActive(db.prisma, { sessionId: scoped!.sessionId, subject: member.subject, organizationId: first })).toBe(false);

    await authSessions.revoke(db.prisma, scoped!.sessionId);
    expect(await authSessions.isActive(db.prisma, { sessionId: scoped!.sessionId, subject: member.subject, organizationId: second })).toBe(false);
  });

  it('gives the runtime role no direct access to login state', async () => {
    for (const sql of [
      `SELECT count(*) FROM login_challenges`,
      `SELECT count(*) FROM auth_sessions`,
      `UPDATE auth_sessions SET revoked_at = NULL`,
      `SELECT app_auth_audit(gen_random_uuid(), 'login.succeeded', 'SUCCEEDED')`,
    ]) {
      await expect(
        withTenant(db.prisma, auth0Tenant.context, (tx) => tx.$executeRawUnsafe(sql)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('stores only code hashes', async () => {
    const rows = (await db.owner.query(`SELECT code_hash FROM login_challenges`)) as { rows: { code_hash: string }[] };
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((row) => /^[0-9a-f]{64}$/.test(row.code_hash))).toBe(true);
  });
});
