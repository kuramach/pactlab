import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ClaudeGateway } from '@pactlab/ai';
import { FixtureTelegramBot, type FixtureWhatsAppSender } from '@pactlab/connectors';
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
import { fixtureWhatsApp } from './channels-config';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'contact-test-secret-at-least-32-characters';
const TELEGRAM_SECRET = 'fixture-telegram-secret';
const WHATSAPP_SECRET = 'fixture-whatsapp-secret';

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

/** The AI gateway, recording every call: contact flows must never make one. */
class RecordingGateway implements ClaudeGateway {
  readonly calls: unknown[] = [];
  invoke(...args: unknown[]): never {
    this.calls.push(args);
    throw new Error('no model calls in contact flows');
  }
}

type Profile = {
  displayName: string;
  email: { address: string; verified: boolean; source: string } | null;
  askForEmail: boolean;
  channels: { id: string; kind: string; label: string }[];
  available: { telegram: boolean; whatsapp: boolean };
};

/**
 * T-180 acceptance: an Auth0 person with a verified email claim gets notification emails; one without
 * is asked, verifies by code and then gets them. Telegram connects by deep link, gets a content-free
 * message, disconnects, and hears nothing more. WhatsApp is off by default; on (fixture), it verifies
 * by code, sends one template message, and STOP ends sends. Nobody reads another person's channels;
 * an admin sees masked values; no contact detail reaches a log line or the AI gateway.
 */
