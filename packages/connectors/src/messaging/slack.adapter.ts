import { createHmac, timingSafeEqual } from 'node:crypto';
import { plainText, withRateLimit, type RateLimitOptions } from './chat-common';
import { ChannelSendError, type ChatMessage, type SlackApp, type SlackInbound, type SlackInstall } from './types';

/**
 * Slack (T-181, ADR 0065), from Slack's developer docs (docs.slack.dev, read 2026-11-27):
 * - install: OAuth v2, `https://slack.com/oauth/v2/authorize?client_id&scope&redirect_uri&state`, then
 *   `oauth.v2.access` (client id, secret, code, redirect URI) gives `access_token` (the bot token) and `team`;
 * - Web API: `https://slack.com/api/<method>`, `Authorization: Bearer <bot token>`, form-encoded, answers
 *   `{ ok, error }`; `429` with `Retry-After` on a rate limit;
 * - inbound requests are signed: `X-Slack-Signature: v0=<hex HMAC-SHA256 of "v0:<X-Slack-Request-Timestamp>:<body>">`
 *   with the signing secret; a timestamp more than five minutes off is refused (replay);
 * - Events API: `url_verification` (echo the challenge), `event_callback` with `app_uninstalled`,
 *   `tokens_revoked` and `app_home_opened`; interactivity posts `payload=<json>` (`block_actions`).
 */

/** Least privilege (ADR 0065): send DMs, open DMs, look a member up by their email. Nothing that reads messages. */
export const SLACK_BOT_SCOPES = ['chat:write', 'im:write', 'users:read', 'users:read.email'] as const;

export const SLACK_ACTIONS = { OPEN: 'pactlab_open', CONFIRM: 'pactlab_confirm', DISCONNECT: 'pactlab_disconnect' } as const;

export interface SlackAppOptions extends RateLimitOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signingSecret: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

const ID = /^[A-Z0-9]{2,32}$/;

/** Block Kit for one message: a section with the words, and the one button. */
export function slackBlocks(message: ChatMessage): unknown[] {
  const blocks: unknown[] = [{ type: 'section', text: { type: 'plain_text', text: message.text, emoji: false } }];
  const action = message.action;
  if (action?.kind === 'LINK') blocks.push({ type: 'actions', elements: [{ type: 'button', action_id: SLACK_ACTIONS.OPEN, text: { type: 'plain_text', text: action.label }, url: action.url, style: 'primary' }] });
  if (action?.kind === 'CONFIRM') blocks.push({ type: 'actions', elements: [{ type: 'button', action_id: SLACK_ACTIONS.CONFIRM, text: { type: 'plain_text', text: action.label }, value: action.value, style: 'primary' }] });
  return blocks;
}

/** The app home: what Pactlab does here, and Disconnect when the member is linked. Content-free. */
export function slackHome(linked: boolean): unknown {
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Pactlab' } },
    { type: 'section', text: { type: 'plain_text', text: 'Test the pact before you sign it. Pactlab messages you here when a pact needs you, with no deal details.' } },
  ];
  blocks.push(
    linked
      ? { type: 'actions', elements: [{ type: 'button', action_id: SLACK_ACTIONS.DISCONNECT, text: { type: 'plain_text', text: 'Disconnect' }, style: 'danger' }] }
      : { type: 'section', text: { type: 'plain_text', text: 'Not connected. Open Your profile in Pactlab and choose Connect Slack.' } },
  );
  return { type: 'home', blocks };
}

