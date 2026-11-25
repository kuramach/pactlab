import type { SecretStore } from '../credentials';
import type { FetchLike } from '../http/cassette';
import { DocumentSourceError } from './types';

/**
 * Signing in to a document source once (T-147, Kumar 2026-11-21): an organization connects its Google
 * Drive or OneDrive / SharePoint with OAuth 2.0 (authorization code), and Pactlab keeps itself connected
 * with the refresh token, so a source never needs a pasted token that dies within the hour.
 *
 * Verified against the providers' documentation (2026-11-21):
 * - Google: `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`; `access_type=offline`
 *   issues a refresh token, which a refresh does not return again; a revoked one is `invalid_grant`.
 *   The account is `drive/v3/about?fields=user(...)`. Scope `drive.file`: only files chosen in the picker.
 * - Microsoft identity platform v2 (`common` tenant): `/oauth2/v2.0/authorize` and `/token`;
 *   `offline_access` issues a refresh token, and a refresh may return a new one, which replaces the old.
 *   The account is Graph `/me` (`User.Read`).
 * Read-only scopes only (ADR 0016); the contract test pins them.
 */
export const DOCUMENT_OAUTH_PROVIDERS = ['google-drive', 'onedrive'] as const;
export type DocumentOAuthProvider = (typeof DOCUMENT_OAUTH_PROVIDERS)[number];

export const DOCUMENT_OAUTH_SCOPES: Readonly<Record<DocumentOAuthProvider, readonly string[]>> = {
  // Only the files a person chooses in Google's picker (Google: non-sensitive; drive.readonly is restricted
  // and would need a yearly security assessment). Kumar, 2026-11-24.
  'google-drive': ['https://www.googleapis.com/auth/drive.file'],
  // Files.Read.All (delegated): what the signed-in person can open, including folders shared from
  // SharePoint; Files.Read alone covers only their own OneDrive. Read-only either way.
  onedrive: ['Files.Read.All', 'offline_access', 'User.Read'],
};

export interface DocumentOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface DocumentOAuthAccount {
  /** The provider's id for the person (Drive permission id, Graph user id). */
  readonly accountId: string;
  /** Shown in the connections list: the person's email or sign-in name. */
  readonly accountName: string;
}

/** Why the provider would not issue a token: the sign-in is gone (reconnect), or the provider is down. */
export class DocumentOAuthError extends Error {
  constructor(readonly reason: 'REVOKED' | 'UNAVAILABLE') {
    super(`Document source sign-in: ${reason}`);
    this.name = 'DocumentOAuthError';
  }
}

export interface DocumentOAuthClient {
  readonly provider: DocumentOAuthProvider;
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<DocumentOAuthTokens>;
  /** A fresh access token; `refreshToken` is the one to keep (the same, or the provider's replacement). */
  refresh(refreshToken: string): Promise<DocumentOAuthTokens>;
  account(accessToken: string): Promise<DocumentOAuthAccount>;
}

interface ClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch: FetchLike;
  readonly now?: () => number;
}

abstract class AuthorizationCodeClient implements DocumentOAuthClient {
  abstract readonly provider: DocumentOAuthProvider;
  protected abstract readonly authorizeEndpoint: string;
  protected abstract readonly tokenEndpoint: string;
  protected abstract readonly extraAuthorize: Readonly<Record<string, string>>;

