import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { plainText, withRateLimit, type RateLimitOptions } from './chat-common';
import { ChannelSendError, type ChatMessage, type TeamsBot, type TeamsConversationRef, type TeamsInbound, type TeamsMember } from './types';

/**
 * Microsoft Teams through Azure Bot Service and the Bot Framework (T-181, ADR 0065), from Microsoft's
 * docs (learn.microsoft.com, read 2026-11-27):
 * - inbound: `Authorization: Bearer <JWT>` signed with a key from the OpenID metadata at
 *   `https://login.botframework.com/v1/.well-known/openidconfiguration` (jwks_uri), issuer
 *   `https://api.botframework.com`, audience the bot's Microsoft App ID, and a `serviceurl` claim equal to
 *   the activity's `serviceUrl` ("Authenticate requests with the Bot Connector API");
 * - outbound: a client-credentials token from `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`,
 *   scope `https://api.botframework.com/.default`, then `POST {serviceUrl}/v3/conversations/{id}/activities`;
 * - the member's email: `GET {serviceUrl}/v3/conversations/{id}/members/{memberId}` (TeamsInfo.getMember);
 * - the personal install arrives as `installationUpdate` (action `add`/`remove`) in a personal conversation,
 *   carrying the conversation reference proactive messages need;
 * - the organization admin's tenant id comes from the `tid` claim of an id token obtained with `openid`.
 */

export interface TeamsBotOptions extends RateLimitOptions {
  readonly appId: string;
  readonly appPassword: string;
  /** The token tenant: `botframework.com` for a multi-tenant bot, else the bot's own tenant id (runbook). */
  readonly tokenTenant?: string;
  readonly fetch?: typeof fetch;
  /** Tests inject the keys; deployed, they come from the Bot Framework's OpenID metadata. */
  readonly keys?: JWTVerifyGetKey;
  readonly openIdMetadataUrl?: string;
  readonly loginBaseUrl?: string;
  /** Hosts a serviceUrl may name (exact, or a suffix starting with a dot). */
  readonly serviceHosts?: readonly string[];
}

const BOT_ISSUER = 'https://api.botframework.com';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where Teams' Bot Connector lives; any other serviceUrl is refused (SSRF) even when its token is valid. */
export const TEAMS_SERVICE_HOSTS = ['smba.trafficmanager.net', '.botframework.com'] as const;

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});

