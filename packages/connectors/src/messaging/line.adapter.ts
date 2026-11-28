import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChannelSendError, type LineBot, type LineInbound, type LineLoginResult } from './types';

/**
 * LINE (developers.line.biz, read 2026-11-27):
 * - Messaging API: `POST https://api.line.me/v2/bot/message/push` `{ to, messages }` and
 *   `POST https://api.line.me/v2/bot/message/reply` `{ replyToken, messages }`, `Authorization: Bearer <channel
 *   access token>`, at most five message objects. `X-Line-Retry-Key` (a UUID, push only) makes a retry safe: a
 *   duplicate answers 409. The monthly limit answers 429 `You have reached your monthly limit.` Reply messages
 *   are not counted toward the monthly message count; push messages are.
 * - Webhooks: `x-line-signature` is the Base64 HMAC-SHA256 of the raw body with the channel secret. The body is
 *   `{ destination, events: [...] }` (events may be empty); `follow` (added as a friend, or unblocked) and
 *   `message` carry a `replyToken`, `unfollow` (blocked) does not; user IDs match `U[0-9a-f]{32}`.
 * - LINE Login v2.1: `https://access.line.me/oauth2/v2.1/authorize` (`response_type=code`, `client_id`,
 *   `redirect_uri`, `state`, `scope`, `nonce`, `bot_prompt`), `POST https://api.line.me/oauth2/v2.1/token`
 *   (form: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`),
 *   `POST https://api.line.me/oauth2/v2.1/verify` (form: `id_token`, `client_id`, `nonce`; `sub` is the user ID),
 *   `GET https://api.line.me/friendship/v1/status` (the `profile` scope; `friendFlag`). The user ID is the same
 *   in both channels only when they are under the same provider (runbook).
 */
export interface LineOptions {
  readonly channelSecret: string;
  readonly channelAccessToken: string;
  readonly loginChannelId: string;
  readonly loginChannelSecret: string;
  readonly addFriendUrl?: string | null;
  readonly apiBase?: string;
  readonly authBase?: string;
  readonly fetch?: typeof fetch;
}

const USER_ID = /^U[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The add-friend link, only when it is LINE's own (https, line.me or lin.ee). */
export function safeAddFriendUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^(?:[a-z0-9-]+\.)*(?:line\.me|lin\.ee)$/.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export class LineApi implements LineBot {
  readonly name = 'LINE' as const;
  readonly addFriendUrl: string | null;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: LineOptions) {
    if (!/^\d{5,20}$/.test(options.loginChannelId)) throw new Error('LINE_LOGIN_CHANNEL_ID is not a channel id');
    if (options.addFriendUrl && !safeAddFriendUrl(options.addFriendUrl)) throw new Error('LINE_ADD_FRIEND_URL must be an https line.me or lin.ee link');
    this.addFriendUrl = safeAddFriendUrl(options.addFriendUrl);
    this.fetcher = options.fetch ?? fetch;
  }

  private get api(): string {
    return this.options.apiBase ?? 'https://api.line.me';
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, redirect: 'manual' });
    } catch {
      throw new ChannelSendError('LineUnreachable');
    }
  }

  private async message(path: string, body: Record<string, unknown>, retryKey?: string): Promise<void> {
    const response = await this.request(`${this.api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.channelAccessToken}`, ...(retryKey ? { 'x-line-retry-key': retryKey } : {}) },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    // A retry LINE already accepted: sent once, as intended.
    if (response.status === 409 && retryKey) return;
    const json = (await response.json().catch(() => null)) as { message?: unknown } | null;
    // The error message is LINE's own fixed text (never the recipient); only its class is kept.
    if (response.status === 429 && typeof json?.message === 'string' && /monthly limit/i.test(json.message)) throw new ChannelSendError('LineMonthlyLimit');
    throw new ChannelSendError(`Line${response.status}`);
  }

  async push(userId: string, text: string, retryKey: string): Promise<void> {
    if (!USER_ID.test(userId)) throw new ChannelSendError('LineUserIdInvalid');
    if (!UUID.test(retryKey)) throw new ChannelSendError('LineRetryKeyInvalid');
    await this.message('/v2/bot/message/push', { to: userId, messages: [{ type: 'text', text }] }, retryKey.toLowerCase());
  }

  async reply(replyToken: string, text: string): Promise<void> {
    await this.message('/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text }] });
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyLineSignature(this.options.channelSecret, rawBody, headers.get('x-line-signature'));
  }

  parseEvents(rawBody: Uint8Array): LineInbound[] {
    return parseLineEvents(rawBody);
  }

  loginUrl(state: string, nonce: string, redirectUri: string): string {
    return lineLoginUrl(this.options.authBase ?? 'https://access.line.me', this.options.loginChannelId, state, nonce, redirectUri);
  }

  async completeLogin(code: string, redirectUri: string, nonce: string): Promise<LineLoginResult> {
    const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    const token = await this.request(
      `${this.api}/oauth2/v2.1/token`,
      form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.options.loginChannelId, client_secret: this.options.loginChannelSecret }),
    );
    if (!token.ok) throw new ChannelSendError(`LineLoginToken${token.status}`);
    const tokens = (await token.json().catch(() => null)) as { access_token?: unknown; id_token?: unknown; scope?: unknown } | null;
    if (typeof tokens?.access_token !== 'string' || typeof tokens.id_token !== 'string') throw new ChannelSendError('LineLoginNoToken');
    const verified = await this.request(`${this.api}/oauth2/v2.1/verify`, form({ id_token: tokens.id_token, client_id: this.options.loginChannelId, nonce }));
    if (!verified.ok) throw new ChannelSendError(`LineLoginVerify${verified.status}`);
    const claims = (await verified.json().catch(() => null)) as { sub?: unknown; aud?: unknown; nonce?: unknown } | null;
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    // LINE checks the nonce itself; the audience and the nonce are checked again here.
    if (!USER_ID.test(userId) || claims?.aud !== this.options.loginChannelId || claims.nonce !== nonce) throw new ChannelSendError('LineLoginClaims');
    const friendship = await this.request(`${this.api}/friendship/v1/status`, { method: 'GET', headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (!friendship.ok) throw new ChannelSendError(`LineFriendship${friendship.status}`);
    const status = (await friendship.json().catch(() => null)) as { friendFlag?: unknown } | null;
    return { userId, friend: status?.friendFlag === true };
  }
}

