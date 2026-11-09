import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthorizeCheckView, ConnectedAppView } from '@pactlab/contracts';
import { oauth, type OAuthScope, type PrismaClient } from '@pactlab/db';
import type { Logger } from '@pactlab/observability';
import { z } from 'zod';
import type { Principal } from '../auth/auth.guard';
import { keyedHash } from '../email-login/client-address';
import { LOGGER, PRISMA } from '../tokens';
import { ACCESS_TOKEN_SECONDS, type McpAccessTokens } from './access-tokens';
import { ClientMetadataError, isAllowedRedirectUri, isClientMetadataUrl, type ClientMetadataFetcher } from './client-metadata';

export const OAUTH = Symbol('OAUTH');

export interface OAuthDependencies {
  readonly accessTokens: McpAccessTokens;
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

export const SUPPORTED_SCOPES: readonly OAuthScope[] = ['mcp:read', 'mcp:confidential'];
const SCOPE_WORDS: Record<OAuthScope, string> = {
  'mcp:read': 'Read your pacts: findings, claims, valuation, Foresight and evidence, with citations. It cannot change anything.',
  'mcp:confidential': 'Also read confidential material your role already allows (confirmed-value ledger, founder-confidential findings).',
};

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

  get issuer(): string {
    return this.deps.accessTokens.issuer;
  }

  private hash(kind: 'code' | 'refresh', value: string): string {
    return keyedHash(this.deps.hashSecret, `oauth-${kind}:${value}`);
  }

  /** RFC 8707: the token is for this MCP server only. Scheme and host compare case-insensitively; no trailing slash. */
  private isOurResource(value: string | undefined): boolean {
    if (value === undefined) return false;
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/$/, '')}` === this.resource && !url.search && !url.hash;
    } catch {
      return false;
    }
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
    if (metadata.grant_types?.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')) {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
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
    if (!this.isOurResource(parsed.data.resource)) return back('invalid_target', `resource must be ${this.resource}.`);
    const scopes = this.scopes(parsed.data.scope);
    if (!scopes) return back('invalid_scope', `Supported scopes: ${SUPPORTED_SCOPES.join(' ')}.`);
    if (principal.issuer !== 'PACTLAB' || !principal.sessionId) return { kind: 'error', message: 'Connecting apps is available for organizations that sign in with Pactlab (email code or passkey).' };
    if (!principal.externalOrganizationId) return { kind: 'choose-organization' };
    if (!(await oauth.mcpEnabled(this.prisma, principal.externalOrganizationId))) {
      return { kind: 'error', message: 'Connecting AI apps isn’t switched on for your organization yet. Ask Pactlab to turn it on.' };
    }
    return {
      kind: 'consent',
      client: { name: client.name, host: new URL(clientId.startsWith('https://') ? clientId : redirectUri).host, verified: client.kind === 'METADATA_DOCUMENT' },
      scopes: scopes.map((scope) => ({ scope, description: SCOPE_WORDS[scope] })),
      redirectHost: new URL(redirectUri).host,
    };
  }

  private scopes(scope: string | undefined): OAuthScope[] | null {
    if (!scope) return ['mcp:read'];
    const requested = [...new Set(scope.split(' ').filter(Boolean))];
    if (requested.some((entry) => !SUPPORTED_SCOPES.includes(entry as OAuthScope))) return null;
    // Confidential material is read material: it always comes with read.
    return [...new Set<OAuthScope>(['mcp:read', ...(requested as OAuthScope[])])];
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
      resource: this.resource,
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
        (resource !== undefined && !this.isOurResource(resource))
      ) {
        throw new OAuthProtocolError('invalid_grant', 'The code is invalid, expired, already used, or does not match this request.');
      }
      return this.tokensFor(record);
    }
    if (grantType === 'refresh_token') {
      const refresh = value('refresh_token');
      if (!refresh || !clientId) throw new OAuthProtocolError('invalid_request', 'refresh_token and client_id are required.');
      const resource = value('resource');
      if (resource !== undefined && !this.isOurResource(resource)) throw new OAuthProtocolError('invalid_target', `resource must be ${this.resource}.`);
      const record = await oauth.useRefresh(this.prisma, this.hash('refresh', refresh));
      if (!record || record.clientId !== clientId) throw new OAuthProtocolError('invalid_grant', 'The refresh token is invalid, expired or already used.');
      return this.tokensFor(record);
    }
    throw new OAuthProtocolError('unsupported_grant_type', 'Supported: authorization_code, refresh_token.');
  }

  private async tokensFor(record: { grantId: string; subject: string; organizationId: string; clientId: string; scopes: OAuthScope[] }) {
    const accessToken = await this.deps.accessTokens.issue({ subject: record.subject, organizationId: record.organizationId, grantId: record.grantId, clientId: record.clientId, scopes: record.scopes });
    const refreshToken = random();
    await oauth.issueRefresh(this.prisma, { grantId: record.grantId, tokenHash: this.hash('refresh', refreshToken), scopes: record.scopes, resource: this.resource });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refreshToken, scope: record.scopes.join(' ') };
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
}