export function verifySlackSignature(signingSecret: string, rawBody: Uint8Array, headers: Headers, now = new Date()): boolean {
  const timestamp = headers.get('x-slack-request-timestamp') ?? '';
  const signature = headers.get('x-slack-signature') ?? '';
  if (!/^\d{1,12}$/.test(timestamp) || !/^v0=[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(rawBody).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});

/** Shared by the live and fixture apps: an inbound body reduced to what Pactlab acts on. */
export function parseSlackInbound(rawBody: Uint8Array, contentType: string | null): SlackInbound {
  const text = Buffer.from(rawBody).toString('utf8');
  let body: Json;
  try {
    body = (contentType ?? '').includes('application/x-www-form-urlencoded') ? obj(JSON.parse(new URLSearchParams(text).get('payload') ?? 'null')) : obj(JSON.parse(text));
  } catch {
    return { kind: 'IGNORED' };
  }
  if (body['type'] === 'url_verification') {
    const challenge = str(body['challenge']);
    return challenge && challenge.length <= 256 ? { kind: 'URL_VERIFICATION', challenge } : { kind: 'IGNORED' };
  }
  if (body['type'] === 'event_callback') {
    const teamId = str(body['team_id']);
    const event = obj(body['event']);
    if (!teamId || !ID.test(teamId)) return { kind: 'IGNORED' };
    if (event['type'] === 'app_uninstalled') return { kind: 'UNINSTALLED', teamId };
    if (event['type'] === 'tokens_revoked') {
      // Only the bot token matters: user tokens are never requested.
      const bot = obj(event['tokens'])['bot'];
      return Array.isArray(bot) && bot.length > 0 ? { kind: 'TOKENS_REVOKED', teamId } : { kind: 'IGNORED' };
    }
    const userId = str(event['user']);
    if (event['type'] === 'app_home_opened' && event['tab'] === 'home' && userId && ID.test(userId)) return { kind: 'HOME_OPENED', teamId, userId };
    return { kind: 'IGNORED' };
  }
  if (body['type'] === 'block_actions') {
    const teamId = str(obj(body['team'])['id']);
    const userId = str(obj(body['user'])['id']);
    const actions = Array.isArray(body['actions']) ? (body['actions'] as unknown[]) : [];
    const action = obj(actions[0]);
    if (!teamId || !userId || !ID.test(teamId) || !ID.test(userId)) return { kind: 'IGNORED' };
    const value = str(action['value']);
    if (action['action_id'] === SLACK_ACTIONS.CONFIRM && value && /^[A-Za-z0-9_-]{16,64}$/.test(value)) return { kind: 'CONFIRM', teamId, userId, value };
    if (action['action_id'] === SLACK_ACTIONS.DISCONNECT) return { kind: 'DISCONNECT', teamId, userId };
  }
  return { kind: 'IGNORED' };
}

/** Errors that mean the member can no longer be messaged (they left or were deactivated). */
const RECIPIENT_GONE = new Set(['user_not_found', 'user_disabled', 'cannot_dm_bot', 'user_not_visible']);

export class SlackWebApi implements SlackApp {
  readonly name = 'SLACK' as const;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SlackAppOptions) {
    if (!options.clientId || !options.clientSecret || !options.signingSecret) throw new Error('Slack needs a client id, client secret and signing secret');
    this.fetcher = options.fetch ?? fetch;
  }

  private get base(): string {
    return this.options.baseUrl ?? 'https://slack.com';
  }

  private async call(method: string, params: Record<string, string>, token?: string): Promise<Json> {
    const response = await withRateLimit(
      'Slack',
      () =>
        this.fetcher(`${this.base}/api/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: new URLSearchParams(params).toString(),
          redirect: 'manual',
        }),
      this.options,
    );
    const json = obj(await response.json().catch(() => null));
    if (!response.ok) throw new ChannelSendError(`Slack${response.status}`);
    if (json['ok'] !== true) {
      // The error string is Slack's own code (never a quote of a message); bounded before it is kept.
      const code = (str(json['error']) ?? 'unknown').replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'unknown';
      throw new ChannelSendError(`Slack_${code}`, RECIPIENT_GONE.has(code));
    }
    return json;
  }

  installUrl(state: string, redirectUri: string): string {
    const url = new URL('/oauth/v2/authorize', this.base);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<SlackInstall> {
    const json = await this.call('oauth.v2.access', { client_id: this.options.clientId, client_secret: this.options.clientSecret, code, redirect_uri: redirectUri });
    const team = obj(json['team']);
    const teamId = str(team['id']);
    const botToken = str(json['access_token']);
    const granted = (str(json['scope']) ?? '').split(',');
    if (!teamId || !ID.test(teamId) || !botToken?.startsWith('xoxb-')) throw new ChannelSendError('SlackInstallInvalid');
    // A workspace that granted less than Pactlab needs is refused rather than half-installed.
    if (!SLACK_BOT_SCOPES.every((scope) => granted.includes(scope))) throw new ChannelSendError('SlackScopesMissing');
    return { teamId, teamName: (str(team['name']) ?? '').slice(0, 120), botToken };
  }

  async revoke(botToken: string): Promise<void> {
    await this.call('auth.revoke', {}, botToken);
  }

  async lookupUserByEmail(botToken: string, email: string): Promise<string | null> {
    try {
      const json = await this.call('users.lookupByEmail', { email }, botToken);
      const id = str(obj(json['user'])['id']);
      return id && ID.test(id) ? id : null;
    } catch (error) {
      if (error instanceof ChannelSendError && error.errorClass === 'Slack_users_not_found') return null;
      throw error;
    }
  }

  async sendDirect(botToken: string, userId: string, message: ChatMessage): Promise<void> {
    const opened = await this.call('conversations.open', { users: userId }, botToken);
    const channel = str(obj(opened['channel'])['id']);
    if (!channel || !/^D[A-Z0-9]{2,32}$/.test(channel)) throw new ChannelSendError('SlackNotDirect');
    await this.call('chat.postMessage', { channel, text: plainText(message), blocks: JSON.stringify(slackBlocks(message)), unfurl_links: 'false', unfurl_media: 'false' }, botToken);
  }

  async publishHome(botToken: string, userId: string, linked: boolean): Promise<void> {
    await this.call('views.publish', { user_id: userId, view: JSON.stringify(slackHome(linked)) }, botToken);
  }

  verifyRequest(rawBody: Uint8Array, headers: Headers, now?: Date): boolean {
    return verifySlackSignature(this.options.signingSecret, rawBody, headers, now);
  }

  parseInbound(rawBody: Uint8Array, contentType: string | null): SlackInbound {
    return parseSlackInbound(rawBody, contentType);
  }
}
