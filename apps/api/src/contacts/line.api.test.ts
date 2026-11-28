import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ClaudeGateway } from '@pactlab/ai';
import { FixtureLineChannel } from '@pactlab/connectors';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { ALERT_FOLD_MINUTES, CHANNEL_PREFIX, CHANNEL_SENDER, newId } from '@pactlab/domain';
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
const OPERATOR = 'ops@pactlab.test';
const LEAD_LINE = 'U0123456789abcdef0123456789abcdef';
const MEMBER_LINE = 'Ufedcba9876543210fedcba9876543210';

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

/** Contact flows must never call a model. */
class RecordingGateway implements ClaudeGateway {
  readonly calls: unknown[] = [];
  invoke(...args: unknown[]): never {
    this.calls.push(args);
    throw new Error('no model calls in contact flows');
  }
}

type Profile = {
  channels: { id: string; kind: string; label: string }[];
  available: { line: boolean };
  line: { pending: boolean; addFriendUrl: string } | null;
};

/**
 * T-182 acceptance, with the fixture LINE account: connect with LINE Login, add Pactlab as a friend, get a
 * content-free test message and "act now" alert; `unfollow` disconnects and nothing more is sent. A webhook
 * with a bad signature is refused. At the monthly allowance: no LINE send, the email still goes, and
 * operators see "LINE monthly allowance reached". No pact content, and no LINE user id, leaves where it should not.
 */
