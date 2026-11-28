import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  ChannelSendError,
  type LineChannel,
  type LineEvent,
  type LineLogin,
  type LineQuota,
} from './types';

/**
 * LINE (T-182, ADR 0069), as documented on developers.line.biz (read 2026-11-28):
 * - Messaging API: `POST https://api.line.me/v2/bot/message/push` and `/reply` with
 *   `Authorization: Bearer <channel access token>`, at most 5 message objects; `X-Line-Retry-Key` (a UUID)
 *   makes a push safe to retry, and a repeat answers 409. The monthly limit answers 429 with the message
 *   "You have reached your monthly limit." Reply messages do not count toward the monthly allowance.
 *   `GET /v2/bot/message/quota` (`type` limited | none, `value`) and `/quota/consumption` (`totalUsage`).
 * - Webhooks: `x-line-signature` is Base64(HMAC-SHA256(channel secret, raw body)). `follow` (added or
 *   unblocked; carries a reply token) and `unfollow` (blocked; no reply token), `source.userId` = `U` + 32 hex.
 * - LINE Login v2.1: `https://access.line.me/oauth2/v2.1/authorize` (code flow, `state`, `nonce`, PKCE S256,
 *   `bot_prompt=aggressive` opens the add-friend screen after consent); `POST /oauth2/v2.1/token`
 *   (form-encoded, `code_verifier`); `POST /oauth2/v2.1/verify` checks the ID token and returns `sub`;
 *   `GET /friendship/v1/status` (needs the `profile` scope) returns `friendFlag`.
 * The Login channel must be linked to the official account and sit under the same provider, so the
 * user id from Login is the one the Messaging API knows. Ids and tokens are personal or credential
 * data: never logged, never in an error (errors carry a status class only).
 */
export interface LineApiOptions {
  /** Messaging API channel: long-lived channel access token and channel secret. */
  readonly channelAccessToken: string;
  readonly channelSecret: string;
  /** LINE Login channel, linked to the official account. */
  readonly loginChannelId: string;
  readonly loginChannelSecret: string;
  /** The official account's add-friend link, copied from LINE Official Account Manager. */
  readonly addFriendUrl: string;
  readonly apiBase?: string;
  readonly authBase?: string;
  readonly fetch?: typeof fetch;
}

export const LINE_USER_ID = /^U[0-9a-f]{32}$/;
/** The errorClass of a push LINE refused because the month's message allowance is used up. */
export const LINE_MONTHLY_LIMIT = 'LineMonthlyLimit';

/** PKCE S256: Base64URL(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Shared by the live and fixture channels: Base64(HMAC-SHA256(secret, raw body)), compared in constant time. */
export function verifyLineSignature(
  secret: string,
  rawBody: Uint8Array,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('base64'));
  const actual = Buffer.from(signature.trim());
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Shared by the live and fixture channels: the webhook's events reduced to FOLLOW, UNFOLLOW or IGNORED. */
export function parseLineEvents(rawBody: Uint8Array): LineEvent[] {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return [];
  }
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  return events.slice(0, 100).map((raw): LineEvent => {
    const event = raw as {
      type?: unknown;
      source?: { type?: unknown; userId?: unknown };
      replyToken?: unknown;
      mode?: unknown;
    };
    const userId =
      event.source?.type === 'user' &&
      typeof event.source.userId === 'string' &&
      LINE_USER_ID.test(event.source.userId)
        ? event.source.userId
        : null;
    // A follow without a user id: the person did not consent to profile access; nothing can be linked.
    if (!userId) return { kind: 'IGNORED' };
    if (event.type === 'unfollow') return { kind: 'UNFOLLOW', userId };
    if (event.type === 'follow') {
      // In standby mode there is no reply token.
      const replyToken =
        event.mode !== 'standby' &&
        typeof event.replyToken === 'string' &&
        event.replyToken.length <= 256
          ? event.replyToken
          : null;
      return { kind: 'FOLLOW', userId, replyToken };
    }
    return { kind: 'IGNORED' };
  });
}

/** One text message object: LINE allows 5,000 characters. */
const text = (value: string) => ({ type: 'text', text: value.slice(0, 5000) });

export class LineApi implements LineChannel {
  readonly name = 'LINE' as const;
  readonly addFriendUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly api: string;
  private readonly auth: string;

  constructor(private readonly options: LineApiOptions) {
    if (!/^\d{1,20}$/.test(options.loginChannelId))
      throw new Error('LINE_LOGIN_CHANNEL_ID must be the numeric channel id');
    if (!options.addFriendUrl.startsWith('https://'))
      throw new Error('LINE_ADD_FRIEND_URL must be https');
    this.addFriendUrl = options.addFriendUrl;
    this.fetcher = options.fetch ?? fetch;
    this.api = options.apiBase ?? 'https://api.line.me';
    this.auth = options.authBase ?? 'https://access.line.me';
  }

