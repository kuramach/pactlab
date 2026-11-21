import { describe, expect, it } from 'vitest';
import type { SecretStore } from '../credentials';
import type { FetchLike } from '../http/cassette';
import { connectionTokens, DOCUMENT_OAUTH_SCOPES, DocumentOAuthError, GoogleDriveOAuth, MicrosoftDriveOAuth, type DocumentOAuthTokens } from './oauth';
import { DocumentSourceError } from './types';

/** Recorded-shape provider responses, keyed by URL prefix; every request is kept for assertions. */
function recorded(routes: Record<string, (body: URLSearchParams) => { status: number; json: unknown }>) {
  const calls: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route) return new Response('{}', { status: 404 });
    const { status, json } = route[1](body);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async get(ref: string) {
    const value = this.values.get(ref);
    if (value === undefined) throw new Error('missing');
    return value;
  }
  async put(ref: string, value: string) {
    this.values.set(ref, value);
  }
  async delete(ref: string) {
    this.values.delete(ref);
  }
}

const NOW = 1_800_000_000_000;

describe('document source sign-in (T-147)', () => {
  it('asks each provider for read-only access only, and nothing more (adding a scope fails this test)', () => {
    expect(DOCUMENT_OAUTH_SCOPES).toEqual({
      'google-drive': ['https://www.googleapis.com/auth/drive.readonly'],
      onedrive: ['Files.Read.All', 'offline_access', 'User.Read'],
    });
    const { fetch } = recorded({});
    const google = new URL(new GoogleDriveOAuth({ clientId: 'g-client', clientSecret: 's', fetch }).authorizeUrl('https://app.example/cb', 'st'));
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(google.searchParams)).toEqual({
      client_id: 'g-client',
      redirect_uri: 'https://app.example/cb',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      state: 'st',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
    });
    const microsoft = new URL(new MicrosoftDriveOAuth({ clientId: 'm-client', clientSecret: 's', fetch }).authorizeUrl('https://app.example/cb', 'st'));
    expect(microsoft.origin + microsoft.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(microsoft.searchParams.get('scope')).toBe('Files.Read.All offline_access User.Read');
    for (const scope of [...DOCUMENT_OAUTH_SCOPES['google-drive'], ...DOCUMENT_OAUTH_SCOPES.onedrive]) expect(scope).not.toMatch(/write|ReadWrite|manage|full|\/drive$/i);
  });

  it('exchanges the code with the client secret on the server, and reads who signed in', async () => {
    const { fetch, calls } = recorded({
      'https://oauth2.googleapis.com/token': () => ({ status: 200, json: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, token_type: 'Bearer' } }),
      'https://www.googleapis.com/drive/v3/about': () => ({ status: 200, json: { user: { emailAddress: 'seller@example.com', displayName: 'Seller', permissionId: 'p-1' } } }),
    });
    const google = new GoogleDriveOAuth({ clientId: 'g', clientSecret: 'secret', fetch, now: () => NOW });
    expect(await google.exchangeCode('code-1', 'https://app.example/cb')).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3_599_000 });
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({ client_id: 'g', client_secret: 'secret', grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'https://app.example/cb' });
    expect(await google.account('at-1')).toEqual({ accountId: 'p-1', accountName: 'seller@example.com' });
    expect(calls[1]?.headers['authorization']).toBe('Bearer at-1');
  });

  it('a refused code or a revoked refresh token is REVOKED; a provider outage is UNAVAILABLE', async () => {
    const google = (status: number, json: unknown) => new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch: recorded({ 'https://oauth2.googleapis.com/token': () => ({ status, json }) }).fetch });
    await expect(google(400, { error: 'invalid_grant' }).refresh('rt')).rejects.toEqual(new DocumentOAuthError('REVOKED'));
    await expect(google(503, { error: 'temporarily_unavailable' }).refresh('rt')).rejects.toEqual(new DocumentOAuthError('UNAVAILABLE'));
  });
});

