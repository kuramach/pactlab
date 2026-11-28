import 'reflect-metadata';
import { createECDH, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FixtureTelegramBot, FixtureWebPush } from '@pactlab/connectors';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { ALERT_DAILY_CAP, ALERT_FOLD_MINUTES, CHANNEL_PREFIX, CHANNEL_SENDER, newId, type NotificationUrgency } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { FixtureIdentityEmails } from '../contacts/auth0-userinfo';
import { NotificationDispatcher } from './notification-dispatcher';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const TELEGRAM_SECRET = 'fixture-telegram-secret';

class RecordingSender implements EmailSender {
  readonly name = 'recording';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** A browser's push subscription, as PushSubscription.toJSON gives it. */
function browserSubscription(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `https://${host}/fcm/send/${randomBytes(12).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

/**
 * T-146 acceptance, with the fixture push service and Telegram bot: an "act now" event reaches a
 * subscribed device within a dispatcher pass (a minute) and each linked channel once, content-free;
 * "for your information" never does; the 15-minute fold and the daily cap hold; each channel can be
 * turned off; an expired subscription is ended; nobody touches another person's devices.
 */
describe('urgent pact alerts (T-146)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  const email = new RecordingSender();
  const push = new FixtureWebPush();
  const telegram = new FixtureTelegramBot('PactlabFixtureBot', TELEGRAM_SECRET);
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};
  const CHAT = '9100000077';
  // The dispatcher's clock: each round is later than the last, past the fold.
  let clock = Date.now();
  const later = (minutes: number) => new Date((clock += minutes * 60_000));

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  }

  /** One pact event for one person, as `app_notify` leaves it. */
  async function event(tenant: SyntheticTenant, urgency: NotificationUrgency, dealId = tenant.dealId) {
    const id = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SHARED')`,
      [id, tenant.organizationId, dealId, urgency === 'ACT_NOW' ? 'TERMS_PROPOSED' : 'DOCUMENT_ADDED', urgency, `t146-${id}`, `/deals/${dealId}/terms`],
    );
    // Happened "now" on the dispatcher's clock.
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'SHARED', $7)`, [newId(), tenant.organizationId, dealId, id, tenant.userId, urgency, new Date(clock)]);
  }
  async function extraPact(tenant: SyntheticTenant) {
    const id = newId();
    await db.owner.query(
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ($1, $2, $3, 'Synthetic Target', 'PRIVATE_ACQUIRER', $4, now())`,
      [id, tenant.organizationId, `Synthetic pact ${id.slice(-4)}`, tenant.userId],
    );
    return id;
  }
  const pushesTo = (endpoint: string) => push.outbox.filter((row) => row.endpoint === endpoint);
  const telegramToChat = () => telegram.outbox.filter((row) => row.to === CHAT && /A pact needs you/.test(row.text));

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alerts');
    b = await createSyntheticTenant(db.owner, 'Alerts other org');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identities = new FixtureIdentityEmails();
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'debug', destination: new Writable({ write: (chunk: Buffer, _encoding, done) => { logLines.push(chunk.toString('utf8')); done(); } }) }),
      emailLogin: { tokenSecret: 'alerts-test-secret-at-least-32-characters', emailSender: email },
    };
    app = await createApp({ ...deps, contacts: { identityEmails: identities, telegram, push } });
    await app.init();
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['a'] = await token(a.subject, a.auth0OrganizationId);
    tokens['b'] = await token(b.subject, b.auth0OrganizationId);
    identities.set(tokens['a']!, { email: 'lead@alerts.test', emailVerified: true });
    await call('a', 'GET', '/v1/me/contact');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  let device: { id: string; endpoint: string };

  it('offers the VAPID public key, and is off where web push is not configured', async () => {
    const config = (await call('a', 'GET', '/v1/alerts/config')).body;
    expect(config).toMatchObject({ publicKey: push.publicKey, available: { WEB_PUSH: true, TELEGRAM: true }, dailyCap: ALERT_DAILY_CAP, foldMinutes: ALERT_FOLD_MINUTES });
    expect((await call('a', 'GET', '/v1/alerts/config', undefined, off)).body).toMatchObject({ publicKey: null, available: { WEB_PUSH: false } });
    expect((await call('a', 'POST', '/v1/me/push-subscriptions', { ...browserSubscription(), label: 'Chrome on macOS' }, off)).body).toMatchObject({ code: 'PUSH_OFF' });
  });

  it('subscribes a device; refuses a push service browsers do not use (SSRF) and a malformed key', async () => {
    expect((await call('a', 'POST', '/v1/me/push-subscriptions', { ...browserSubscription('metadata.internal'), label: 'Chrome' })).body).toMatchObject({ code: 'PUSH_SERVICE_UNKNOWN' });
    expect((await call('a', 'POST', '/v1/me/push-subscriptions', { ...browserSubscription(), keys: { p256dh: 'short', auth: 'x' }, label: 'Chrome' })).status).toBe(400);
    const subscription = browserSubscription();
    const created = await call('a', 'POST', '/v1/me/push-subscriptions', { ...subscription, label: 'Chrome on macOS' });
    expect(created.status).toBe(201);
    device = { id: String(created.body['id']), endpoint: subscription.endpoint };
    expect((await call('a', 'GET', '/v1/me/push-subscriptions')).body).toMatchObject({ items: [{ id: device.id, label: 'Chrome on macOS', lastSentAt: null }] });
    // The runtime role cannot read where a device's pushes go: only its own label and dates.
    await expect(
      db.owner.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE pactlab_app');
        await tx.query('SELECT endpoint FROM push_subscriptions');
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('an "act now" event notifies the device in the next pass, content-free; "for your information" never does', async () => {
    await event(a, 'FYI');
    await dispatcher.run(later(1));
    expect(pushesTo(device.endpoint)).toHaveLength(0);

    await event(a, 'ACT_NOW');
    const outcome = await dispatcher.run(later(1));
    expect(outcome).toMatchObject({ alerts: 1 });
    const [sent] = pushesTo(device.endpoint);
    const payload = JSON.parse(sent!.payload) as Record<string, string>;
    expect(payload).toMatchObject({ title: CHANNEL_SENDER, url: '/notifications', tag: 'pactlab-act-now' });
    expect(payload['body']!.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
    expect(sent!.urgency).toBe('high');
    // No pact name, id, party or organization reaches the device.
    for (const secret of [a.dealName, a.dealId, a.organizationId, 'Alerts']) expect(sent!.payload).not.toContain(secret);
    // Email stays as T-145 built it.
    expect(email.sent.filter((message) => message.to === 'lead@alerts.test').length).toBeGreaterThanOrEqual(1);
  });

  it('folds a pact’s events into one alert per 15 minutes, and sends the folded ones in the next', async () => {
    const pact = await extraPact(a);
    await event(a, 'ACT_NOW', pact);
    await dispatcher.run(later(ALERT_FOLD_MINUTES + 1));
    const before = pushesTo(device.endpoint).length;
    await event(a, 'ACT_NOW', pact);
    await event(a, 'ACT_NOW', pact);
    const folded = await dispatcher.run(later(5));
    expect(folded).toMatchObject({ alerts: 0, folded: 2 });
    expect(pushesTo(device.endpoint)).toHaveLength(before);
    // After the window, both go out together: one message.
    expect(await dispatcher.run(later(ALERT_FOLD_MINUTES))).toMatchObject({ alerts: 1 });
    expect(pushesTo(device.endpoint)).toHaveLength(before + 1);
    expect(await dispatcher.run(later(ALERT_FOLD_MINUTES + 1))).toMatchObject({ alerts: 0, folded: 0 });
  });

  it('Telegram gets one content-free message per alert, and each channel can be turned off on its own', async () => {
    const url = String((await call('a', 'POST', '/v1/me/contact/telegram')).body['url']);
    await app.inject({ method: 'POST', url: '/v1/webhooks/telegram', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET }, payload: JSON.stringify({ message: { chat: { id: Number(CHAT), type: 'private' }, text: `/start ${new URL(url).searchParams.get('start')!}` } }) });
    const pushed = pushesTo(device.endpoint).length;
    await event(a, 'ACT_NOW');
    await dispatcher.run(later(ALERT_FOLD_MINUTES + 1));
    expect(telegramToChat()).toHaveLength(1);
    expect(pushesTo(device.endpoint)).toHaveLength(pushed + 1);
    for (const message of telegramToChat()) {
      expect(message.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
      expect(message.text).not.toContain(a.dealName);
    }

    expect((await call('a', 'PUT', '/v1/notification-settings/channels', { off: ['WEB_PUSH'] })).body).toMatchObject({ off: ['WEB_PUSH'] });
    expect((await call('a', 'PUT', '/v1/notification-settings/channels', { off: ['SMS'] })).status).toBe(400);
    await event(a, 'ACT_NOW');
    await dispatcher.run(later(ALERT_FOLD_MINUTES + 1));
    expect(telegramToChat()).toHaveLength(2);
    expect(pushesTo(device.endpoint)).toHaveLength(pushed + 1);

    await call('a', 'PUT', '/v1/notification-settings/channels', { off: ['WEB_PUSH', 'TELEGRAM'] });
    await event(a, 'ACT_NOW');
    await dispatcher.run(later(ALERT_FOLD_MINUTES + 1));
    expect(telegramToChat()).toHaveLength(2);
    await call('a', 'PUT', '/v1/notification-settings/channels', { off: [] });
  });

  it('caps a person at 10 alerts in 24 hours across pacts; email and the inbox still carry the rest', async () => {
    clock += 25 * 3_600_000;
    const sentBefore = pushesTo(device.endpoint).length;
    const emailsBefore = email.sent.length;
    const pacts = await Promise.all(Array.from({ length: ALERT_DAILY_CAP + 2 }, () => extraPact(a)));
    for (const pact of pacts) await event(a, 'ACT_NOW', pact);
    const outcome = await dispatcher.run(later(1));
    expect(outcome).toMatchObject({ alerts: ALERT_DAILY_CAP, capped: 2 });
    expect(pushesTo(device.endpoint)).toHaveLength(sentBefore + ALERT_DAILY_CAP);
    // Every one is emailed at once (the digest of earlier "for your information" items may join them).
    expect(email.sent.length - emailsBefore).toBeGreaterThanOrEqual(ALERT_DAILY_CAP + 2);
    // Capped items are settled: the cap lifting later does not flood the phone with stale alerts.
    clock += 25 * 3_600_000;
    expect(await dispatcher.run(later(1))).toMatchObject({ alerts: 0 });
  });

  it('a subscription the push service says is gone is ended at once', async () => {
    clock += 25 * 3_600_000;
    push.expire(device.endpoint);
    await event(a, 'ACT_NOW');
    expect(await dispatcher.run(later(1))).toMatchObject({ pushExpired: 1 });
    expect((await call('a', 'GET', '/v1/me/push-subscriptions')).body).toMatchObject({ items: [] });
    const expired = await db.owner.query<{ revoked_reason: string }>(`SELECT revoked_reason FROM push_subscriptions WHERE id = $1`, [device.id]);
    expect(expired.rows[0]?.revoked_reason).toBe('EXPIRED');
  });

  it('a device is its owner’s alone: another organization cannot list, test or remove it', async () => {
    const subscription = browserSubscription('updates.push.services.mozilla.com');
    const { body } = await call('a', 'POST', '/v1/me/push-subscriptions', { ...subscription, label: 'Firefox on Windows' });
    const id = String(body['id']);
    expect((await call('b', 'GET', '/v1/me/push-subscriptions')).body).toMatchObject({ items: [] });
    expect((await call('b', 'POST', `/v1/me/push-subscriptions/${id}/test`)).status).toBe(404);
    expect((await call('b', 'DELETE', `/v1/me/push-subscriptions/${id}`)).status).toBe(404);
    expect((await call('a', 'POST', `/v1/me/push-subscriptions/${id}/test`)).body).toMatchObject({ sent: true });
    expect(JSON.parse(pushesTo(subscription.endpoint).at(-1)!.payload)).toMatchObject({ title: 'Pactlab', body: expect.stringMatching(/^Pactlab: This is a test alert/) });
    expect((await call('a', 'DELETE', `/v1/me/push-subscriptions/${id}`)).status).toBe(200);
    const audit = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'contact.push_%'`, [a.userId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['contact.push_subscribed', 'contact.push_expired', 'contact.push_unsubscribed']));
  });

  it('no endpoint, key or chat id reaches a log line', () => {
    const logs = logLines.join('\n');
    expect(logs).not.toContain('fcm/send/');
    expect(logs).not.toContain(device.endpoint);
    expect(logs).not.toContain(CHAT);
  });
});
