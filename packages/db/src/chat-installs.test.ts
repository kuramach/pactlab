import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatInstalls, teamsRefs } from './chat-installs';
import { contacts } from './contacts';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const TENANT = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5';
const AAD = 'f0f0f0f0-e1e1-4d2d-8c3c-b4b4b4b4b4b4';

/**
 * T-181: a workspace or tenant belongs to one organization; only its owners and admins install or see who
 * is linked; a person links only to their own organization's install and only by the confirmation sent to
 * that member; ending the install ends every link; the runtime role reads none of it directly.
 */
describe('Slack and Teams installs and links', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'chata');
    b = await createSyntheticTenant(db.owner, 'chatb');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
  }, 60_000);
  afterAll(async () => db?.stop());

  it('the runtime role reads neither table directly', async () => {
    for (const table of ['chat_installs', 'teams_conversation_refs']) {
      await expect(withTenant(db.prisma, a.context, (tx) => tx.$queryRawUnsafe(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it('only an owner or admin installs; another organization cannot take the same workspace', async () => {
    expect(await chatInstalls.save(db.prisma, member.context, { provider: 'SLACK', externalTenant: 'TCHATA1', credentialRef: 'secretref:a/chat/slack/1' })).toBeNull();
    expect(await chatInstalls.save(db.prisma, a.context, { provider: 'SLACK', externalTenant: 'TCHATA1', credentialRef: 'secretref:a/chat/slack/1' })).toMatchObject({ replacedRef: null });
    expect(await chatInstalls.save(db.prisma, b.context, { provider: 'SLACK', externalTenant: 'TCHATA1', credentialRef: 'secretref:b/chat/slack/1' })).toBeNull();
    expect(await chatInstalls.status(db.prisma, member.context)).toEqual([expect.objectContaining({ provider: 'SLACK', linkedCount: null })]);
    expect(await chatInstalls.status(db.prisma, b.context)).toEqual([]);
    expect(await chatInstalls.forCaller(db.prisma, b.context, 'SLACK')).toBeNull();
  });

  it('a link begins only for a member of the caller’s own install, and confirms only for that member', async () => {
    // Another organization cannot start a link to this workspace's member.
    expect(await chatInstalls.beginLink(db.prisma, b.context, { provider: 'SLACK', handle: 'TCHATA1:U0MEMBER', secretHash: hash('b-token') })).toBeNull();
    expect(await chatInstalls.confirmLink(db.prisma, { provider: 'SLACK', handle: 'TCHATA1:U0MEMBER', secretHash: hash('b-token') })).toBeNull();
    expect(await chatInstalls.beginLink(db.prisma, member.context, { provider: 'SLACK', handle: 'TCHATA1:U0MEMBER', secretHash: hash('m-token') })).not.toBeNull();
    expect(await chatInstalls.confirmLink(db.prisma, { provider: 'SLACK', handle: 'TCHATA1:U0SOMEONE', secretHash: hash('m-token') })).toBeNull();
    expect(await chatInstalls.confirmLink(db.prisma, { provider: 'SLACK', handle: 'TCHATA1:U0MEMBER', secretHash: hash('m-token') })).not.toBeNull();
    expect((await contacts.channels(db.prisma, member.context)).map((row) => row.kind)).toEqual(['SLACK']);
    // A person reads only their own links.
    expect(await contacts.channels(db.prisma, a.context)).toEqual([]);
    expect((await chatInstalls.targets(db.prisma, [member.userId])).map((row) => row.kind)).toEqual(['SLACK']);
  });

  it('an admin sees who is linked by name; a member is refused and the attempt audited', async () => {
    const page = await chatInstalls.adminMembers(db.prisma, a.context, 'SLACK', { limit: 50 });
    expect(page.items.find((row) => row.userId === member.userId)?.linked).toBe(true);
    expect(JSON.stringify(page)).not.toContain('U0MEMBER');
    expect((await chatInstalls.adminMembers(db.prisma, member.context, 'SLACK', { limit: 50 })).items).toEqual([]);
    const denied = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.admin_viewed' AND outcome = 'DENIED' AND actor_user_id = $1`, [member.userId]);
    expect(denied.rows[0]?.n).toBe(1);
  });

  it('a provider uninstall ends the install and every link on it at once', async () => {
    expect(await chatInstalls.providerEvent(db.prisma, { provider: 'SLACK', externalTenant: 'TCHATA1', reason: 'UNINSTALLED' })).toBe('secretref:a/chat/slack/1');
    expect(await chatInstalls.targets(db.prisma, [member.userId])).toEqual([]);
    expect(await contacts.channels(db.prisma, member.context)).toEqual([]);
    expect(await chatInstalls.providerEvent(db.prisma, { provider: 'SLACK', externalTenant: 'TCHATA1', reason: 'UNINSTALLED' })).toBeNull();
  });

  it('Teams: a captured conversation is found only through the caller’s own organization’s tenant', async () => {
    await teamsRefs.capture(db.prisma, { tenantId: TENANT, aadObjectId: AAD, emailHash: hash('member-email'), serviceUrl: 'https://smba.trafficmanager.net/emea/', conversationId: 'a:1' });
    expect(await teamsRefs.forCaller(db.prisma, member.context, hash('member-email'))).toBeNull();
    await chatInstalls.save(db.prisma, a.context, { provider: 'TEAMS', externalTenant: TENANT, credentialRef: null });
    expect(await teamsRefs.forCaller(db.prisma, member.context, hash('member-email'))).toMatchObject({ aadObjectId: AAD });
    expect(await teamsRefs.forCaller(db.prisma, b.context, hash('member-email'))).toBeNull();
    await chatInstalls.beginLink(db.prisma, member.context, { provider: 'TEAMS', handle: `${TENANT}:${AAD}`, secretHash: hash('t-token') });
    expect(await chatInstalls.confirmLink(db.prisma, { provider: 'TEAMS', handle: `${TENANT}:${AAD}`, secretHash: hash('t-token') })).not.toBeNull();
    expect((await chatInstalls.targets(db.prisma, [member.userId]))[0]).toMatchObject({ kind: 'TEAMS', conversationId: 'a:1' });
    // Removing the app for the person ends their link.
    expect(await teamsRefs.remove(db.prisma, { tenantId: TENANT, aadObjectId: AAD })).toBe(1);
    expect(await chatInstalls.targets(db.prisma, [member.userId])).toEqual([]);
  });
});
