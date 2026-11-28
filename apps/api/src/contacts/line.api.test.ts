import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ClaudeGateway } from '@pactlab/ai';
import { FixtureLineMessenger } from '@pactlab/connectors';
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
const SECRET = 'line-test-secret-at-least-32-characters';
const LINE_SECRET = 'fixture-line-secret';
const LINE_USER = `U${'4c'.repeat(16)}`;
const FRIEND_USER = `U${'9e'.repeat(16)}`;

class RecordingSender implements EmailSender {
  readonly name = 'recording';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

class RecordingGateway implements ClaudeGateway {
  readonly calls: unknown[] = [];
  invoke(...args: unknown[]): never {
    this.calls.push(args);
    throw new Error('no model calls in contact flows');
  }
}

type Profile = { channels: { id: string; kind: string; label: string }[]; available: { telegram: boolean; whatsapp: boolean; line: boolean } };

/**
 * T-182 acceptance, with the fixture: connect via LINE Login, add the account as a friend, get a content-free
 * test message; unfollow disconnects and nothing more is sent. A webhook with a bad signature is rejected. At
 * the monthly cap: no LINE send, the email still goes, and the operator sees "allowance reached". No pact
 * content reaches a LINE payload; no LINE user id reaches a log line or the AI gateway.
 */
describe('LINE for Japan (T-182)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;
  const sender = new RecordingSender();
  const gateway = new RecordingGateway();
  const line = new FixtureLineMessenger('@pactlabfixture', LINE_SECRET);
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>, text: response.body };
  }
  const profile = async (who: string) => (await call(who, 'GET', '/v1/me/contact')).body as unknown as Profile;
  const lineChannel = async (who: string) => (await profile(who)).channels.find((row) => row.kind === 'LINE');
  const pushes = (to: string) => line.outbox.filter((message) => message.kind === 'PUSH' && message.to === to);

  async function webhook(events: unknown[], secret = LINE_SECRET) {
    const payload = JSON.stringify({ destination: `U${'0'.repeat(32)}`, events });
    const signature = createHmac('sha256', secret).update(payload).digest('base64');
    return app.inject({ method: 'POST', url: '/v1/webhooks/line', headers: { 'content-type': 'application/json', 'x-line-signature': signature }, payload });
  }
  const follow = (userId: string) => ({ type: 'follow', replyToken: `rt${newId().replace(/-/g, '')}`, source: { type: 'user', userId }, follow: { isUnblocked: false } });
  const unfollow = (userId: string) => ({ type: 'unfollow', source: { type: 'user', userId } });

  /** Start LINE Login as `who`, and have LINE answer the code with `result`. The state and code. */
  async function login(who: string, result: { userId: string; friend: boolean }) {
    const started = await call(who, 'POST', '/v1/me/contact/line');
    expect(started.status, started.text).toBe(200);
    const state = new URL(String(started.body['url'])).searchParams.get('state')!;
    const code = `code${newId().replace(/-/g, '')}`;
    line.logins.set(code, result);
    return { state, code, url: new URL(String(started.body['url'])) };
  }

  async function actNowFor(userId: string) {
    const event = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
      [event, a.organizationId, a.dealId, `t182-${event}`, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`, [newId(), a.organizationId, a.dealId, event, userId]);
  }

  /** Every LINE payload: from Pactlab, prefixed, content-free. */
  function expectContentFree() {
    expect(line.outbox.length).toBeGreaterThan(0);
    for (const message of line.outbox) {
      expect(message.sender).toBe(CHANNEL_SENDER);
      expect(message.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
      for (const secret of [a.dealName, a.dealId, a.organizationId, 'TERMS_PROPOSED', '/deals/']) expect(message.text).not.toContain(secret);
    }
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Line');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identities = new FixtureIdentityEmails();
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'debug', destination: new Writable({ write: (chunk: Buffer, _encoding, done) => { logLines.push(chunk.toString('utf8')); done(); } }) }),
      documents: { gateway },
      emailLogin: { tokenSecret: SECRET, emailSender: sender },
    };
    app = await createApp({ ...deps, contacts: { identityEmails: identities, line, lineMonthlyAllowance: 200 } });
    await app.init();
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    identities.set(tokens['lead']!, { email: 'lead@line.test', emailVerified: true });
    identities.set(tokens['member']!, { email: 'member@line.test', emailVerified: true });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  it('is off by default', async () => {
    expect(((await call('lead', 'GET', '/v1/me/contact', undefined, off)).body as unknown as Profile).available.line).toBe(false);
    expect((await call('lead', 'POST', '/v1/me/contact/line', undefined, off)).body).toMatchObject({ code: 'LINE_OFF' });
    expect((await off.inject({ method: 'POST', url: '/v1/webhooks/line', payload: '{}' })).statusCode).toBe(404);
  });

  it('LINE Login asks for openid and profile with PKCE and the add-friend prompt, returning to the profile', async () => {
    const { url } = await login('lead', { userId: LINE_USER, friend: false });
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('bot_prompt')).toBe('aggressive');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/settings\/profile\/line\/callback$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('connects via LINE Login, then adding the friend; a content-free test message; unfollow disconnects and nothing more is sent', async () => {
    const { state, code } = await login('lead', { userId: LINE_USER, friend: false });
    // Someone else cannot use the lead's state.
    const stolen = `code${newId().replace(/-/g, '')}`;
    line.logins.set(stolen, { userId: LINE_USER, friend: true });
    expect((await call('member', 'POST', '/v1/me/contact/line/callback', { code: stolen, state })).body).toMatchObject({ code: 'LINE_LINK_EXPIRED' });

    const back = await call('lead', 'POST', '/v1/me/contact/line/callback', { code, state });
    expect(back.body).toEqual({ status: 'ADD_FRIEND', addFriendUrl: 'https://line.me/R/ti/p/%40pactlabfixture' });
    // LINE was asked to check the nonce Pactlab derived for this state.
    expect(line.nonces.get(code)).toMatch(/^[0-9a-f]{32}$/);
    // Only LINE Login so far: nothing stored against the person, and the LINE user id nowhere in the tables.
    expect(await lineChannel('lead')).toBeUndefined();
    const anywhere = await db.owner.query<{ n: number }>(`SELECT (SELECT count(*) FROM user_contact_channels WHERE handle = $1) + (SELECT count(*) FROM contact_verifications WHERE target = $1 OR secret_hash = $1) AS n`, [LINE_USER]);
    expect(Number(anywhere.rows[0]?.n)).toBe(0);
    // The state worked once.
    line.logins.set('again', { userId: LINE_USER, friend: true });
    expect((await call('lead', 'POST', '/v1/me/contact/line/callback', { code: 'again', state })).body).toMatchObject({ code: 'LINE_LINK_EXPIRED' });

    // The person adds the account as a friend: the follow event finishes the link, and the reply (free) says so.
    expect((await webhook([follow(LINE_USER)])).statusCode).toBe(200);
    const channel = await lineChannel('lead');
    expect(channel?.label).toBe('Connected');
    const reply = line.outbox.filter((message) => message.kind === 'REPLY').at(-1);
    expect(reply?.text).toMatch(/^Pactlab: You are connected\..*\n.*接続しました/s);
    expect(pushes(LINE_USER)).toHaveLength(0);

    expect((await call('lead', 'POST', `/v1/me/contact/channels/${channel!.id}/test`)).status).toBe(200);
    await actNowFor(a.userId);
    const run = await dispatcher.run();
    expect(run.channelSent).toBe(1);
    expect(pushes(LINE_USER).map((message) => message.text.split('.')[0])).toEqual(['Pactlab: This is a test message', 'Pactlab: A pact needs you']);
    expect(pushes(LINE_USER)[1]?.text).toContain('対応が必要なパクトがあります');
    expectContentFree();

    // Unfollowing (blocking) the account disconnects at once; nothing more is pushed.
    expect((await webhook([unfollow(LINE_USER)])).statusCode).toBe(200);
    expect(await lineChannel('lead')).toBeUndefined();
    const before = pushes(LINE_USER).length;
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(pushes(LINE_USER)).toHaveLength(before);
    const audit = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'contact.line%' ORDER BY occurred_at`, [a.userId]);
    expect(audit.rows.map((row) => row.action)).toEqual(['contact.line_awaiting_friend', 'contact.line_connected', 'contact.line_stopped']);
  });

  it('connects at once when the person is already a friend', async () => {
    const { state, code } = await login('member', { userId: FRIEND_USER, friend: true });
    expect((await call('member', 'POST', '/v1/me/contact/line/callback', { code, state })).body).toMatchObject({ status: 'CONNECTED' });
    expect((await lineChannel('member'))?.label).toBe('Connected');
    // A follow from someone nobody is waiting for gets a free pointer to the profile, nothing more.
    await webhook([follow(`U${'7'.repeat(32)}`)]);
    expect(line.outbox.at(-1)).toMatchObject({ kind: 'REPLY', text: expect.stringMatching(/^Pactlab: To get notifications here, connect LINE from your Pactlab profile\./) });
  });

  it('rejects a webhook with a bad or missing signature, and changes nothing', async () => {
    expect((await webhook([unfollow(FRIEND_USER)], 'forged-secret')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/line', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ events: [unfollow(FRIEND_USER)] }) })).statusCode).toBe(403);
    expect((await lineChannel('member'))?.label).toBe('Connected');
  });

  it('at the monthly cap: no LINE send, the email still goes, and the operator sees the allowance reached', async () => {
    expect((await call('lead', 'GET', '/v1/admin/line-allowance')).status).toBe(403);
    line.used = 200;
    const emailsBefore = sender.sent.filter((message) => message.to === 'member@line.test').length;
    const pushesBefore = pushes(FRIEND_USER).length;
    await actNowFor(member.userId);
    const run = await dispatcher.run();
    expect(run.lineHeldBack).toBe(1);
    expect(pushes(FRIEND_USER)).toHaveLength(pushesBefore);
    expect(sender.sent.filter((message) => message.to === 'member@line.test').length).toBe(emailsBefore + 1);
    // The test button says so, rather than spending a message that is not there.
    const channel = await lineChannel('member');
    expect((await call('member', 'POST', `/v1/me/contact/channels/${channel!.id}/test`)).body).toMatchObject({ code: 'LINE_ALLOWANCE_REACHED' });
    expect(logLines.some((line) => line.includes('LINE monthly allowance reached'))).toBe(true);

    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [a.userId]);
    const view = await call('lead', 'GET', '/v1/admin/line-allowance');
    expect(view.body).toMatchObject({ configured: true, allowance: 200, used: 200, reached: true, heldBack: 2 });
    line.used = 0;
  });

  it('holds LINE sends when LINE cannot say how many were sent (fail closed)', async () => {
    line.quotaDown = true;
    await actNowFor(member.userId);
    const before = pushes(FRIEND_USER).length;
    expect((await dispatcher.run()).lineHeldBack).toBe(1);
    expect(pushes(FRIEND_USER)).toHaveLength(before);
    line.quotaDown = false;
  });

  it('no LINE user id reached a log line or the AI gateway', () => {
    const logs = logLines.join('\n');
    for (const value of [LINE_USER, FRIEND_USER, 'lead@line.test', 'member@line.test']) expect(logs).not.toContain(value);
    expect(gateway.calls).toHaveLength(0);
  });
});
