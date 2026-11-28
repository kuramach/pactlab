import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChannelSendError, type LineEvent, type LineLoginResult, type LineMessenger, type LineMonthlyUsage } from './types';

/**
 * LINE (developers.line.biz, read 2026-11-27), behind one seam.
 * - LINE Login v2.1: `https://access.line.me/oauth2/v2.1/authorize` (`response_type=code`, `scope=openid profile`,
 *   `state`, `nonce`, `code_challenge` with `S256`, `bot_prompt=aggressive` to offer the official account as a
 *   friend after consent); `POST https://api.line.me/oauth2/v2.1/token` (form, with `code_verifier`);
 *   `POST https://api.line.me/oauth2/v2.1/verify` (form `id_token`, `client_id`, `nonce`: the payload's `sub`
 *   is the user id); `GET https://api.line.me/friendship/v1/status` (needs the `profile` scope) → `{ friendFlag }`.
 * - Messaging API: `POST https://api.line.me/v2/bot/message/push` and `/reply`, `Authorization: Bearer <channel
 *   access token>`; `GET /v2/bot/message/quota` (`{ type: 'none' | 'limited', value? }`) and
 *   `/quota/consumption` (`{ totalUsage }`). Push counts towards the monthly allowance; reply does not.
 * - Webhooks: `x-line-signature` = base64(HMAC-SHA256(body, channel secret)); `follow` and `unfollow` events
 *   (unfollow: the person blocked the account) arrive with `source: { type: 'user', userId }`.
 * The LINE Login channel must be linked to the Messaging API channel (same provider) for user ids to match.
 */
export interface LineOptions {
  /** Messaging API channel. */
  readonly channelSecret: string;
  readonly channelAccessToken: string;
  /** LINE Login channel, linked to the Messaging API channel. */
  readonly loginChannelId: string;
  readonly loginChannelSecret: string;
  /** The official account's basic ID, `@` and letters or digits: for the add-friend URL. */
  readonly basicId: string;
  readonly fetch?: typeof fetch;
  readonly apiBaseUrl?: string;
  readonly authorizeBaseUrl?: string;
}

/** A LINE user id: `U` and 32 hex characters. */
export const LINE_USER_ID = /^U[0-9a-f]{32}$/;
/** Text message limit (5,000 characters); Pactlab's are far shorter. */
const MAX_TEXT = 5000;

export function addFriendUrl(basicId: string): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
}

export class LineMessagingApi implements LineMessenger {
  readonly name = 'LINE' as const;
  readonly addFriendUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly api: string;

  constructor(private readonly options: LineOptions) {
    if (!/^\d{5,20}$/.test(options.loginChannelId)) throw new Error('LINE_LOGIN_CHANNEL_ID is not a channel id');
    if (!/^@[0-9a-z]{3,40}$/i.test(options.basicId)) throw new Error('LINE_BOT_BASIC_ID must look like @abc1234d');
    this.fetcher = options.fetch ?? fetch;
    this.api = options.apiBaseUrl ?? 'https://api.line.me';
    this.addFriendUrl = addFriendUrl(options.basicId);
  }

  authorizeUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL('/oauth2/v2.1/authorize', this.options.authorizeBaseUrl ?? 'https://access.line.me');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.loginChannelId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: 'openid profile',
      nonce: input.nonce,
      bot_prompt: 'aggressive',
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** One request; never follows redirects; reports failure by status only, never the provider's text. */
  private async request(path: string, init: RequestInit, label: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.api}${path}`, { ...init, redirect: 'manual' });
    } catch {
      throw new ChannelSendError(`${label}Unreachable`);
    }
    if (!response.ok) {
      // A push to someone who blocked the account fails; LINE's 429 here is the monthly limit or the rate limit.
      throw new ChannelSendError(`${label}${response.status}`);
    }
    const text = await response.text();
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw new ChannelSendError(`${label}BadResponse`);
    }
  }

  private form(values: Record<string, string>): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() };
  }

  async completeLogin(input: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<LineLoginResult> {
    const token = (await this.request(
      '/oauth2/v2.1/token',
      this.form({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.options.loginChannelId,
        client_secret: this.options.loginChannelSecret,
        code_verifier: input.codeVerifier,
      }),
      'LineLoginToken',
    )) as { access_token?: unknown; id_token?: unknown };
    if (typeof token.access_token !== 'string' || typeof token.id_token !== 'string') throw new ChannelSendError('LineLoginTokenBadResponse');
    const verified = (await this.request('/oauth2/v2.1/verify', this.form({ id_token: token.id_token, client_id: this.options.loginChannelId, nonce: input.nonce }), 'LineLoginVerify')) as {
      sub?: unknown;
      aud?: unknown;
      nonce?: unknown;
    };
    if (typeof verified.sub !== 'string' || !LINE_USER_ID.test(verified.sub) || verified.aud !== this.options.loginChannelId || verified.nonce !== input.nonce) {
      throw new ChannelSendError('LineLoginVerifyMismatch');
    }
    const friendship = (await this.request('/friendship/v1/status', { method: 'GET', headers: { authorization: `Bearer ${token.access_token}` } }, 'LineFriendship')) as { friendFlag?: unknown };
    return { userId: verified.sub, friend: friendship.friendFlag === true };
  }

  private bot(path: string, body: unknown, label: string): Promise<unknown> {
    return this.request(path, { method: 'POST', headers: { authorization: `Bearer ${this.options.channelAccessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, label);
  }

  async push(userId: string, text: string): Promise<void> {
    if (!LINE_USER_ID.test(userId)) throw new ChannelSendError('LineBadRecipient', true);
    await this.bot('/v2/bot/message/push', { to: userId, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] }, 'LinePush');
  }

  async reply(replyToken: string, text: string): Promise<void> {
    await this.bot('/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] }, 'LineReply');
  }

  async monthlyUsage(): Promise<LineMonthlyUsage> {
    const headers = { authorization: `Bearer ${this.options.channelAccessToken}` };
    const [quota, consumption] = (await Promise.all([
      this.request('/v2/bot/message/quota', { method: 'GET', headers }, 'LineQuota'),
      this.request('/v2/bot/message/quota/consumption', { method: 'GET', headers }, 'LineQuota'),
    ])) as [{ type?: unknown; value?: unknown }, { totalUsage?: unknown }];
    if (typeof consumption.totalUsage !== 'number') throw new ChannelSendError('LineQuotaBadResponse');
    return { used: consumption.totalUsage, accountLimit: quota.type === 'limited' && typeof quota.value === 'number' ? quota.value : null };
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyLineSignature(this.options.channelSecret, rawBody, headers.get('x-line-signature'));
  }

  parseEvents(rawBody: Uint8Array): LineEvent[] {
    return parseLineEvents(rawBody);
  }
}

export function verifyLineSignature(secret: string, rawBody: Uint8Array, header: string | null): boolean {
  if (!header || !/^[A-Za-z0-9+/]{43}=$/.test(header)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(header, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** `follow` and `unfollow` from one-on-one chats; everything else is ignored. */
export function parseLineEvents(rawBody: Uint8Array): LineEvent[] {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return [];
  }
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  return events.slice(0, 100).map((event): LineEvent => {
    const e = event as { type?: unknown; source?: { type?: unknown; userId?: unknown }; replyToken?: unknown };
    const userId = e.source?.type === 'user' && typeof e.source.userId === 'string' && LINE_USER_ID.test(e.source.userId) ? e.source.userId : null;
    if (!userId) return { kind: 'IGNORED' };
    if (e.type === 'follow') return { kind: 'FOLLOW', userId, replyToken: typeof e.replyToken === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(e.replyToken) ? e.replyToken : null };
    if (e.type === 'unfollow') return { kind: 'UNFOLLOW', userId };
    return { kind: 'IGNORED' };
  });
}
