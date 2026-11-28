import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ClaudeGateway } from '@pactlab/ai';
import { FixtureSlackApp, FixtureTeamsBot, type FixtureChatMessage, type SecretStore } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { CHANNEL_PREFIX, CHANNEL_SENDER, newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';
import { FixtureIdentityEmails } from './auth0-userinfo';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'chat-test-secret-at-least-32-characters-long';
const SLACK_SIGNING = 'fixture-slack-signing-secret';
const TEAM = 'TAAA111';
const TENANT = '0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e';
const OTHER_TENANT = '9f9f9f9f-8e8e-4d7d-8c6c-5b5b5b5b5b5b';
const AAD_LEAD = '11111111-2222-4333-8444-000000000001';
const SLACK_LEAD = 'U0LEAD1';
const SERVICE = 'https://smba.trafficmanager.net/emea/';

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async put(ref: string, value: string) {
    this.values.set(ref, value);
  }
  async get(ref: string) {
    const value = this.values.get(ref);
    if (value === undefined) throw new Error('missing');
    return value;
  }
  async delete(ref: string) {
    this.values.delete(ref);
  }
}

class NoEmails implements EmailSender {
  readonly name = 'none';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** The AI gateway, recording every call: chat flows must never make one. */
class RecordingGateway implements ClaudeGateway {
  readonly calls: unknown[] = [];
  invoke(...args: unknown[]): never {
    this.calls.push(args);
    throw new Error('no model calls in chat flows');
  }
}

/**
 * T-181 acceptance, with the fixture adapters: an admin installs Slack, a member links by their verified
 * email and confirms in Slack, a test DM arrives, the member disconnects; the same for Teams. Uninstall
 * and token revocation stop sends at once. No pact content reaches a Slack or Teams payload. A member of
 * another organization cannot link to this organization's install, nor install the same workspace.
 */
describe('Slack and Microsoft Teams (T-181)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;
  const slack = new FixtureSlackApp(SLACK_SIGNING);
  const teams = new FixtureTeamsBot();
  const secrets = new MemorySecrets();
  const gateway = new RecordingGateway();
  const identities = new FixtureIdentityEmails();
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>, text: response.body };
  }
  const channels = async (who: string) => ((await call(who, 'GET', '/v1/me/contact')).body['channels'] as { id: string; kind: string; label: string }[]);

  async function actNowFor(userId: string) {
    const event = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
      [event, a.organizationId, a.dealId, `t181-${event}`, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`, [newId(), a.organizationId, a.dealId, event, userId]);
  }

  async function install(who: string, provider: 'slack' | 'teams', code: string) {
    const started = await call(who, 'POST', `/v1/organization/chat-apps/${provider}/install`);
    expect(started.status, started.text).toBe(200);
    const state = new URL(String(started.body['url'])).searchParams.get('state')!;
    return call(who, 'POST', `/v1/organization/chat-apps/${provider}/callback`, { code, state });
  }

  function slackPost(path: 'events' | 'interactions', body: string, secret = SLACK_SIGNING) {
    const at = Math.floor(Date.now() / 1000);
    const signature = `v0=${createHmac('sha256', secret).update(`v0:${at}:${body}`).digest('hex')}`;
    return app.inject({
      method: 'POST',
      url: `/v1/webhooks/slack/${path}`,
      headers: { 'content-type': path === 'events' ? 'application/json' : 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(at), 'x-slack-signature': signature },
      payload: body,
    });
  }
  const slackAction = (actionId: string, userId: string, value?: string) =>
    slackPost('interactions', `payload=${encodeURIComponent(JSON.stringify({ type: 'block_actions', team: { id: TEAM }, user: { id: userId }, actions: [{ action_id: actionId, value }] }))}`);
  const slackEvent = (event: Record<string, unknown>) => slackPost('events', JSON.stringify({ type: 'event_callback', team_id: TEAM, event }));

  function teamsActivity(activity: Record<string, unknown>, bearer = teams.inboundSecret) {
    const body = { channelId: 'msteams', serviceUrl: SERVICE, from: { id: '29:lead', aadObjectId: AAD_LEAD }, conversation: { id: 'a:lead-personal', conversationType: 'personal', tenantId: TENANT }, ...activity };
    return app.inject({ method: 'POST', url: '/v1/webhooks/teams/messages', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, payload: JSON.stringify(body) });
  }

  /** Nothing about the pact or the people: the words, the inbox link, the button. */
  function expectContentFree(messages: readonly FixtureChatMessage[]) {
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      const payload = JSON.stringify(message.payload);
      expect(message.sender).toBe(CHANNEL_SENDER);
      expect(message.message.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
      for (const secret of [a.dealName, a.dealId, a.organizationId, 'lead@contact.test']) expect(payload).not.toContain(secret);
      // No amount in any currency.
      expect(payload).not.toMatch(/[$€£¥₹]\s?\d|\b(USD|EUR|GBP|JPY|INR)\s?\d/);
    }
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Chat');
    b = await createSyntheticTenant(db.owner, 'Chat other org');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'debug', destination: new Writable({ write: (chunk: Buffer, _encoding, done) => { logLines.push(chunk.toString('utf8')); done(); } }) }),
      documents: { gateway },
      emailLogin: { tokenSecret: SECRET, emailSender: new NoEmails() },
      providers: { secrets },
    };
    app = await createApp({ ...deps, contacts: { identityEmails: identities, slack, teams } });
    await app.init();
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    identities.set(tokens['lead']!, { email: 'lead@contact.test', emailVerified: true });
    identities.set(tokens['other']!, { email: 'lead@contact.test', emailVerified: true });
    slack.addWorkspace('code-a', TEAM, 'Synthetic workspace');
    slack.addMember(TEAM, 'lead@contact.test', SLACK_LEAD);
    // Another organization trying to claim the same workspace.
    slack.addWorkspace('code-b', TEAM, 'Synthetic workspace');
    teams.signIns.set('tcode-a', TENANT);
    teams.signIns.set('tcode-b', TENANT);
    teams.signIns.set('tcode-b2', OTHER_TENANT);
    teams.addMember(TENANT, AAD_LEAD, 'lead@contact.test');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  it('Slack and Teams are off unless configured, and the profile says so', async () => {
    expect((await call('lead', 'GET', '/v1/organization/chat-apps', undefined, off)).body).toMatchObject({ slack: { available: false }, teams: { available: false } });
    expect((await call('lead', 'POST', '/v1/me/contact/chat/slack', undefined, off)).body).toMatchObject({ code: 'SLACK_OFF' });
    expect((await off.inject({ method: 'POST', url: '/v1/webhooks/slack/events', payload: '{}' })).statusCode).toBe(404);
    expect((await call('lead', 'GET', '/v1/me/contact')).body).toMatchObject({ available: { slack: true, teams: true }, chatInstalled: { slack: false, teams: false } });
  });

  it('with no install, a member is told to ask their admin, and only an admin can install', async () => {
    expect((await call('member', 'POST', '/v1/me/contact/chat/slack')).body).toMatchObject({ code: 'NOT_INSTALLED' });
    expect((await call('member', 'POST', '/v1/organization/chat-apps/slack/install')).status).toBe(403);
    // A forged or someone else's state is refused.
    expect((await call('lead', 'POST', '/v1/organization/chat-apps/slack/callback', { code: 'code-a', state: 'forged.state' })).body).toMatchObject({ code: 'INSTALL_STATE_INVALID' });
  });

  it('Slack: an admin installs; the bot token is kept only as a reference; another organization cannot take the workspace', async () => {
    expect((await install('lead', 'slack', 'code-a')).body).toEqual({ installed: true });
    const row = await db.owner.query<{ credential_ref: string; external_tenant: string }>(`SELECT credential_ref, external_tenant FROM chat_installs WHERE organization_id = $1 AND revoked_at IS NULL`, [a.organizationId]);
    expect(row.rows[0]?.credential_ref).toMatch(/^secretref:/);
    expect(JSON.stringify(row.rows)).not.toContain('xoxb-');
    expect([...secrets.values.values()]).toContain(`xoxb-fixture-${TEAM}`);
    const apps = await call('lead', 'GET', '/v1/organization/chat-apps');
    expect(apps.body).toMatchObject({ slack: { installed: true, linkedCount: 0 } });
    expect(apps.text).not.toContain(TEAM);

    expect((await install('other', 'slack', 'code-b')).body).toMatchObject({ code: 'INSTALL_TAKEN' });
    const denied = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.slack_installed' AND outcome = 'DENIED' AND organization_id = $1`, [b.organizationId]);
    expect(denied.rows[0]?.n).toBe(1);
    // A member of the other organization has no install to link to.
    await call('other', 'GET', '/v1/me/contact');
    expect((await call('other', 'POST', '/v1/me/contact/chat/slack')).body).toMatchObject({ code: 'NOT_INSTALLED' });
  });

  it('Slack: link by verified email, confirm in Slack, a test DM arrives, then act-now alerts; all content-free', async () => {
    // The member has no verified email yet: Connect needs one.
    expect((await call('member', 'POST', '/v1/me/contact/chat/slack')).body).toMatchObject({ code: 'EMAIL_REQUIRED' });
    const asked = await call('lead', 'POST', '/v1/me/contact/chat/slack');
    expect(asked.status, asked.text).toBe(202);
    const ask = slack.outbox.at(-1)!;
    expect(ask).toMatchObject({ channel: 'SLACK', to: SLACK_LEAD, message: { action: { kind: 'CONFIRM' } } });
    const value = ask.message.action?.kind === 'CONFIRM' ? ask.message.action.value : '';
    expect(await channels('lead')).toEqual([]);

    // A forged signature, or another member pressing it, does not link.
    expect((await slackPost('interactions', 'payload=%7B%7D', 'wrong')).statusCode).toBe(403);
    await slackAction('pactlab_confirm', 'U0OTHER1', value);
    expect(await channels('lead')).toEqual([]);
    expect((await slackAction('pactlab_confirm', SLACK_LEAD, value)).statusCode).toBe(200);
    expect(slack.outbox.at(-1)?.message.text).toMatch(/^Pactlab: You are connected\./);
    expect(slack.homes.at(-1)).toMatchObject({ userId: SLACK_LEAD, linked: true });
    const link = (await channels('lead')).find((row) => row.kind === 'SLACK')!;
    expect(link.label).toBe('Connected');
    // Single use.
    await slackAction('pactlab_confirm', SLACK_LEAD, value);
    expect(slack.outbox.at(-1)?.message.text).toMatch(/expired or was already used/);

    const before = slack.outbox.length;
    expect((await call('lead', 'POST', `/v1/me/contact/channels/${link.id}/test`)).status).toBe(200);
    await actNowFor(a.userId);
    await dispatcher.run();
    const sent = slack.outbox.slice(before);
    expect(sent.map((message) => message.message.text.split('.')[0])).toEqual(['Pactlab: This is a test message', 'Pactlab: A pact needs you']);
    expect(sent[1]?.message.action).toMatchObject({ kind: 'LINK', label: 'Open Pactlab', url: expect.stringMatching(/\/notifications$/) });
    expectContentFree(slack.outbox);

    const audit = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE organization_id = $1 AND action LIKE 'contact.slack_%' ORDER BY chain_seq`, [a.organizationId]);
    expect(audit.rows.map((row) => row.action)).toEqual(['contact.slack_installed', 'contact.slack_connected', 'contact.slack_delivered', 'contact.slack_delivered']);
  });

  it('Slack: an admin sees who is linked, by name, never a Slack id; members are refused', async () => {
    const page = await call('lead', 'GET', '/v1/organization/chat-apps/slack/members?limit=50');
    expect(page.status, page.text).toBe(200);
    expect((page.body['items'] as { userId: string; linked: boolean }[]).find((row) => row.userId === a.userId)?.linked).toBe(true);
    expect(page.text).not.toContain(SLACK_LEAD);
    expect(page.text).not.toContain(TEAM);
    expect((await call('member', 'GET', '/v1/organization/chat-apps/slack/members')).status).toBe(403);
  });

  it('Slack: disconnect from Pactlab, and from the app home tab', async () => {
    const link = (await channels('lead')).find((row) => row.kind === 'SLACK')!;
    expect((await call('lead', 'DELETE', `/v1/me/contact/channels/${link.id}`)).status).toBe(200);
    expect(slack.homes.at(-1)).toMatchObject({ userId: SLACK_LEAD, linked: false });
    expect(await channels('lead')).toEqual([]);

    await call('lead', 'POST', '/v1/me/contact/chat/slack');
    const again = slack.outbox.at(-1)!.message.action;
    await slackAction('pactlab_confirm', SLACK_LEAD, again?.kind === 'CONFIRM' ? again.value : '');
    expect((await channels('lead')).map((row) => row.kind)).toEqual(['SLACK']);
    await slackEvent({ type: 'app_home_opened', user: SLACK_LEAD, tab: 'home' });
    expect(slack.homes.at(-1)).toMatchObject({ linked: true });
    await slackAction('pactlab_disconnect', SLACK_LEAD);
    expect(await channels('lead')).toEqual([]);
    expect(slack.outbox.at(-1)?.message.text).toMatch(/^Pactlab: You are disconnected\./);
  });

  it('Slack: uninstalling the app or revoking its tokens stops sends at once', async () => {
    const relink = async () => {
      await call('lead', 'POST', '/v1/me/contact/chat/slack');
      const action = slack.outbox.at(-1)!.message.action;
      await slackAction('pactlab_confirm', SLACK_LEAD, action?.kind === 'CONFIRM' ? action.value : '');
      expect((await channels('lead')).map((row) => row.kind)).toEqual(['SLACK']);
    };
    await relink();
    expect((await slackEvent({ type: 'app_uninstalled' })).statusCode).toBe(200);
    expect(await channels('lead')).toEqual([]);
    expect((await call('lead', 'GET', '/v1/organization/chat-apps')).body).toMatchObject({ slack: { installed: false } });
    let before = slack.outbox.length;
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(slack.outbox.length).toBe(before);
    // The token is destroyed, not kept.
    expect([...secrets.values.values()]).not.toContain(`xoxb-fixture-${TEAM}`);

    expect((await install('lead', 'slack', 'code-a')).body).toEqual({ installed: true });
    await relink();
    expect((await slackEvent({ type: 'tokens_revoked', tokens: { bot: ['B1'] } })).statusCode).toBe(200);
    before = slack.outbox.length;
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(slack.outbox.length).toBe(before);
    const audit = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE organization_id = $1 AND action IN ('contact.slack_uninstalled', 'contact.slack_tokens_revoked')`, [a.organizationId]);
    expect(audit.rows.map((row) => row.action).sort()).toEqual(['contact.slack_tokens_revoked', 'contact.slack_uninstalled']);
  });

  it('Slack: an admin uninstalls from Pactlab; the token is revoked at Slack and destroyed', async () => {
    expect((await install('lead', 'slack', 'code-a')).body).toEqual({ installed: true });
    expect((await call('lead', 'DELETE', '/v1/organization/chat-apps/slack')).status).toBe(200);
    expect(slack.revoked).toContain(`xoxb-fixture-${TEAM}`);
    expect([...secrets.values.values()]).not.toContain(`xoxb-fixture-${TEAM}`);
    expect((await call('lead', 'DELETE', '/v1/organization/chat-apps/slack')).status).toBe(404);
  });

  it('Teams: an admin installs by Microsoft sign-in; the install event captures the conversation; another organization cannot take the tenant', async () => {
    expect((await install('lead', 'teams', 'tcode-a')).body).toEqual({ installed: true });
    expect((await install('other', 'teams', 'tcode-b')).body).toMatchObject({ code: 'INSTALL_TAKEN' });
    // Before the app is installed for the person, there is no chat to send to.
    expect((await call('lead', 'POST', '/v1/me/contact/chat/teams')).body).toMatchObject({ code: 'NOT_FOUND_IN_WORKSPACE' });
    // An activity without the Bot Framework token is refused.
    expect((await teamsActivity({ type: 'installationUpdate', action: 'add' }, 'forged')).statusCode).toBe(403);
    expect((await teamsActivity({ type: 'installationUpdate', action: 'add' })).statusCode).toBe(200);
    const ref = await db.owner.query<{ email_hash: string | null }>(`SELECT email_hash FROM teams_conversation_refs WHERE aad_object_id = $1`, [AAD_LEAD]);
    expect(ref.rows[0]?.email_hash).toMatch(/^[0-9a-f]{64}$/);
    // The other organization installs its own tenant, but cannot link to this tenant's member with the same email.
    expect((await install('other', 'teams', 'tcode-b2')).body).toEqual({ installed: true });
    expect((await call('other', 'POST', '/v1/me/contact/chat/teams')).body).toMatchObject({ code: 'NOT_FOUND_IN_WORKSPACE' });
  });

  it('Teams: link by verified email, confirm in Teams, a test message arrives, disconnect by "stop"; all content-free', async () => {
    expect((await call('lead', 'POST', '/v1/me/contact/chat/teams')).status).toBe(202);
    const ask = teams.outbox.at(-1)!;
    expect(ask).toMatchObject({ channel: 'TEAMS', to: AAD_LEAD, message: { action: { kind: 'CONFIRM' } } });
    const value = ask.message.action?.kind === 'CONFIRM' ? ask.message.action.value : '';
    await teamsActivity({ type: 'message', value: { pactlab: 'confirm', token: value } });
    expect(teams.outbox.at(-1)?.message.text).toMatch(/^Pactlab: You are connected\./);
    const link = (await channels('lead')).find((row) => row.kind === 'TEAMS')!;
    const before = teams.outbox.length;
    expect((await call('lead', 'POST', `/v1/me/contact/channels/${link.id}/test`)).status).toBe(200);
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(teams.outbox.slice(before).map((message) => message.message.text.split('.')[0])).toEqual(['Pactlab: This is a test message', 'Pactlab: A pact needs you']);
    expectContentFree(teams.outbox);

    await teamsActivity({ type: 'message', text: 'stop' });
    expect(await channels('lead')).toEqual([]);
    expect(teams.outbox.at(-1)?.message.text).toMatch(/^Pactlab: You are disconnected\./);
  });

  it('Teams: removing the app, or an admin uninstalling, stops sends at once', async () => {
    const relink = async () => {
      await call('lead', 'POST', '/v1/me/contact/chat/teams');
      const action = teams.outbox.at(-1)!.message.action;
      await teamsActivity({ type: 'message', value: { pactlab: 'confirm', token: action?.kind === 'CONFIRM' ? action.value : '' } });
      expect((await channels('lead')).map((row) => row.kind)).toEqual(['TEAMS']);
    };
    await relink();
    await teamsActivity({ type: 'installationUpdate', action: 'remove' });
    expect(await channels('lead')).toEqual([]);
    await teamsActivity({ type: 'installationUpdate', action: 'add' });
    await relink();
    expect((await call('lead', 'DELETE', '/v1/organization/chat-apps/teams')).status).toBe(200);
    expect(await channels('lead')).toEqual([]);
    const before = teams.outbox.length;
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(teams.outbox.length).toBe(before);
  });

  it('no workspace, tenant, member id or token reached a log line or the AI gateway', () => {
    const logs = logLines.join('\n');
    for (const value of [TEAM, TENANT, AAD_LEAD, SLACK_LEAD, 'xoxb-', 'lead@contact.test', 'a:lead-personal']) expect(logs).not.toContain(value);
    expect(gateway.calls).toHaveLength(0);
  });
});
