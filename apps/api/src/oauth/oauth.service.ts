import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiAccessView, ApiGrantView, AuthorizeCheckView, ConnectedAppView, DeviceCheckView, Page } from '@pactlab/contracts';
import { decodeCursor, oauth, toPage, type OAuthScope, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { z } from 'zod';
import type { Principal } from '../auth/auth.guard';
import { keyedHash } from '../email-login/client-address';
import { LOGGER, PRISMA } from '../tokens';
import { ACCESS_TOKEN_SECONDS, type ApiAccessTokens, type McpAccessTokens } from './access-tokens';
import { ClientMetadataError, isAllowedRedirectUri, isClientMetadataUrl, type ClientMetadataFetcher } from './client-metadata';

export const OAUTH = Symbol('OAUTH');

export interface OAuthDependencies {
  readonly accessTokens: McpAccessTokens;
  /** The REST API as a second protected resource (T-128). */
  readonly apiTokens: ApiAccessTokens;
  readonly clientMetadata: ClientMetadataFetcher;
  /** Keys code and token hashes; the same secret that signs sessions. */
  readonly hashSecret: string;
}

/** An OAuth error response body (RFC 6749 §5.2 / RFC 7591 §3.2.2), with its status. */
export class OAuthProtocolError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(error);
    this.name = 'OAuthProtocolError';
  }
}

export const SUPPORTED_SCOPES: readonly OAuthScope[] = ['mcp:read', 'mcp:confidential', 'mcp:propose'];
export const API_SCOPES: readonly OAuthScope[] = ['api:read', 'api:write'];
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** RFC 8628 §6.1: consonants only, so a code never spells a word, in two groups of four. */
const USER_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const DEVICE_SECONDS = 10 * 60;
const POLL_SECONDS = 5;
/** A script names itself when it is not a registered client (shown on the approval page as unverified). */
const scriptClientId = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
const SCOPE_WORDS: Record<OAuthScope, string> = {
  'mcp:read': 'Read your pacts: findings, claims, valuation, Foresight and evidence, with citations. It cannot change anything.',
  'mcp:confidential': 'Also read confidential material your role already allows (confirmed-value ledger, founder-confidential findings).',
  'mcp:propose': 'Suggest terms and document requests for you to approve in Pactlab. It can never approve, send or change anything itself.',
  'api:read': 'Read what you can see in Pactlab through the API: pacts, documents, findings, claims, valuation and reports. It cannot change anything.',
  'api:write': 'Also make the changes your role allows through the API, such as uploading documents and drafting findings. Approvals and sign-offs stay in the app.',
};

type Resource = 'mcp' | 'api';

/** Formats what a person typed (any case, spaces or dashes) as a user code, or null. */
export function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length !== 8 || [...letters].some((letter) => !USER_CODE_LETTERS.includes(letter))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