describe('contact details in the profile (T-180)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  let member: Awaited<ReturnType<typeof addSyntheticDealMember>>;
  const sender = new RecordingSender();
  const gateway = new RecordingGateway();
  const identities = new FixtureIdentityEmails();
  const telegram = new FixtureTelegramBot('PactlabFixtureBot', TELEGRAM_SECRET);
  const whatsapp: FixtureWhatsAppSender = fixtureWhatsApp();
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};
  const CHAT = '9100000042';
  const NUMBER = '+15555550142';

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>, text: response.body };
  }
  const profile = async (who: string) => (await call(who, 'GET', '/v1/me/contact')).body as unknown as Profile;
  const lastCode = (to: string) => /\b(\d{6})\b/.exec(sender.to(to).at(-1)?.text ?? '')?.[1] ?? '';

  /** An "act now" item for one person, as a pact event would leave it. */
  async function actNowFor(userId: string) {
    const event = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
      [event, a.organizationId, a.dealId, `t180-${event}`, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(`INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED')`, [newId(), a.organizationId, a.dealId, event, userId]);
  }

  async function telegramUpdate(update: unknown, secret = TELEGRAM_SECRET) {
    return app.inject({ method: 'POST', url: '/v1/webhooks/telegram', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, payload: JSON.stringify(update) });
  }
  async function whatsappInbound(from: string, text: string, secret = WHATSAPP_SECRET) {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messages: [{ from: from.slice(1), id: `wamid.${newId()}`, type: 'text', text: { body: text } }] } }] }] });
    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    return app.inject({ method: 'POST', url: '/v1/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload });
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Contact');
    const b = await createSyntheticTenant(db.owner, 'Contact other org');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
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
    app = await createApp({ ...deps, contacts: { identityEmails: identities, telegram, whatsapp } });
    await app.init();
    // The same API with no channels configured: Telegram and WhatsApp are off by default.
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    // The lead's Auth0 token carries a verified email; the member's does not.
    identities.set(tokens['lead']!, { email: 'Lead@Contact.test', emailVerified: true });
    identities.set(tokens['member']!, { email: 'member@contact.test', emailVerified: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  it('an Auth0 person with a verified email claim has it on file and gets notification emails', async () => {
    const lead = await profile('lead');
    expect(lead).toMatchObject({ email: { address: 'lead@contact.test', verified: true, source: 'AUTH0_CLAIM' }, askForEmail: false });
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(sender.to('lead@contact.test')).toHaveLength(1);
  });

  it('one without a verified claim is asked, confirms by code, and then gets them', async () => {
    expect(await profile('member')).toMatchObject({ email: null, askForEmail: true });
    // Nothing to send to yet.
    await actNowFor(member.userId);
    await dispatcher.run();
    expect(sender.sent.filter((message) => message.to.startsWith('member'))).toHaveLength(0);

    expect((await call('member', 'POST', '/v1/me/contact/email', { email: 'Member@Contact.test' })).status).toBe(202);
    expect(sender.to('member@contact.test')[0]?.subject).toBe('Confirm your email for Pactlab');
    expect((await call('member', 'POST', '/v1/me/contact/email/confirm', { code: '000000' })).body).toMatchObject({ code: 'INVALID_CODE' });
    expect((await call('member', 'POST', '/v1/me/contact/email/confirm', { code: lastCode('member@contact.test') })).status).toBe(200);
    expect(await profile('member')).toMatchObject({ email: { address: 'member@contact.test', source: 'CODE' }, askForEmail: false });

    await actNowFor(member.userId);
    await dispatcher.run();
    expect(sender.to('member@contact.test').filter((message) => message.subject !== 'Confirm your email for Pactlab')).toHaveLength(1);
  });

  it('a changed address is confirmed at the new one, and the old one is told without naming it', async () => {
    await call('member', 'POST', '/v1/me/contact/email', { email: 'moved@contact.test' });
    await call('member', 'POST', '/v1/me/contact/email/confirm', { code: lastCode('moved@contact.test') });
    const notice = sender.to('member@contact.test').at(-1);
    expect(notice?.subject).toBe('Your Pactlab email was changed');
    expect(notice?.text).not.toContain('moved@');
    const audit = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.email_changed' AND actor_user_id = $1`, [member.userId]);
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('Telegram: connect by deep link, get a content-free test message, disconnect, and nothing more arrives', async () => {
    const link = await call('lead', 'POST', '/v1/me/contact/telegram');
    const url = String(link.body['url']);
    expect(url).toMatch(/^https:\/\/t\.me\/PactlabFixtureBot\?start=[A-Za-z0-9_-]{32}$/);
    const start = `/start ${new URL(url).searchParams.get('start')!}`;
    // A wrong secret header is refused; a group chat is ignored.
    expect((await telegramUpdate({ message: { chat: { id: Number(CHAT), type: 'private' }, text: start } }, 'wrong')).statusCode).toBe(403);
    expect((await telegramUpdate({ message: { chat: { id: Number(CHAT), type: 'private' }, text: start } })).statusCode).toBe(200);
    expect(telegram.outbox.at(-1)?.text).toMatch(/^Pactlab: You are connected\./);
    // The token works once.
    await telegramUpdate({ message: { chat: { id: 1, type: 'private' }, text: start } });
    expect(telegram.outbox.at(-1)).toMatchObject({ to: '1', text: expect.stringMatching(/expired or was already used/) });

    const channel = (await profile('lead')).channels.find((row) => row.kind === 'TELEGRAM')!;
    expect(channel.label).toBe('Connected');
    expect((await call('lead', 'POST', `/v1/me/contact/channels/${channel.id}/test`)).status).toBe(200);
    await actNowFor(a.userId);
    await dispatcher.run();
    const toChat = telegram.outbox.filter((message) => message.to === CHAT);
    for (const message of toChat) {
      expect(message.sender).toBe(CHANNEL_SENDER);
      expect(message.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
      // Content-free: never the pact's name or any id.
      expect(message.text).not.toContain(a.dealName);
      expect(message.text).not.toContain(a.dealId);
    }
    expect(toChat.map((message) => message.text.split('.')[0])).toEqual(['Pactlab: You are connected', 'Pactlab: This is a test message', 'Pactlab: A pact needs you']);

    // Someone else cannot test or disconnect it.
    expect((await call('member', 'POST', `/v1/me/contact/channels/${channel.id}/test`)).status).toBe(404);
    expect((await call('member', 'DELETE', `/v1/me/contact/channels/${channel.id}`)).status).toBe(404);
    expect((await call('lead', 'DELETE', `/v1/me/contact/channels/${channel.id}`)).status).toBe(200);
    expect(telegram.outbox.at(-1)?.text).toMatch(/^Pactlab: You are disconnected\./);
    const before = telegram.outbox.length;
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(telegram.outbox.length).toBe(before);
  });

  it('Telegram: /stop or blocking the bot ends messages from Telegram itself', async () => {
    for (const how of ['stop', 'block'] as const) {
      const url = String((await call('lead', 'POST', '/v1/me/contact/telegram')).body['url']);
      await telegramUpdate({ message: { chat: { id: Number(CHAT), type: 'private' }, text: `/start ${new URL(url).searchParams.get('start')!}` } });
      expect((await profile('lead')).channels.map((row) => row.kind)).toContain('TELEGRAM');
      await telegramUpdate(how === 'stop' ? { message: { chat: { id: Number(CHAT), type: 'private' }, text: '/stop' } } : { my_chat_member: { chat: { id: Number(CHAT), type: 'private' }, new_chat_member: { status: 'kicked' } } });
      expect((await profile('lead')).channels.map((row) => row.kind)).not.toContain('TELEGRAM');
    }
  });

  it('WhatsApp is off by default', async () => {
    expect((await call('lead', 'GET', '/v1/me/contact', undefined, off)).body).toMatchObject({ available: { telegram: false, whatsapp: false } });
    expect((await call('lead', 'POST', '/v1/me/contact/whatsapp', { number: NUMBER, consent: true }, off)).body).toMatchObject({ code: 'WHATSAPP_OFF' });
    expect((await call('lead', 'POST', '/v1/me/contact/telegram', undefined, off)).body).toMatchObject({ code: 'TELEGRAM_OFF' });
    expect((await off.inject({ method: 'POST', url: '/v1/webhooks/telegram', payload: '{}' })).statusCode).toBe(404);
  });

  it('WhatsApp (fixture): verifies the number by code with consent, sends one template message, and STOP ends sends', async () => {
    expect((await call('lead', 'POST', '/v1/me/contact/whatsapp', { number: NUMBER })).status).toBe(400);
    expect((await call('lead', 'POST', '/v1/me/contact/whatsapp', { number: '0142', dial: '1', consent: true })).status).toBe(422);
    const started = await call('lead', 'POST', '/v1/me/contact/whatsapp', { number: '(555) 555-0142', dial: '1', consent: true });
    expect(started.body).toMatchObject({ sent: true, number: NUMBER });
    const code = whatsapp.outbox.at(-1)!;
    expect(code).toMatchObject({ to: NUMBER, template: 'VERIFY', sender: CHANNEL_SENDER });
    expect((await call('lead', 'POST', '/v1/me/contact/whatsapp/confirm', { code: /\d{6}/.exec(code.text)![0] })).status).toBe(200);
    const channel = (await profile('lead')).channels.find((row) => row.kind === 'WHATSAPP')!;
    expect(channel.label).toBe(NUMBER);
    const consent = await db.owner.query<{ consent_text: string; consented_at: Date }>(`SELECT consent_text, consented_at FROM user_contact_channels WHERE id = $1`, [channel.id]);
    expect(consent.rows[0]?.consent_text).toMatch(/Reply STOP/);

    await actNowFor(a.userId);
    await dispatcher.run();
    const sent = whatsapp.outbox.filter((message) => message.template === 'ACT_NOW');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
    expect(sent[0]?.text).not.toContain(a.dealName);

    // A forged STOP is refused; a signed one ends every message at once.
    expect((await whatsappInbound(NUMBER, 'STOP', 'forged')).statusCode).toBe(403);
    expect((await whatsappInbound(NUMBER, 'STOP')).statusCode).toBe(200);
    await actNowFor(a.userId);
    await dispatcher.run();
    expect(whatsapp.outbox.filter((message) => message.template === 'ACT_NOW')).toHaveLength(1);
    const stopped = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.whatsapp_stopped' AND actor_user_id = $1`, [a.userId]);
    expect(stopped.rows[0]?.n).toBe(1);
  });

  it('answers Meta’s subscription handshake only with the verify token', async () => {
    const ok = await app.inject({ method: 'GET', url: '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=fixture-whatsapp-verify&hub.challenge=1158201444' });
    expect([ok.statusCode, ok.body]).toEqual([200, '1158201444']);
    expect((await app.inject({ method: 'GET', url: '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1' })).statusCode).toBe(403);
  });

  it('an admin sees members masked and the read is audited; a member and another organization are refused', async () => {
    // A live WhatsApp number again, so the mask has something to hide.
    await call('lead', 'POST', '/v1/me/contact/whatsapp', { number: NUMBER, consent: true });
    await call('lead', 'POST', '/v1/me/contact/whatsapp/confirm', { code: /\d{6}/.exec(whatsapp.outbox.at(-1)!.text)![0] });
    const page = await call('lead', 'GET', '/v1/organization/contacts?limit=50');
    expect(page.status, page.text).toBe(200);
    const lead = (page.body['items'] as { userId: string; email: string; whatsapp: string }[]).find((row) => row.userId === a.userId);
    expect(lead).toMatchObject({ email: 'l•••@contact.test', whatsapp: '+1 •••• ••42' });
    expect(page.text).not.toContain('5555550142');
    expect(page.text).not.toContain('lead@contact.test');
    expect(page.text).not.toContain('moved@contact.test');
    const audit = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.admin_viewed' AND actor_user_id = $1 AND outcome = 'SUCCEEDED'`, [a.userId]);
    expect(audit.rows[0]?.n).toBe(1);
    expect((await call('member', 'GET', '/v1/organization/contacts')).status).toBe(403);
    // Another organization's admin sees only its own members.
    const other = await call('other', 'GET', '/v1/organization/contacts');
    expect(other.text).not.toContain(a.userId);
  });

  it('no contact detail reached a log line or the AI gateway', () => {
    const logs = logLines.join('\n');
    for (const value of ['lead@contact.test', 'member@contact.test', 'moved@contact.test', CHAT, NUMBER, NUMBER.slice(1)]) expect(logs).not.toContain(value);
    expect(gateway.calls).toHaveLength(0);
  });
});
