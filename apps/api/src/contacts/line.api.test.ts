import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ClaudeGateway } from '@pactlab/ai';
import { FixtureLineBot } from '@pactlab/connectors';
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
const LINE_SECRET = 'fixture-line-channel-secret';
// Fictional LINE user IDs, in the documented shape.
const LEAD_LINE = `U${'1'.repeat(30)}ab`;
const MEMBER_LINE = `U${'2'.repeat(30)}cd`;
const ALLOWANCE = 3;

class RecordingSender implements EmailSender {
  readonly name = 'recording';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
  to(address: string) {
    return this.sent.filter((message) => message.to === address);
  }
}

class RecordingGateway implements ClaudeGateway {
  readonly calls: unknown[] = [];
  invoke(...args: unknown[]): never {
    this.calls.push(args);
    throw new Error('no model calls in contact flows');
  }
}

/**
 * T-182 acceptance (fixture LINE): connect via LINE Login, add Pactlab as a friend, get a content-free test
 * message; `unfollow` disconnects and nothing more is sent. A webhook with a bad signature is rejected. At the
 * monthly allowance there is no LINE send, the email still goes, and operators see the notice. No pact content
 * reaches a LINE payload; the LINE user ID reaches no log line and no model.
 */
describe('LINE: pact alerts, linked from the profile (T-182)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;
  let dealName = '';
  let orgName = '';
  const sender = new RecordingSender();
  const gateway = new RecordingGateway();
  const identities = new FixtureIdentityEmails();
  const line = new FixtureLineBot(LINE_SECRET);
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  }
  const profile = async (who: string) => (await call(who, 'GET', '/v1/me/contact')).body as { channels: { id: string; kind: string; label: string }[]; available: { line: boolean }; linePending: { addFriendUrl: string | null } | null };

  async function actNowFor(userId: string) {
    const event = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
      [event, a.organizationId, a.dealId, `t182-${event}`, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`, [newId(), a.organizationId, a.dealId, event, userId]);
  }

  /** A LINE webhook body, signed as LINE signs it (Base64 HMAC-SHA256 of the raw body). */
  async function webhook(events: unknown[], secret = LINE_SECRET) {
    const payload = JSON.stringify({ destination: `U${'f'.repeat(32)}`, events });
    const signature = createHmac('sha256', secret).update(payload).digest('base64');
    return app.inject({ method: 'POST', url: '/v1/webhooks/line', headers: { 'content-type': 'application/json', 'x-line-signature': signature }, payload });
  }
  const follow = (userId: string) => ({ type: 'follow', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId }, replyToken: `reply-${newId()}`, webhookEventId: newId(), deliveryContext: { isRedelivery: false } });
  const unfollow = (userId: string) => ({ type: 'unfollow', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId }, webhookEventId: newId(), deliveryContext: { isRedelivery: false } });

  /** Connect LINE as `who`: the profile's button, LINE Login's page, and LINE sending the person back. */
  async function connect(who: string, lineUser: string) {
    const start = await call(who, 'POST', '/v1/me/contact/line');
    expect(start.status).toBe(200);
    const url = new URL(String(start.body['url']));
    expect(url.pathname).toBe('/oauth2/v2.1/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid profile', bot_prompt: 'aggressive', redirect_uri: 'http://localhost:3000/settings/profile/line/callback' });
    const code = `code-${newId()}`;
    line.logins.set(code, lineUser);
    return call(who, 'POST', '/v1/me/contact/line/callback', { code, state: url.searchParams.get('state') });
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Line');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    dealName = (await db.owner.query<{ name: string }>(`SELECT name FROM deals WHERE id = $1`, [a.dealId])).rows[0]!.name;
    orgName = (await db.owner.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [a.organizationId])).rows[0]!.name;
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'debug', destination: new Writable({ write: (chunk: Buffer, _encoding, done) => { logLines.push(chunk.toString('utf8')); done(); } }) }),
      documents: { gateway },
      emailLogin: { tokenSecret: SECRET, emailSender: sender },
    };
    app = await createApp({ ...deps, contacts: { identityEmails: identities, line, lineAllowance: ALLOWANCE } });
    await app.init();
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    identities.set(tokens['lead']!, { email: 'lead@line.test', emailVerified: true });
    await db.owner.query(`DELETE FROM line_monthly_usage`);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  it('is off by default', async () => {
    expect((await call('lead', 'GET', '/v1/me/contact', undefined, off)).body).toMatchObject({ available: { line: false } });
    expect((await call('lead', 'POST', '/v1/me/contact/line', undefined, off)).body).toMatchObject({ code: 'LINE_OFF' });
    expect((await off.inject({ method: 'POST', url: '/v1/webhooks/line', payload: '{}' })).statusCode).toBe(404);
  });

  it('connects via LINE Login, waits for the friend add, then sends a content-free test message', async () => {
    // Not a friend yet: nothing is stored against the person until they add Pactlab.
    const back = await connect('lead', LEAD_LINE);
    expect(back.body).toEqual({ status: 'ADD_FRIEND', addFriendUrl: 'https://lin.ee/fixturePactlab' });
    let me = await profile('lead');
    expect(me.channels).toEqual([]);
    expect(me.linePending).toEqual({ addFriendUrl: 'https://lin.ee/fixturePactlab' });

    // The friend add arrives as a verified `follow`: connected, and the chat is told (a free reply).
    line.friends.add(LEAD_LINE);
    expect((await webhook([follow(LEAD_LINE)])).statusCode).toBe(200);
    me = await profile('lead');
    expect(me.channels.map((channel) => [channel.kind, channel.label])).toEqual([['LINE', 'Connected']]);
    expect(me.linePending).toBeNull();
    const reply = line.outbox.at(-1);
    expect(reply).toMatchObject({ kind: 'REPLY', sender: CHANNEL_SENDER });
    expect(reply?.text.startsWith(CHANNEL_PREFIX)).toBe(true);
    // The person's language is not known on the server yet: English, then Japanese.
    expect(reply?.text).toContain('You are connected.');
    expect(reply?.text).toContain('接続しました。');

    const channelId = me.channels[0]!.id;
    expect((await call('lead', 'POST', `/v1/me/contact/channels/${channelId}/test`)).status).toBe(200);
    const test = line.outbox.at(-1)!;
    expect(test).toMatchObject({ kind: 'PUSH', to: LEAD_LINE, sender: CHANNEL_SENDER });
    expect(test.payload).toEqual({ to: LEAD_LINE, messages: [{ type: 'text', text: test.text }] });
    expect(test.retryKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(test.text.startsWith(CHANNEL_PREFIX)).toBe(true);
    expect(test.text).toContain('http://localhost:3000/settings/profile');
  });

  it('connects at once when the person is already a friend', async () => {
    line.friends.add(MEMBER_LINE);
    expect((await connect('member', MEMBER_LINE)).body).toEqual({ status: 'LINKED', addFriendUrl: 'https://lin.ee/fixturePactlab' });
    expect((await profile('member')).channels.map((channel) => channel.kind)).toEqual(['LINE']);
  });

  it('refuses a tampered or foreign state, and a webhook with a bad signature', async () => {
    const start = await call('lead', 'POST', '/v1/me/contact/line');
    const state = new URL(String(start.body['url'])).searchParams.get('state')!;
    line.logins.set('code-x', MEMBER_LINE);
    // The member cannot finish the lead's sign-in, and a changed state is not ours.
    expect((await call('member', 'POST', '/v1/me/contact/line/callback', { code: 'code-x', state })).body).toMatchObject({ code: 'LINE_STATE_INVALID' });
    expect((await call('lead', 'POST', '/v1/me/contact/line/callback', { code: 'code-x', state: `${state}x` })).body).toMatchObject({ code: 'LINE_STATE_INVALID' });
    const before = line.outbox.length;
    expect((await webhook([unfollow(LEAD_LINE)], 'not-the-channel-secret')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/line', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ events: [unfollow(LEAD_LINE)] }) })).statusCode).toBe(403);
    expect((await profile('lead')).channels.map((channel) => channel.kind)).toEqual(['LINE']);
    expect(line.outbox.length).toBe(before);
  });

  it('routes act-now alerts to LINE with no pact content in the payload', async () => {
    const before = line.outbox.length;
    await actNowFor(a.userId);
    const outcome = await dispatcher.run();
    expect(outcome.channelSent).toBe(1);
    const pushes = line.outbox.slice(before);
    expect(pushes).toHaveLength(1);
    const payload = JSON.stringify(pushes[0]!.payload);
    expect(pushes[0]!.text.startsWith(CHANNEL_PREFIX)).toBe(true);
    expect(pushes[0]!.text).toContain('http://localhost:3000/notifications');
    for (const secret of [dealName, orgName, a.dealId, a.organizationId, 'terms', 'lead@line.test']) expect(payload).not.toContain(secret);
    // Replay-safe: a second pass sends nothing more.
    await dispatcher.run();
    expect(line.outbox.length).toBe(before + 1);
  });

  it('at the monthly allowance: no LINE send, the email still goes, and operators see the notice', async () => {
    // Two pushes so far (the test and one alert) out of three.
    const emails = sender.to('lead@line.test').length;
    await actNowFor(a.userId);
    await dispatcher.run();
    const sent = line.outbox.filter((message) => message.kind === 'PUSH').length;
    expect(sent).toBe(3);
    await actNowFor(a.userId);
    const outcome = await dispatcher.run();
    expect(outcome.channelFailed).toBe(1);
    expect(line.outbox.filter((message) => message.kind === 'PUSH').length).toBe(3);
    expect(sender.to('lead@line.test').length).toBe(emails + 2);
    const failed = await db.owner.query<{ error_class: string }>(`SELECT error_class FROM contact_channel_deliveries WHERE outcome = 'FAILED' ORDER BY created_at DESC LIMIT 1`);
    expect(failed.rows[0]?.error_class).toBe('LineAllowanceReached');
    // A test message is refused plainly too.
    const [channel] = (await profile('member')).channels;
    expect((await call('member', 'POST', `/v1/me/contact/channels/${channel!.id}/test`)).body).toMatchObject({ code: 'LINE_ALLOWANCE_REACHED' });

    expect((await call('lead', 'GET', '/v1/admin/line/usage')).status).toBe(403);
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [a.userId]);
    const usage = (await call('lead', 'GET', '/v1/admin/line/usage')).body;
    expect(usage).toMatchObject({ available: true, sent: 3, allowance: ALLOWANCE, notice: 'LINE monthly allowance reached' });
    expect(usage['reachedAt']).not.toBeNull();
    await db.owner.query(`UPDATE users SET platform_operator = false WHERE id = $1`, [a.userId]);
    await db.owner.query(`DELETE FROM line_monthly_usage`);
  });

  it('LINE answering its own monthly limit stops the month too', async () => {
    line.monthlyLimitReached = true;
    await actNowFor(a.userId);
    expect((await dispatcher.run()).channelFailed).toBe(1);
    line.monthlyLimitReached = false;
    await actNowFor(a.userId);
    expect((await dispatcher.run()).channelFailed).toBe(1);
    const failed = await db.owner.query<{ error_class: string }>(`SELECT error_class FROM contact_channel_deliveries WHERE outcome = 'FAILED' ORDER BY created_at DESC LIMIT 2`);
    expect(failed.rows.map((row) => row.error_class)).toEqual(['LineAllowanceReached', 'LineMonthlyLimit']);
    await db.owner.query(`DELETE FROM line_monthly_usage`);
  });

  it('unfollow disconnects at once, and nothing more is sent', async () => {
    expect((await webhook([unfollow(LEAD_LINE)])).statusCode).toBe(200);
    expect((await profile('lead')).channels).toEqual([]);
    const before = line.outbox.length;
    await actNowFor(a.userId);
    expect((await dispatcher.run()).channelSent).toBe(0);
    expect(line.outbox.length).toBe(before);
    const audit = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.line_stopped' AND target_id = $1`, [a.userId]);
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('STOP in the chat disconnects too, with a free reply', async () => {
    const event = { type: 'message', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId: MEMBER_LINE }, replyToken: `reply-${newId()}`, message: { id: '1', type: 'text', text: '停止' }, webhookEventId: newId(), deliveryContext: { isRedelivery: false } };
    expect((await webhook([event])).statusCode).toBe(200);
    expect((await profile('member')).channels).toEqual([]);
    expect(line.outbox.at(-1)).toMatchObject({ kind: 'REPLY' });
  });

  it('never logs a LINE user ID and never calls a model', () => {
    const logs = logLines.join('\n');
    for (const id of [LEAD_LINE, MEMBER_LINE]) expect(logs).not.toContain(id);
    expect(gateway.calls).toEqual([]);
  });
});
