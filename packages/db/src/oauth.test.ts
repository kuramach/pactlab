import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { emailLogin } from './login';
import { oauth } from './oauth';
import { startTestDatabase, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const IP = hash('198.51.100.20');
const RESOURCE = 'https://app.pactlab.test/v1/mcp';

/** T-084: OAuth state at the database — single-use codes, rotating refresh tokens, revocation, the MCP switch. */
describe('oauth (database)', () => {
  let db: TestDatabase;
  const code = hash('code');

  async function member(label: string, mcp = true) {
    const organizationId = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`]);
    if (mcp) await db.owner.query(`INSERT INTO organization_flags (organization_id, mcp_enabled) VALUES ($1, true)`, [organizationId]);
    const userId = newId();
    const email = `${label.toLowerCase()}-${userId.slice(-8)}@example.test`;
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, email]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), organizationId, userId]);
    await emailLogin.begin(db.prisma, { email, codeHash: code, ipHash: IP });
    const session = await emailLogin.verify(db.prisma, { email, codeHash: code });
    return { organizationId, userId, subject: `pactlab|${userId}`, sessionId: session!.sessionId };
  }

  const authorize = (sessionId: string, codeHash = hash(newId()), clientId = 'https://client.example/meta.json') =>
    oauth.authorize(db.prisma, { sessionId, clientId, clientName: 'Synthetic client', scopes: ['mcp:read'], codeHash, codeChallenge: 'challenge', redirectUri: 'http://127.0.0.1:7777/cb', resource: RESOURCE });

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 60_000);
  afterAll(async () => db?.stop());

  it('authorizes, then a code works exactly once and carries what the token endpoint checks', async () => {
    const ana = await member('Ana');
    const codeHash = hash('ana-code');
    const grantId = await authorize(ana.sessionId, codeHash);
    expect(grantId).not.toBeNull();
    const taken = await oauth.takeCode(db.prisma, codeHash);
    expect(taken).toMatchObject({ grantId, userId: ana.userId, subject: ana.subject, organizationId: ana.organizationId, codeChallenge: 'challenge', redirectUri: 'http://127.0.0.1:7777/cb', resource: RESOURCE, scopes: ['mcp:read'] });
    expect(await oauth.takeCode(db.prisma, codeHash)).toBeNull();
    const audit = await db.owner.query(`SELECT action FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'oauth.%'`, [ana.userId]);
    expect(audit.rows).toEqual([{ action: 'oauth.grant_created' }]);
  });

  it('an expired code is refused; a second approval reuses the grant', async () => {
    const ben = await member('Ben');
    const first = await authorize(ben.sessionId, hash('ben-1'));
    const second = await authorize(ben.sessionId, hash('ben-2'));
    expect(second).toBe(first);
    await db.owner.query(`UPDATE oauth_codes SET expires_at = now() - interval '1 second' WHERE code_hash = $1`, [hash('ben-2')]);
    expect(await oauth.takeCode(db.prisma, hash('ben-2'))).toBeNull();
  });

  it('refuses while MCP is off for the organization', async () => {
    const cy = await member('Cy', false);
    expect(await authorize(cy.sessionId)).toBeNull();
    expect(await oauth.mcpEnabled(db.prisma, cy.organizationId)).toBe(false);
  });

  it('refresh tokens rotate; presenting a used one revokes the grant', async () => {
    const dee = await member('Dee');
    const grantId = (await authorize(dee.sessionId))!;
    await oauth.issueRefresh(db.prisma, { grantId, tokenHash: hash('r1'), scopes: ['mcp:read'], resource: RESOURCE });
    const used = await oauth.useRefresh(db.prisma, hash('r1'));
    expect(used).toMatchObject({ grantId, organizationId: dee.organizationId, resource: RESOURCE });
    await oauth.issueRefresh(db.prisma, { grantId, tokenHash: hash('r2'), scopes: ['mcp:read'], resource: RESOURCE });
    // r1 again: a stolen-token signal. The grant ends, so r2 dies with it.
    expect(await oauth.useRefresh(db.prisma, hash('r1'))).toBeNull();
    expect(await oauth.useRefresh(db.prisma, hash('r2'))).toBeNull();
    expect(await oauth.grantState(db.prisma, grantId, dee.subject)).toEqual({ active: false, mcpEnabled: false });
    const denied = await db.owner.query(`SELECT outcome FROM audit_events WHERE actor_user_id = $1 AND action = 'oauth.refresh_reused'`, [dee.userId]);
    expect(denied.rows).toEqual([{ outcome: 'DENIED' }]);
  });

  it('grant state: active with MCP on; 403-state when switched off; inactive for another subject', async () => {
    const eve = await member('Eve');
    const grantId = (await authorize(eve.sessionId))!;
    expect(await oauth.grantState(db.prisma, grantId, eve.subject)).toEqual({ active: true, mcpEnabled: true });
    expect(await oauth.grantState(db.prisma, grantId, 'pactlab|someone-else')).toEqual({ active: false, mcpEnabled: false });
    await db.owner.query(`UPDATE organization_flags SET mcp_enabled = false WHERE organization_id = $1`, [eve.organizationId]);
    expect(await oauth.grantState(db.prisma, grantId, eve.subject)).toEqual({ active: true, mcpEnabled: false });
  });

  it('connected apps: only your own; only you can disconnect them', async () => {
    const fay = await member('Fay');
    const gus = await member('Gus');
    const grantId = (await authorize(fay.sessionId))!;
    expect((await oauth.connectedApps(db.prisma, fay.sessionId)).map((app) => app.id)).toEqual([grantId]);
    expect(await oauth.connectedApps(db.prisma, gus.sessionId)).toEqual([]);
    expect(await oauth.revokeGrant(db.prisma, gus.sessionId, grantId)).toBe(false);
    expect(await oauth.revokeGrant(db.prisma, fay.sessionId, grantId)).toBe(true);
    expect(await oauth.connectedApps(db.prisma, fay.sessionId)).toEqual([]);
    expect((await oauth.grantState(db.prisma, grantId, fay.subject)).active).toBe(false);
  });

  it('RFC 7009 revocation of a refresh token ends the grant', async () => {
    const hal = await member('Hal');
    const grantId = (await authorize(hal.sessionId))!;
    await oauth.issueRefresh(db.prisma, { grantId, tokenHash: hash('hal-r'), scopes: ['mcp:read'], resource: RESOURCE });
    await oauth.revokeRefresh(db.prisma, hash('hal-r'));
    expect((await oauth.grantState(db.prisma, grantId, hal.subject)).active).toBe(false);
  });

  it('client registration is rate-limited per address', async () => {
    const ip = hash('203.0.113.99');
    for (let i = 0; i < 20; i += 1) expect(await oauth.registerClient(db.prisma, { clientId: `pl_${newId()}`, clientName: 'Synthetic', redirectUris: ['http://127.0.0.1/cb'], ipHash: ip })).toBe(true);
    expect(await oauth.registerClient(db.prisma, { clientId: `pl_${newId()}`, clientName: 'Synthetic', redirectUris: ['http://127.0.0.1/cb'], ipHash: ip })).toBe(false);
  });

  it('the runtime role cannot touch OAuth tables directly', async () => {
    for (const table of ['oauth_clients', 'oauth_grants', 'oauth_codes', 'oauth_refresh_tokens']) {
      await expect(
        db.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
          await tx.$queryRawUnsafe(`SELECT * FROM ${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