describe('LINE for Japan (T-182)', () => {
  // Every round is inside this month (Japan time): two days after the month began, a fold apart.
  const tokyo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const base = new Date(`${tokyo}-03T00:00:00+09:00`).getTime();
  let round = 0;
  const nextRound = () => new Date(base + ++round * (ALERT_FOLD_MINUTES + 1) * 60_000);
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
  const line = new FixtureLineChannel();
  const logLines: string[] = [];
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  async function call(
    who: string,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
    on = app,
  ) {
    const response = await on.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${tokens[who]!}`,
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    return {
      status: response.statusCode,
      body: response.json() as Record<string, unknown>,
      text: response.body,
    };
  }
  const profile = async (who: string) =>
    (await call(who, 'GET', '/v1/me/contact')).body as unknown as Profile;
  const lineChannel = async (who: string) =>
    (await profile(who)).channels.find((row) => row.kind === 'LINE');

  /** An "act now" item for one person, as a pact event would leave it, at the round's time. */
  async function actNowFor(userId: string, at: Date) {
    const event = newId();
    await db.owner.query(
      `INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility) VALUES ($1, $2, $3, 'TERMS_PROPOSED', 'ACT_NOW', $4, $5, 'SHARED')`,
      [event, a.organizationId, a.dealId, `t182-${event}`, `/deals/${a.dealId}/terms`],
    );
    await db.owner.query(
      `INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility, created_at) VALUES ($1, $2, $3, $4, $5, 'ACT_NOW', 'SHARED', $6)`,
      [newId(), a.organizationId, a.dealId, event, userId, new Date(at.getTime() - 60_000)],
    );
  }

  /** A LINE webhook, signed with the channel secret unless told otherwise. */
  async function webhook(events: unknown[], signature?: string) {
    const payload = JSON.stringify({ destination: 'U00000000000000000000000000000000', events });
    return app.inject({
      method: 'POST',
      url: '/v1/webhooks/line',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-line-signature': signature ?? line.sign(payload),
      },
      payload,
    });
  }
  const follow = (userId: string) => ({
    type: 'follow',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    replyToken: `reply-${newId()}`,
    webhookEventId: newId(),
    deliveryContext: { isRedelivery: false },
  });
  const unfollow = (userId: string) => ({
    type: 'unfollow',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    webhookEventId: newId(),
    deliveryContext: { isRedelivery: false },
  });

  /** Connect LINE: start, then come back from LINE Login with a code. The callback's answer. */
  async function signInWithLine(who: string, code: string) {
    const started = await call(who, 'POST', '/v1/me/contact/line');
    expect(started.status, started.text).toBe(200);
    const state = new URL(String(started.body['url'])).searchParams.get('state')!;
    return {
      state,
      result: await call(who, 'POST', '/v1/me/contact/line/callback', { code, state }),
    };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Line');
    member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const deps = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      logger: createLogger('api-test', {
        level: 'debug',
        destination: new Writable({
          write: (chunk: Buffer, _encoding, done) => {
            logLines.push(chunk.toString('utf8'));
            done();
          },
        }),
      }),
      documents: { gateway },
      emailLogin: { tokenSecret: SECRET, emailSender: sender },
    };
    app = await createApp({
      ...deps,
      contacts: {
        identityEmails: identities,
        line: { channel: line, allowance: 200 },
        operatorEmail: OPERATOR,
      },
    });
    await app.init();
    // The same API with no LINE configured: off by default.
    off = await createApp(deps);
    await off.init();
    dispatcher = app.get(NotificationDispatcher);
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    identities.set(tokens['lead']!, { email: 'lead@line.test', emailVerified: true });
    identities.set(tokens['member']!, { email: 'member@line.test', emailVerified: true });
    await profile('lead');
    await profile('member');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
  });

  it('is off by default', async () => {
    expect((await call('lead', 'GET', '/v1/me/contact', undefined, off)).body).toMatchObject({
      available: { line: false },
      line: null,
    });
    expect((await call('lead', 'POST', '/v1/me/contact/line', undefined, off)).body).toMatchObject({
      code: 'LINE_OFF',
    });
    expect(
      (await off.inject({ method: 'POST', url: '/v1/webhooks/line', payload: '{}' })).statusCode,
    ).toBe(404);
  });

  it('LINE Login asks for openid and profile with state, nonce, PKCE S256 and the add-friend prompt', async () => {
    const started = await call('lead', 'POST', '/v1/me/contact/line');
    const url = new URL(String(started.body['url']));
    const state = url.searchParams.get('state')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(url.searchParams.get('bot_prompt')).toBe('aggressive');
    expect(line.authorized.get(state)).toMatchObject({
      redirectUri: expect.stringMatching(/\/settings\/profile\/line\/callback$/),
    });
    // Only the state's hash is stored.
    const stored = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contact_verifications WHERE kind = 'LINE' AND secret_hash = $1`,
      [state],
    );
    expect(stored.rows[0]?.n).toBe(0);
  });

  it('connects only after both steps: LINE Login, then the friend added; the follow is answered for free', async () => {
    line.addLogin('code-lead-1', LEAD_LINE, false);
    const { result } = await signInWithLine('lead', 'code-lead-1');
    expect(result.body).toEqual({ status: 'AWAITING_FRIEND' });
    expect(await profile('lead')).toMatchObject({
      line: { pending: true, addFriendUrl: line.addFriendUrl },
    });
    expect(await lineChannel('lead')).toBeUndefined();
    // Between the steps, the LINE user id is stored nowhere: only a keyed hash.
    for (const table of ['user_contact_channels', 'contact_verifications']) {
      const found = await db.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t WHERE t::text LIKE $1`,
        [`%${LEAD_LINE}%`],
      );
      expect(found.rows[0]?.n, table).toBe(0);
    }

    expect((await webhook([follow(LEAD_LINE)])).statusCode).toBe(200);
    const channel = await lineChannel('lead');
    expect(channel).toMatchObject({ kind: 'LINE', label: 'Connected' });
    expect(await profile('lead')).toMatchObject({ line: { pending: false } });
    const reply = line.outbox.at(-1)!;
    expect(reply).toMatchObject({ via: 'REPLY', sender: CHANNEL_SENDER });
    expect(reply.text).toMatch(/^Pactlab: You are connected\./);
    const audit = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.line_connected' AND actor_user_id = $1`,
      [a.userId],
    );
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('a test message and an "act now" alert are content-free, in English and Japanese; the email goes too', async () => {
    const channel = (await lineChannel('lead'))!;
    expect((await call('lead', 'POST', `/v1/me/contact/channels/${channel.id}/test`)).status).toBe(
      200,
    );
    const at = nextRound();
    await actNowFor(a.userId, at);
    await dispatcher.run(at);
    const pushes = line.outbox.filter(
      (message) => message.via === 'PUSH' && message.to === LEAD_LINE,
    );
    expect(pushes.map((message) => message.text.split('.')[0])).toEqual([
      'Pactlab: This is a test message',
      'Pactlab: A pact needs you',
    ]);
    expect(pushes[1]!.text).toContain('対応が必要なパクトがあります');
    expect(pushes[1]!.text.endsWith('/notifications')).toBe(true);
    expect(sender.to('lead@line.test')).toHaveLength(1);
  });

  it('another person cannot use someone else’s state, and LINE’s own check refuses a code it did not issue', async () => {
    const started = await call('lead', 'POST', '/v1/me/contact/line');
    const state = new URL(String(started.body['url'])).searchParams.get('state')!;
    line.addLogin('code-stolen', MEMBER_LINE, true);
    expect(
      (await call('member', 'POST', '/v1/me/contact/line/callback', { code: 'code-stolen', state }))
        .body,
    ).toMatchObject({ code: 'LINE_LINK_EXPIRED' });
    expect(await lineChannel('member')).toBeUndefined();
    expect(
      (
        await call('member', 'POST', '/v1/me/contact/line/callback', {
          code: 'never-issued',
          state,
        })
      ).body,
    ).toMatchObject({ code: 'LINE_LOGIN_FAILED' });
  });

  it('someone already a friend is connected at once; nobody sees another person’s channel', async () => {
    line.addLogin('code-member', MEMBER_LINE, true);
    expect((await signInWithLine('member', 'code-member')).result.body).toEqual({
      status: 'LINKED',
    });
    expect(await lineChannel('member')).toMatchObject({ kind: 'LINE' });
    // The lead's channel is not the member's to test or disconnect.
    const leads = (await lineChannel('lead'))!;
    expect((await call('member', 'POST', `/v1/me/contact/channels/${leads.id}/test`)).status).toBe(
      404,
    );
    expect((await call('member', 'DELETE', `/v1/me/contact/channels/${leads.id}`)).status).toBe(
      404,
    );
    expect((await profile('member')).channels.map((row) => row.id)).not.toContain(leads.id);
  });

  it('a webhook with a bad signature is refused and changes nothing', async () => {
    const forged = await webhook([unfollow(LEAD_LINE)], 'bm90LXRoZS1zaWduYXR1cmU=');
    expect(forged.statusCode).toBe(403);
    expect((await webhook([unfollow(LEAD_LINE)], '')).statusCode).toBe(403);
    expect(await lineChannel('lead')).toBeDefined();
  });

  it('unfollow (blocking Pactlab) disconnects at once, and nothing more is sent', async () => {
    expect((await webhook([unfollow(LEAD_LINE)])).statusCode).toBe(200);
    expect(await lineChannel('lead')).toBeUndefined();
    const stopped = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.line_stopped' AND actor_user_id = $1`,
      [a.userId],
    );
    expect(stopped.rows[0]?.n).toBe(1);
    const before = line.outbox.filter((message) => message.to === LEAD_LINE).length;
    const at = nextRound();
    await actNowFor(a.userId, at);
    await dispatcher.run(at);
    expect(line.outbox.filter((message) => message.to === LEAD_LINE)).toHaveLength(before);
  });

  it('at the monthly allowance: no LINE send, the email still goes, and operators see it once', async () => {
    // LINE answers "You have reached your monthly limit." from now on.
    line.monthlyLimit = (await line.quota()).used;
    const pushes = () => line.outbox.filter((message) => message.via === 'PUSH').length;
    const before = pushes();
    const first = nextRound();
    await actNowFor(member.userId, first);
    const outcome = await dispatcher.run(first);
    expect(outcome.lineCapped).toBe(1);
    expect(pushes()).toBe(before);
    expect(sender.to('member@line.test')).toHaveLength(1);
    expect(sender.to(OPERATOR).map((message) => message.subject)).toEqual([
      'LINE monthly allowance reached',
    ]);
    expect(sender.to(OPERATOR)[0]?.text).not.toContain(a.dealName);

    // Pactlab stops itself for the rest of the month: no push is even tried, and operators are told once.
    const second = nextRound();
    await actNowFor(member.userId, second);
    expect((await dispatcher.run(second)).lineCapped).toBe(1);
    expect(sender.to('member@line.test')).toHaveLength(2);
    expect(sender.to(OPERATOR)).toHaveLength(1);
    const channel = (await lineChannel('member'))!;
    expect(
      (await call('member', 'POST', `/v1/me/contact/channels/${channel.id}/test`)).body,
    ).toMatchObject({ code: 'LINE_ALLOWANCE_REACHED' });

    // The operator console says so; nobody else can read it.
    expect((await call('member', 'GET', '/v1/admin/line-allowance')).status).toBe(403);
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [a.userId]);
    const console = await call('lead', 'GET', '/v1/admin/line-allowance');
    expect(console.status, console.text).toBe(200);
    expect(console.body).toMatchObject({
      available: true,
      month: tokyo,
      allowance: 200,
      reachedAt: expect.any(String),
      lineReports: { used: expect.any(Number) },
    });
  });

  it('every LINE payload is from Pactlab, starts "Pactlab:" and carries no pact content', () => {
    expect(line.outbox.map((message) => message.via)).toEqual(['REPLY', 'PUSH', 'PUSH']);
    for (const message of line.outbox) {
      expect(message.sender).toBe(CHANNEL_SENDER);
      expect(message.text.startsWith(`${CHANNEL_PREFIX} `)).toBe(true);
      const payload = JSON.stringify(message.payload);
      for (const value of [
        a.dealName,
        a.dealId,
        a.organizationId,
        'Target Software',
        'TERMS_PROPOSED',
        '/terms',
      ])
        expect(payload).not.toContain(value);
      expect(message.payload.messages.every((part) => part.type === 'text')).toBe(true);
    }
  });

  it('no LINE user id reached a log line or the AI gateway', () => {
    const logs = logLines.join('\n');
    for (const value of [LEAD_LINE, MEMBER_LINE, 'code-lead-1', 'code-member'])
      expect(logs).not.toContain(value);
    expect(gateway.calls).toHaveLength(0);
  });
});