/** A serviceUrl Pactlab may call: https, a Bot Connector host, no credentials or port tricks. Normalized with a trailing slash. */
export function safeServiceUrl(value: unknown, hosts: readonly string[] = TEAMS_SERVICE_HOSTS): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!hosts.some((allowed) => (allowed.startsWith('.') ? host.endsWith(allowed) : host === allowed))) return null;
  return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`;
}

/** An Adaptive Card for one message: the words, and an open-URL or submit button. */
export function teamsCard(message: ChatMessage): unknown {
  const action = message.action;
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [{ type: 'TextBlock', text: message.text, wrap: true }],
    actions:
      action?.kind === 'LINK'
        ? [{ type: 'Action.OpenUrl', title: action.label, url: action.url }]
        : action?.kind === 'CONFIRM'
          ? [{ type: 'Action.Submit', title: action.label, data: { pactlab: 'confirm', token: action.value } }]
          : [],
  };
}

/** Shared by the live and fixture bots: an activity reduced to what Pactlab acts on. Personal chats only. */
export function parseTeamsActivity(activity: unknown, hosts: readonly string[] = TEAMS_SERVICE_HOSTS): TeamsInbound {
  const body = obj(activity);
  const conversation = obj(body['conversation']);
  const from = obj(body['from']);
  const tenantId = str(conversation['tenantId']) ?? str(obj(obj(body['channelData'])['tenant'])['id']);
  const aadObjectId = str(from['aadObjectId']);
  if (body['channelId'] !== 'msteams' || conversation['conversationType'] !== 'personal') return { kind: 'IGNORED' };
  if (!tenantId || !GUID.test(tenantId) || !aadObjectId || !GUID.test(aadObjectId)) return { kind: 'IGNORED' };
  const normalized = { tenantId: tenantId.toLowerCase(), aadObjectId: aadObjectId.toLowerCase() };
  if (body['type'] === 'installationUpdate') {
    if (body['action'] === 'remove') return { kind: 'UNINSTALLED', ...normalized };
    const serviceUrl = safeServiceUrl(body['serviceUrl'], hosts);
    const conversationId = str(conversation['id']);
    const memberId = str(from['id']);
    if (body['action'] !== 'add' || !serviceUrl || !conversationId || conversationId.length > 300 || !memberId || memberId.length > 200) return { kind: 'IGNORED' };
    return { kind: 'INSTALLED', ref: { ...normalized, serviceUrl, conversationId }, memberId };
  }
  if (body['type'] === 'message') {
    const value = obj(body['value']);
    const token = str(value['token']);
    if (value['pactlab'] === 'confirm' && token && /^[A-Za-z0-9_-]{16,64}$/.test(token)) return { kind: 'CONFIRM', ...normalized, value: token };
    if (value['pactlab'] === 'disconnect' || /^\s*(stop|disconnect)\s*$/i.test(str(body['text']) ?? '')) return { kind: 'DISCONNECT', ...normalized };
  }
  return { kind: 'IGNORED' };
}

export class BotFrameworkTeamsBot implements TeamsBot {
  readonly name = 'TEAMS' as const;
  readonly appId: string;
  private readonly fetcher: typeof fetch;
  private keys: JWTVerifyGetKey | null;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly hosts: readonly string[];

  constructor(private readonly options: TeamsBotOptions) {
    if (!GUID.test(options.appId) || !options.appPassword) throw new Error('Teams needs the bot Microsoft App ID (a GUID) and its client secret');
    this.appId = options.appId;
    this.fetcher = options.fetch ?? fetch;
    this.keys = options.keys ?? null;
    this.hosts = options.serviceHosts ?? TEAMS_SERVICE_HOSTS;
  }

  private async signingKeys(): Promise<JWTVerifyGetKey> {
    if (this.keys) return this.keys;
    const response = await this.fetcher(this.options.openIdMetadataUrl ?? 'https://login.botframework.com/v1/.well-known/openidconfiguration', { redirect: 'manual' });
    const jwksUri = str(obj(await response.json().catch(() => null))['jwks_uri']);
    if (!response.ok || !jwksUri || !jwksUri.startsWith('https://login.botframework.com/')) throw new ChannelSendError('TeamsMetadataUnavailable');
    this.keys = createRemoteJWKSet(new URL(jwksUri));
    return this.keys;
  }

  async verifyInbound(authorization: string | null, activity: unknown): Promise<boolean> {
    if (!authorization?.startsWith('Bearer ')) return false;
    try {
      const { payload } = await jwtVerify(authorization.slice(7), await this.signingKeys(), { issuer: BOT_ISSUER, audience: this.appId, algorithms: ['RS256'], clockTolerance: 300 });
      const claimed = str(payload['serviceurl']) ?? str(payload['serviceUrl']);
      const given = str(obj(activity)['serviceUrl']);
      return claimed !== null && given !== null && claimed.replace(/\/+$/, '') === given.replace(/\/+$/, '');
    } catch {
      return false;
    }
  }

  parseActivity(activity: unknown): TeamsInbound {
    return parseTeamsActivity(activity, this.hosts);
  }

  private get login(): string {
    return this.options.loginBaseUrl ?? 'https://login.microsoftonline.com';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const tenant = this.options.tokenTenant ?? 'botframework.com';
    const response = await withRateLimit(
      'Teams',
      () =>
        this.fetcher(`${this.login}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.appId, client_secret: this.options.appPassword, scope: 'https://api.botframework.com/.default' }).toString(),
          redirect: 'manual',
        }),
      this.options,
    );
    const json = obj(await response.json().catch(() => null));
    const value = str(json['access_token']);
    if (!response.ok || !value) throw new ChannelSendError(`TeamsToken${response.status}`);
    const seconds = typeof json['expires_in'] === 'number' ? json['expires_in'] : 3600;
    this.token = { value, expiresAt: Date.now() + Math.max(60, seconds - 120) * 1000 };
    return value;
  }

  private async connector(ref: TeamsConversationRef, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Response> {
    const base = safeServiceUrl(ref.serviceUrl, this.hosts);
    if (!base) throw new ChannelSendError('TeamsServiceUrlRefused');
    const token = await this.accessToken();
    const response = await withRateLimit(
      'Teams',
      () =>
        this.fetcher(new URL(path, base).toString(), {
          method: init.method,
          headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
          ...(init.body ? { body: JSON.stringify(init.body) } : {}),
          redirect: 'manual',
        }),
      this.options,
    );
    // 403 / 404 on a personal conversation: the app was removed for the person, or they left the tenant.
    if (response.status === 403 || response.status === 404) throw new ChannelSendError(`Teams${response.status}`, true);
    if (!response.ok) throw new ChannelSendError(`Teams${response.status}`);
    return response;
  }

  async getMember(ref: TeamsConversationRef, memberId: string): Promise<TeamsMember | null> {
    const response = await this.connector(ref, `v3/conversations/${encodeURIComponent(ref.conversationId)}/members/${encodeURIComponent(memberId)}`, { method: 'GET' });
    const json = obj(await response.json().catch(() => null));
    const aad = str(json['aadObjectId']);
    if (!aad || aad.toLowerCase() !== ref.aadObjectId) return null;
    const email = (str(json['email']) ?? str(json['userPrincipalName']))?.trim().toLowerCase() ?? null;
    return { aadObjectId: ref.aadObjectId, tenantId: ref.tenantId, email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null };
  }

  async send(ref: TeamsConversationRef, message: ChatMessage): Promise<void> {
    await this.connector(ref, `v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`, {
      method: 'POST',
      body: { type: 'message', text: plainText(message), attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: teamsCard(message) }] },
    });
  }

  tenantSignInUrl(state: string, redirectUri: string): string {
    const url = new URL('/organizations/oauth2/v2.0/authorize', this.login);
    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeTenantCode(code: string, redirectUri: string): Promise<{ tenantId: string }> {
    const response = await this.fetcher(`${this.login}/organizations/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: this.appId, client_secret: this.options.appPassword, code, redirect_uri: redirectUri, scope: 'openid' }).toString(),
      redirect: 'manual',
    });
    const idToken = str(obj(await response.json().catch(() => null))['id_token']);
    if (!response.ok || !idToken) throw new ChannelSendError(`TeamsSignIn${response.status}`);
    // Received directly from the token endpoint over TLS (OpenID Connect Core 3.1.3.7): the claims are read, not re-verified.
    const tid = str(decodeJwt(idToken)['tid']);
    if (!tid || !GUID.test(tid)) throw new ChannelSendError('TeamsSignInNoTenant');
    return { tenantId: tid.toLowerCase() };
  }
}