function newUserCode(): string {
  const letters = Array.from({ length: 8 }, () => USER_CODE_LETTERS[randomInt(USER_CODE_LETTERS.length)]).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

const pkce = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
export const authorizeParamsSchema = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().max(2048).optional(),
  scope: z.string().max(200).optional(),
  state: z.string().max(1024).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeParamsSchema>;

const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const random = () => randomBytes(32).toString('base64url');

/**
 * Pactlab's OAuth 2.1 authorization server for its MCP server (T-084, ADR 0024; MCP
 * authorization spec 2026-07-28). Public clients with PKCE S256 only; tokens are bound to the
 * MCP server's canonical URI (RFC 8707); the authorization response carries `iss` (RFC 9207).
 * Clients identify by a Client ID Metadata Document URL, or by Dynamic Client Registration.
 * Grants are made from a Pactlab email-code session, for the organization it is in.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(OAUTH) private readonly deps: OAuthDependencies,
  ) {}

  get resource(): string {
    return this.deps.accessTokens.resource;
  }

  get apiResource(): string {
    return this.deps.apiTokens.resource;
  }

  get issuer(): string {
    return this.deps.accessTokens.issuer;
  }

  private hash(kind: 'code' | 'refresh' | 'device', value: string): string {
    return keyedHash(this.deps.hashSecret, `oauth-${kind}:${value}`);
  }

  /** RFC 8707: which of our resources a token is for. Scheme and host compare case-insensitively; no trailing slash. */
  private resourceOf(value: string | undefined): Resource | null {
    if (value === undefined) return null;
    try {
      const url = new URL(value);
      if (url.search || url.hash) return null;
      const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
      return canonical === this.resource ? 'mcp' : canonical === this.apiResource ? 'api' : null;
    } catch {
      return null;
    }
  }

  private resourceUri(resource: Resource): string {
    return resource === 'mcp' ? this.resource : this.apiResource;
  }

  private async enabled(resource: Resource, organizationId: string): Promise<boolean> {
    return resource === 'mcp' ? oauth.mcpEnabled(this.prisma, organizationId) : oauth.apiEnabled(this.prisma, organizationId);
  }

  // --- Registration (RFC 7591; deprecated in MCP, kept for clients without CIMD) -------------

  async register(body: unknown, ip: string) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new OAuthProtocolError('invalid_client_metadata', 'client_name and redirect_uris are required.');
    const metadata = parsed.data;
    if (!metadata.redirect_uris.every(isAllowedRedirectUri)) throw new OAuthProtocolError('invalid_redirect_uri', 'Redirect URIs must be https, or http on a loopback address.');
    if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported.');
    }
    if (metadata.grant_types?.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token' && grant !== DEVICE_CODE_GRANT)) {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only authorization_code, refresh_token and device_code grants are supported.');
    }
    const clientId = `pl_${randomBytes(18).toString('base64url')}`;
    const stored = await oauth.registerClient(this.prisma, { clientId, clientName: metadata.client_name, redirectUris: metadata.redirect_uris, ipHash: keyedHash(this.deps.hashSecret, `ip:${ip}`) });
    if (!stored) throw new OAuthProtocolError('invalid_client_metadata', 'Too many registrations from this address; try again later.', 429);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: metadata.client_name,
      redirect_uris: metadata.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  /** The client's name and redirect URIs, from its metadata document or its registration. */
  private async client(clientId: string): Promise<{ name: string; redirectUris: readonly string[]; kind: 'METADATA_DOCUMENT' | 'REGISTERED' } | null> {
    if (isClientMetadataUrl(clientId)) {
      try {
        const document = await this.deps.clientMetadata.fetch(clientId);
        return { name: document.clientName, redirectUris: document.redirectUris, kind: 'METADATA_DOCUMENT' };
      } catch (error) {
        this.logger.warn({ reason: error instanceof ClientMetadataError ? error.reason : 'unknown' }, 'client metadata document refused');
        return null;
      }
    }
    const registered = await oauth.client(this.prisma, clientId);
    return registered ? { name: registered.clientName, redirectUris: registered.redirectUris, kind: 'REGISTERED' } : null;
  }

  // --- Authorization (the consent page, as the signed-in person) ------------------------------

  private redirect(redirectUri: string, params: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    url.searchParams.set('iss', this.issuer);
    return url.toString();
  }

  /**
   * What the consent page shows, or why it can't. An unknown client or redirect URI is shown
   * on the page (never redirected to: that would be an open redirect); anything else wrong
   * goes back to the client as an OAuth error.
   */
  async check(principal: Principal, params: unknown): Promise<AuthorizeCheckView> {
    const raw = (params ?? {}) as Record<string, unknown>;
    const clientId = typeof raw['client_id'] === 'string' ? raw['client_id'] : '';
    const redirectUri = typeof raw['redirect_uri'] === 'string' ? raw['redirect_uri'] : '';
    const client = clientId ? await this.client(clientId) : null;
    if (!client) return { kind: 'error', message: 'This app could not be identified, so Pactlab won’t connect it.' };
    if (!client.redirectUris.includes(redirectUri)) return { kind: 'error', message: 'This app asked to return to an address it did not register, so Pactlab won’t connect it.' };
    const state = typeof raw['state'] === 'string' ? raw['state'] : undefined;
    const back = (error: string, description: string) => ({ kind: 'redirect' as const, redirectTo: this.redirect(redirectUri, { error, error_description: description, state }) });
    const parsed = authorizeParamsSchema.safeParse(params);
    if (!parsed.success) return back('invalid_request', 'PKCE (S256), response_type=code and the redirect URI are required.');
    if (parsed.data.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    const resource = this.resourceOf(parsed.data.resource);
    if (!resource) return back('invalid_target', `resource must be ${this.resource} or ${this.apiResource}.`);
    const scopes = this.scopes(resource, parsed.data.scope);
    if (!scopes) return back('invalid_scope', `Supported scopes: ${(resource === 'mcp' ? SUPPORTED_SCOPES : API_SCOPES).join(' ')}.`);
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) return { kind: 'error', message: 'Connecting apps is available for organizations that sign in with Pactlab (email code or passkey).' };
    if (!principal.externalOrganizationId) return { kind: 'choose-organization' };
    if (!(await this.enabled(resource, principal.externalOrganizationId))) return { kind: 'error', message: this.switchedOff(resource) };
    return {
      kind: 'consent',
      resource,
      client: { name: client.name, host: new URL(clientId.startsWith('https://') ? clientId : redirectUri).host, verified: client.kind === 'METADATA_DOCUMENT' },
      scopes: scopes.map((scope) => ({ scope, description: SCOPE_WORDS[scope] })),
      redirectHost: new URL(redirectUri).host,
    };
  }

  private switchedOff(resource: Resource): string {
    return resource === 'mcp'
      ? 'Connecting AI apps isn’t switched on for your organization yet. Ask Pactlab to turn it on.'
      : 'API access is switched off for your organization. An organization owner or admin can turn it on in Settings.';
  }

  /** The scopes asked for, each resource's own only; read always comes with the rest. */
  private scopes(resource: Resource, scope: string | undefined): OAuthScope[] | null {
    const [read, supported] = resource === 'mcp' ? (['mcp:read', SUPPORTED_SCOPES] as const) : (['api:read', API_SCOPES] as const);
    if (!scope) return [read];
    const requested = [...new Set(scope.split(' ').filter(Boolean))];
    if (requested.some((entry) => !supported.includes(entry as OAuthScope))) return null;
    return [...new Set<OAuthScope>([read, ...(requested as OAuthScope[])])];
  }

  /** The person's decision: a redirect back to the client with a code (or access_denied). */
  async decide(principal: Principal, params: unknown, approve: boolean): Promise<{ redirectTo: string }> {
    const checked = await this.check(principal, params);
    const sessionId = principal.sessionId;
    if (checked.kind === 'redirect') return { redirectTo: checked.redirectTo };
    if (checked.kind !== 'consent' || !sessionId) throw new OAuthProtocolError('access_denied', 'This authorization cannot proceed.', 422);
    const request = authorizeParamsSchema.parse(params);
    if (!approve) return { redirectTo: this.redirect(request.redirect_uri, { error: 'access_denied', error_description: 'The request was declined.', state: request.state }) };
    const code = random();
    const grant = await oauth.authorize(this.prisma, {
      sessionId,
      clientId: request.client_id,
      clientName: checked.client.name,
      scopes: checked.scopes.map((entry) => entry.scope),
      codeHash: this.hash('code', code),
      codeChallenge: request.code_challenge,
      redirectUri: request.redirect_uri,
      resource: this.resourceUri(checked.resource),
    });
    if (!grant) throw new OAuthProtocolError('access_denied', 'This authorization cannot proceed.', 422);
    return { redirectTo: this.redirect(request.redirect_uri, { code, state: request.state }) };
  }

  // --- Token endpoint ------------------------------------------------------------------------

  async token(form: Record<string, unknown>) {
    const value = (key: string) => (typeof form[key] === 'string' ? (form[key] as string) : undefined);
    const grantType = value('grant_type');
    const clientId = value('client_id');
    if (grantType === 'authorization_code') {
      const code = value('code');
      const verifier = value('code_verifier');
      if (!code || !clientId || !verifier || !pkce.safeParse(verifier).success) throw new OAuthProtocolError('invalid_request', 'code, client_id and a valid code_verifier are required.');
      const record = await oauth.takeCode(this.prisma, this.hash('code', code));
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const resource = value('resource');
      if (
        !record ||
        record.clientId !== clientId ||
        record.redirectUri !== value('redirect_uri') ||
        record.codeChallenge !== challenge ||
        (resource !== undefined && this.resourceOf(resource) !== this.resourceOf(record.resource))
      ) {
        throw new OAuthProtocolError('invalid_grant', 'The code is invalid, expired, already used, or does not match this request.');
      }
      return this.tokensFor(record);
    }
    if (grantType === 'refresh_token') {
      const refresh = value('refresh_token');
      if (!refresh || !clientId) throw new OAuthProtocolError('invalid_request', 'refresh_token and client_id are required.');
      const resource = value('resource');
      if (resource !== undefined && !this.resourceOf(resource)) throw new OAuthProtocolError('invalid_target', `resource must be ${this.resource} or ${this.apiResource}.`);
      const record = await oauth.useRefresh(this.prisma, this.hash('refresh', refresh));
      if (!record || record.clientId !== clientId) throw new OAuthProtocolError('invalid_grant', 'The refresh token is invalid, expired or already used.');
      if (resource !== undefined && this.resourceOf(resource) !== this.resourceOf(record.resource)) throw new OAuthProtocolError('invalid_target', 'resource does not match this refresh token.');
      return this.tokensFor(record);
    }
    if (grantType === DEVICE_CODE_GRANT) return this.deviceToken(value('device_code'), clientId);
    throw new OAuthProtocolError('unsupported_grant_type', `Supported: authorization_code, refresh_token, ${DEVICE_CODE_GRANT}.`);
  }

  private async tokensFor(record: { grantId: string; subject: string; organizationId: string; clientId: string; scopes: OAuthScope[]; resource: string }) {
    const resource = this.resourceOf(record.resource);
    if (!resource) throw new OAuthProtocolError('invalid_grant', 'This grant is for a resource Pactlab no longer serves.');
    const issuer = resource === 'mcp' ? this.deps.accessTokens : this.deps.apiTokens;
    const accessToken = await issuer.issue({ subject: record.subject, organizationId: record.organizationId, grantId: record.grantId, clientId: record.clientId, scopes: record.scopes });
    const refreshToken = random();
    await oauth.issueRefresh(this.prisma, { grantId: record.grantId, tokenHash: this.hash('refresh', refreshToken), scopes: record.scopes, resource: this.resourceUri(resource) });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refreshToken, scope: record.scopes.join(' ') };
  }

  // --- Device authorization grant (RFC 8628), for scripts and terminals (T-128) -------------------

  /** Step 1: the script asks for a code. API scopes only; `api:read` unless it asks for more. */
  async deviceAuthorization(form: Record<string, unknown>, ip: string, verificationUri: string) {
    const value = (key: string) => (typeof form[key] === 'string' ? (form[key] as string).trim() : undefined);
    const clientId = value('client_id') ?? '';
    const resource = value('resource');
    if (resource !== undefined && this.resourceOf(resource) !== 'api') throw new OAuthProtocolError('invalid_target', `The device flow is for the API: resource must be ${this.apiResource}.`);
    const scopes = this.scopes('api', value('scope'));
    if (!scopes) throw new OAuthProtocolError('invalid_scope', `Supported scopes: ${API_SCOPES.join(' ')}.`);
    const known = clientId && !scriptClientId.safeParse(clientId).success ? await this.client(clientId) : null;
    if (!known && !scriptClientId.safeParse(clientId).success) {
      throw new OAuthProtocolError('invalid_client', 'client_id must be a registered client, or a name for your script: 3 to 64 lowercase letters, digits, dots, dashes or underscores.', 401);
    }
    const clientName = known?.name ?? (value('client_name') || clientId).slice(0, 120);
    const deviceCode = random();
    let userCode = newUserCode();
    let stored = false;
    // A clash of user codes among the few pending ones is unlikely; a second draw settles it.
    for (let attempt = 0; attempt < 2 && !stored; attempt += 1) {
      if (attempt > 0) userCode = newUserCode();
      if (await oauth.deviceLookup(this.prisma, userCode)) continue;
      const ok = await oauth.deviceStart(this.prisma, { clientId, clientName, scopes, resource: this.apiResource, deviceCodeHash: this.hash('device', deviceCode), userCode, ipHash: keyedHash(this.deps.hashSecret, `ip:${ip}`) });
      if (!ok) throw new OAuthProtocolError('slow_down', 'Too many sign-in codes from this address; try again later.', 429);
      stored = true;
    }
    if (!stored) throw new OAuthProtocolError('temporarily_unavailable', 'Please try again.', 503);
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${userCode}`,
      expires_in: DEVICE_SECONDS,
      interval: POLL_SECONDS,
    };
  }

  /** Step 3: the script polls with its device code (RFC 8628 §3.4–3.5). */
  private async deviceToken(deviceCode: string | undefined, clientId: string | undefined) {
    if (!deviceCode || !clientId) throw new OAuthProtocolError('invalid_request', 'device_code and client_id are required.');
    const polled = await oauth.devicePoll(this.prisma, this.hash('device', deviceCode));
    switch (polled.outcome) {
      case 'APPROVED':
        if (polled.subject.clientId !== clientId) throw new OAuthProtocolError('invalid_grant', 'This device code was issued to another client.');
        return this.tokensFor(polled.subject);
      case 'PENDING':
        throw new OAuthProtocolError('authorization_pending', 'Waiting for you to approve the code in Pactlab.');
      case 'SLOW_DOWN':
        throw new OAuthProtocolError('slow_down', `Poll at most every ${POLL_SECONDS} seconds.`);
      case 'DENIED':
        throw new OAuthProtocolError('access_denied', 'The request was declined.');
      case 'EXPIRED':
        throw new OAuthProtocolError('expired_token', 'The code expired; start again.');
      default:
        throw new OAuthProtocolError('invalid_grant', 'The device code is invalid or already used.');
    }
  }

  /** Step 2, the approval page: what the code asks for, on the signed-in person's organization. */
  async deviceCheck(principal: Principal, input: string): Promise<DeviceCheckView> {
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) return { kind: 'error', message: 'Signing in scripts is available for organizations that sign in with Pactlab (email code or passkey).' };
    if (!principal.externalOrganizationId) return { kind: 'choose-organization' };
    const userCode = normalizeUserCode(input);
    const pending = userCode ? await oauth.deviceLookup(this.prisma, userCode) : null;
    if (!userCode || !pending) return { kind: 'error', message: 'That code isn’t valid or has expired. Check it, or start the sign-in again from your script.' };
    if (!(await oauth.apiEnabled(this.prisma, principal.externalOrganizationId))) return { kind: 'error', message: this.switchedOff('api') };
    return {
      kind: 'consent',
      userCode,
      client: { name: pending.clientName, verified: isClientMetadataUrl(pending.clientId) },
      scopes: pending.scopes.map((scope) => ({ scope, description: SCOPE_WORDS[scope] })),
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  async deviceDecide(principal: Principal, input: string, approve: boolean): Promise<{ outcome: 'approved' | 'declined' }> {
    const checked = await this.deviceCheck(principal, input);
    if (checked.kind !== 'consent' || !principal.sessionId) throw new OAuthProtocolError('DEVICE_CODE_INVALID', checked.kind === 'error' ? checked.message : 'Choose an organization first.', 422);
    const grant = await oauth.deviceDecide(this.prisma, principal.sessionId, checked.userCode, approve);
    if (approve && !grant) throw new OAuthProtocolError('DEVICE_CODE_INVALID', 'This code can no longer be approved. Start the sign-in again from your script.', 422);
    return { outcome: approve ? 'approved' : 'declined' };
  }

  /** RFC 7009: always 200; a refresh token ends its grant, anything else is ignored. */
  async revoke(form: Record<string, unknown>): Promise<void> {
    const token = typeof form['token'] === 'string' ? form['token'] : '';
    if (token) await oauth.revokeRefresh(this.prisma, this.hash('refresh', token));
  }

  // --- Connected apps (Settings) ---------------------------------------------------------------

  private sessionOf(principal: Principal): string {
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) throw new OAuthProtocolError('PACTLAB_SIGN_IN_ONLY', 'Pactlab sign-in only.', 422);
    return principal.sessionId;
  }

  async connectedApps(principal: Principal): Promise<{ apps: ConnectedAppView[] }> {
    const apps = await oauth.connectedApps(this.prisma, this.sessionOf(principal));
    return {
      apps: apps.map((app) => ({
        id: app.id,
        organizationName: app.organizationName,
        clientName: app.clientName,
        clientHost: app.clientId.startsWith('https://') ? new URL(app.clientId).host : null,
        scopes: app.scopes,
        createdAt: app.createdAt.toISOString(),
        lastUsedAt: app.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  async disconnect(principal: Principal, grantId: string): Promise<{ apps: ConnectedAppView[] }> {
    const removed = await oauth.revokeGrant(this.prisma, this.sessionOf(principal), grantId);
    if (!removed) throw new OAuthProtocolError('APP_NOT_FOUND', 'Not one of your connected apps.', 422);
    return this.connectedApps(principal);
  }

  // --- API access for organization admins (T-128) ------------------------------------------------

  /** Whether API access is on, and every member's API grants, a page at a time. */
  async apiAccess(principal: Principal, cursor: string | undefined, limit: number): Promise<ApiAccessView> {
    const session = this.sessionOf(principal);
    const organizationId = await oauth.adminOrganization(this.prisma, session);
    if (!organizationId) throw new OAuthProtocolError('FORBIDDEN', 'Organization owners and admins only.', 403);
    const after = decodeCursor(cursor);
    const { rows, total } = await oauth.organizationApiGrants(this.prisma, session, after && typeof after.key === 'string' ? { createdAt: new Date(after.key), id: after.id } : null, limit + 1);
    const grants: Page<ApiGrantView> = toPage(rows, { limit }, total, (row) => row.createdAt, (row) => ({
      id: row.id,
      personName: row.userName,
      personEmail: row.userEmail,
      clientName: row.clientName,
      clientHost: row.clientId.startsWith('https://') ? new URL(row.clientId).host : null,
      scopes: row.scopes,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
    return { enabled: await oauth.apiEnabled(this.prisma, organizationId), grants };
  }

  async setApiAccess(principal: Principal, enabled: boolean): Promise<{ enabled: boolean }> {
    if (!(await oauth.setApiEnabled(this.prisma, this.sessionOf(principal), enabled))) throw new OAuthProtocolError('FORBIDDEN', 'Organization owners and admins only.', 403);
    return { enabled };
  }

  async revokeMemberGrant(principal: Principal, grantId: string): Promise<{ revoked: true }> {
    if (!(await oauth.adminRevoke(this.prisma, this.sessionOf(principal), grantId))) throw new OAuthProtocolError('APP_NOT_FOUND', 'Not an active grant in your organization.', 422);
    return { revoked: true };
  }
}