describe('keeping a connection signed in', () => {
  const ref = 'secretref:org/google-drive/c1';
  const stored = (tokens: DocumentOAuthTokens) => {
    const secrets = new MemorySecrets();
    secrets.values.set(ref, JSON.stringify(tokens));
    return secrets;
  };

  it('uses the stored token while it has more than a minute left; no provider call', async () => {
    const { fetch, calls } = recorded({});
    const tokens = connectionTokens(new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch }), stored({ accessToken: 'at', refreshToken: 'rt', expiresAt: NOW + 120_000 }), ref, () => NOW);
    expect(await tokens()).toBe('at');
    expect(calls).toHaveLength(0);
  });

  it('refreshes an expired token by itself and stores it (Google keeps the refresh token)', async () => {
    const { fetch } = recorded({ 'https://oauth2.googleapis.com/token': () => ({ status: 200, json: { access_token: 'at-2', expires_in: 3599 } }) });
    const secrets = stored({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW - 1 });
    expect(await connectionTokens(new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch, now: () => NOW }), secrets, ref, () => NOW)()).toBe('at-2');
    expect(JSON.parse(secrets.values.get(ref) ?? '{}')).toEqual({ accessToken: 'at-2', refreshToken: 'rt-1', expiresAt: NOW + 3_599_000 });
  });

  it('keeps Microsoft’s replacement refresh token', async () => {
    const { fetch, calls } = recorded({ 'https://login.microsoftonline.com/common/oauth2/v2.0/token': () => ({ status: 200, json: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3599 } }) });
    const secrets = stored({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW - 1 });
    await connectionTokens(new MicrosoftDriveOAuth({ clientId: 'm', clientSecret: 's', fetch, now: () => NOW }), secrets, ref, () => NOW)();
    expect(JSON.parse(secrets.values.get(ref) ?? '{}')).toMatchObject({ refreshToken: 'rt-2' });
    expect(calls[0]?.body.get('scope')).toBe('Files.Read.All offline_access User.Read');
  });

  it('a revoked sign-in is ACCESS (Reconnect needed), never a retry loop; an outage is UNAVAILABLE', async () => {
    const revoked = recorded({ 'https://oauth2.googleapis.com/token': () => ({ status: 400, json: { error: 'invalid_grant' } }) });
    const expired = { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW - 1 };
    await expect(connectionTokens(new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch: revoked.fetch }), stored(expired), ref, () => NOW)()).rejects.toEqual(new DocumentSourceError('ACCESS'));
    expect(revoked.calls).toHaveLength(1);
    const down = recorded({ 'https://oauth2.googleapis.com/token': () => ({ status: 503, json: {} }) });
    await expect(connectionTokens(new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch: down.fetch }), stored(expired), ref, () => NOW)()).rejects.toEqual(new DocumentSourceError('UNAVAILABLE'));
  });

  it('two syncs refreshing at once: the one refused uses the tokens the other stored', async () => {
    const secrets = stored({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW - 1 });
    // The provider rotated rt-1 for the other sync already; this refresh is refused, and the newer tokens are stored.
    const { fetch } = recorded({
      'https://login.microsoftonline.com/common/oauth2/v2.0/token': () => {
        secrets.values.set(ref, JSON.stringify({ accessToken: 'at-other', refreshToken: 'rt-2', expiresAt: NOW + 3_600_000 }));
        return { status: 400, json: { error: 'invalid_grant' } };
      },
    });
    expect(await connectionTokens(new MicrosoftDriveOAuth({ clientId: 'm', clientSecret: 's', fetch }), secrets, ref, () => NOW)()).toBe('at-other');
  });

  it('a connection whose stored credential is gone (disconnected) is ACCESS', async () => {
    const { fetch } = recorded({});
    await expect(connectionTokens(new GoogleDriveOAuth({ clientId: 'g', clientSecret: 's', fetch }), new MemorySecrets(), ref, () => NOW)()).rejects.toEqual(new DocumentSourceError('ACCESS'));
  });
});