  private async request(
    path: string,
    init: {
      method: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      form?: Record<string, string>;
    },
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    let body = init.body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.api}${path}`, {
        method: init.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: 'manual',
      });
    } catch {
      throw new ChannelSendError('LineUnreachable');
    }
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  private bot(path: string, payload: unknown, extra: Record<string, string> = {}) {
    return this.request(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.channelAccessToken}`,
        'content-type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(payload),
    });
  }

  authorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
    locale?: string | null;
  }): string {
    const url = new URL('/oauth2/v2.1/authorize', this.auth);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.loginChannelId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    // `profile` for the friendship status; `openid` for the ID token whose `sub` is the user id.
    url.searchParams.set('scope', 'profile openid');
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('bot_prompt', 'aggressive');
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (input.locale) url.searchParams.set('ui_locales', input.locale);
    return url.toString();
  }

  async completeLogin(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<LineLogin> {
    const token = await this.request('/oauth2/v2.1/token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.options.loginChannelId,
        client_secret: this.options.loginChannelSecret,
        code_verifier: input.codeVerifier,
      },
    });
    const tokens = token.json as { access_token?: unknown; id_token?: unknown } | null;
    if (
      token.status !== 200 ||
      typeof tokens?.access_token !== 'string' ||
      typeof tokens.id_token !== 'string'
    )
      throw new ChannelSendError(`LineToken${token.status}`);
    const verified = await this.request('/oauth2/v2.1/verify', {
      method: 'POST',
      form: {
        id_token: tokens.id_token,
        client_id: this.options.loginChannelId,
        nonce: input.nonce,
      },
    });
    const claims = verified.json as {
      iss?: unknown;
      sub?: unknown;
      aud?: unknown;
      nonce?: unknown;
    } | null;
    if (
      verified.status !== 200 ||
      claims?.iss !== 'https://access.line.me' ||
      claims.aud !== this.options.loginChannelId ||
      claims.nonce !== input.nonce ||
      typeof claims.sub !== 'string' ||
      !LINE_USER_ID.test(claims.sub)
    ) {
      throw new ChannelSendError(`LineIdToken${verified.status}`);
    }
    const friendship = await this.request('/friendship/v1/status', {
      method: 'GET',
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const flag = (friendship.json as { friendFlag?: unknown } | null)?.friendFlag;
    if (friendship.status !== 200 || typeof flag !== 'boolean')
      throw new ChannelSendError(`LineFriendship${friendship.status}`);
    return { userId: claims.sub, isFriend: flag };
  }

  async push(userId: string, message: string, retryKey: string): Promise<void> {
    if (!LINE_USER_ID.test(userId)) throw new ChannelSendError('LineBadRecipient');
    const result = await this.bot(
      '/v2/bot/message/push',
      { to: userId, messages: [text(message)] },
      { 'x-line-retry-key': retryKey },
    );
    // 409: this retry key was already accepted, so the message went out once.
    if (result.status === 200 || result.status === 409) return;
    const said = (result.json as { message?: unknown } | null)?.message;
    if (result.status === 429 && typeof said === 'string' && /monthly limit/i.test(said))
      throw new ChannelSendError(LINE_MONTHLY_LIMIT);
    throw new ChannelSendError(`Line${result.status}`);
  }

  async reply(replyToken: string, message: string): Promise<void> {
    const result = await this.bot('/v2/bot/message/reply', {
      replyToken,
      messages: [text(message)],
    });
    if (result.status !== 200) throw new ChannelSendError(`LineReply${result.status}`);
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyLineSignature(
      this.options.channelSecret,
      rawBody,
      headers.get('x-line-signature'),
    );
  }

  parseEvents(rawBody: Uint8Array): LineEvent[] {
    return parseLineEvents(rawBody);
  }

  async quota(): Promise<LineQuota> {
    const auth = { authorization: `Bearer ${this.options.channelAccessToken}` };
    const [limit, used] = await Promise.all([
      this.request('/v2/bot/message/quota', { method: 'GET', headers: auth }),
      this.request('/v2/bot/message/quota/consumption', { method: 'GET', headers: auth }),
    ]);
    const quota = limit.json as { type?: unknown; value?: unknown } | null;
    const usage = (used.json as { totalUsage?: unknown } | null)?.totalUsage;
    if (limit.status !== 200 || used.status !== 200 || typeof usage !== 'number')
      throw new ChannelSendError(`LineQuota${limit.status}`);
    return {
      limit: quota?.type === 'limited' && typeof quota.value === 'number' ? quota.value : null,
      used: usage,
    };
  }
}