/** Shared by the live and fixture adapters. */
export function lineLoginUrl(base: string, channelId: string, state: string, nonce: string, redirectUri: string): string {
  const url = new URL('/oauth2/v2.1/authorize', base);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', channelId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // `profile` is required by the friendship status endpoint; `openid` gives the ID token whose `sub` is the user ID.
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('nonce', nonce);
  // After consent, a screen to add the official account as a friend: push messages reach only friends.
  url.searchParams.set('bot_prompt', 'aggressive');
  return url.toString();
}

export function verifyLineSignature(channelSecret: string, rawBody: Uint8Array, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(createHmac('sha256', channelSecret).update(rawBody).digest('base64'));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type LineEvent = {
  type?: unknown;
  mode?: unknown;
  replyToken?: unknown;
  source?: { type?: unknown; userId?: unknown };
  message?: { type?: unknown; text?: unknown };
};

/** A verified body's events, reduced to follow, unfollow and text, from one-to-one chats only. */
export function parseLineEvents(rawBody: Uint8Array): LineInbound[] {
  let body: { events?: unknown };
  try {
    body = JSON.parse(Buffer.from(rawBody).toString('utf8')) as { events?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(body?.events)) return [];
  return (body.events as LineEvent[]).slice(0, 100).map((event): LineInbound => {
    const userId = event?.source?.type === 'user' && typeof event.source.userId === 'string' && USER_ID.test(event.source.userId) ? event.source.userId : null;
    if (!userId) return { kind: 'IGNORED' };
    // Standby events carry no reply token; a reply is only ever attempted with one.
    const replyToken = event.mode !== 'standby' && typeof event.replyToken === 'string' && event.replyToken.length > 0 ? event.replyToken : null;
    if (event.type === 'follow') return { kind: 'FOLLOW', userId, replyToken };
    if (event.type === 'unfollow') return { kind: 'UNFOLLOW', userId };
    if (event.type === 'message' && event.message?.type === 'text' && typeof event.message.text === 'string') return { kind: 'TEXT', userId, text: event.message.text.slice(0, 200), replyToken };
    return { kind: 'IGNORED' };
  });
}