  constructor(protected readonly config: ClientConfig) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const query = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DOCUMENT_OAUTH_SCOPES[this.provider].join(' '),
      state,
      ...this.extraAuthorize,
    });
    return `${this.authorizeEndpoint}?${query.toString()}`;
  }

  private async token(params: Record<string, string>, keep: string | null): Promise<DocumentOAuthTokens> {
    let response: Response;
    try {
      response = await this.config.fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...params }).toString(),
      });
    } catch {
      throw new DocumentOAuthError('UNAVAILABLE');
    }
    const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!response.ok) throw new DocumentOAuthError(json.error === 'invalid_grant' || response.status === 400 || response.status === 401 ? 'REVOKED' : 'UNAVAILABLE');
    const refreshToken = json.refresh_token ?? keep;
    if (!json.access_token || !refreshToken || !json.expires_in) throw new DocumentOAuthError('REVOKED');
    return { accessToken: json.access_token, refreshToken, expiresAt: (this.config.now ?? Date.now)() + json.expires_in * 1000 };
  }

  exchangeCode(code: string, redirectUri: string): Promise<DocumentOAuthTokens> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, null);
  }

  refresh(refreshToken: string): Promise<DocumentOAuthTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, ...this.refreshScope() }, refreshToken);
  }

  protected refreshScope(): Record<string, string> {
    return {};
  }

  abstract account(accessToken: string): Promise<DocumentOAuthAccount>;

  protected async getJson<T>(url: string, accessToken: string): Promise<T> {
    let response: Response;
    try {
      response = await this.config.fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    } catch {
      throw new DocumentOAuthError('UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) throw new DocumentOAuthError('REVOKED');
    if (!response.ok) throw new DocumentOAuthError('UNAVAILABLE');
    return (await response.json()) as T;
  }
}

export class GoogleDriveOAuth extends AuthorizationCodeClient {
  readonly provider = 'google-drive' as const;
  protected readonly authorizeEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
  protected readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';
  // offline: a refresh token; consent: issued again on a reconnect, not only the first time.
  protected readonly extraAuthorize = { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' };

  async account(accessToken: string): Promise<DocumentOAuthAccount> {
    const about = await this.getJson<{ user?: { emailAddress?: string; displayName?: string; permissionId?: string } }>(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,permissionId)',
      accessToken,
    );
    const user = about.user ?? {};
    return { accountId: user.permissionId ?? '', accountName: user.emailAddress ?? user.displayName ?? 'Google account' };
  }
}

export class MicrosoftDriveOAuth extends AuthorizationCodeClient {
  readonly provider = 'onedrive' as const;
  protected readonly authorizeEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  protected readonly tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  protected readonly extraAuthorize = { response_mode: 'query', prompt: 'select_account' };

  protected override refreshScope(): Record<string, string> {
    return { scope: DOCUMENT_OAUTH_SCOPES.onedrive.join(' ') };
  }

  async account(accessToken: string): Promise<DocumentOAuthAccount> {
    const me = await this.getJson<{ id?: string; userPrincipalName?: string; mail?: string | null; displayName?: string }>(
      'https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail,displayName',
      accessToken,
    );
    return { accountId: me.id ?? '', accountName: me.mail ?? me.userPrincipalName ?? me.displayName ?? 'Microsoft account' };
  }
}

/** Refresh a minute early, so a long sync never starts on a token about to expire. */
const EARLY_MS = 60_000;

/**
 * An organization connection's access tokens, kept fresh: the stored token while it has a minute left,
 * else a refresh, stored back (with Microsoft's replacement refresh token). If the refresh is refused
 * but the stored tokens changed meanwhile (another sync refreshed first), the newer ones are used.
 * A sign-in that is gone is `DocumentSourceError('ACCESS')`: the source shows Reconnect needed.
 */
export function connectionTokens(client: DocumentOAuthClient, secrets: SecretStore, credentialRef: string, now: () => number = Date.now): () => Promise<string> {
  const load = async (): Promise<DocumentOAuthTokens> => {
    try {
      return JSON.parse(await secrets.get(credentialRef)) as DocumentOAuthTokens;
    } catch {
      throw new DocumentSourceError('ACCESS');
    }
  };
  return async () => {
    const stored = await load();
    if (stored.expiresAt - now() > EARLY_MS) return stored.accessToken;
    try {
      const fresh = await client.refresh(stored.refreshToken);
      await secrets.put(credentialRef, JSON.stringify(fresh));
      return fresh.accessToken;
    } catch (error) {
      if (!(error instanceof DocumentOAuthError)) throw error;
      if (error.reason === 'UNAVAILABLE') throw new DocumentSourceError('UNAVAILABLE');
      const again = await load();
      if (again.refreshToken !== stored.refreshToken && again.expiresAt - now() > EARLY_MS) return again.accessToken;
      throw new DocumentSourceError('ACCESS');
    }
  };
}
