import { importPKCS8, SignJWT } from 'jose';
import type { ConnectionScope } from '../contract';
import type { SecretStore } from '../credentials';
import type { FetchLike } from '../http/cassette';
import { GitHubAdapterError } from './types';

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';

/** The credential reference every App-authenticated connection carries: Pactlab's own app key. */
export const GITHUB_APP_CREDENTIAL_REF = 'secretref:pactlab/github-app';

export function githubHeaders(token: string | null): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': 'pactlab',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** Produces a short-lived token able to read one repository. */
export interface GitHubAuth {
  readonly method: 'APP' | 'TOKEN';
  token(scope: ConnectionScope, repository: string): Promise<string>;
}

/** A seller's fine-grained token, read from the secret store on use. */
export class TokenAuth implements GitHubAuth {
  readonly method = 'TOKEN' as const;

  constructor(private readonly secrets: SecretStore) {}

  async token(scope: ConnectionScope): Promise<string> {
    if (!scope.credentialRef) throw new GitHubAdapterError('NO_CREDENTIAL', 'No credential configured');
    try {
      return await this.secrets.get(scope.credentialRef);
    } catch {
      throw new GitHubAdapterError('NO_CREDENTIAL', 'The stored token could not be read');
    }
  }
}

export interface GitHubAppSettings {
  readonly appId: string;
  /** PKCS#8 PEM. GitHub issues PKCS#1 keys; convert once with `openssl pkcs8 -topk8 -nocrypt`. */
  readonly privateKeyPem: string;
}

/**
 * Pactlab's GitHub App. Mints an RS256 JWT (iat 60 s in the past, exp 9 min
 * ahead), finds the installation for the repository and requests an
 * installation token narrowed to that repository with read-only
 * contents and metadata. Tokens are cached in memory until shortly before
 * GitHub's one-hour expiry and never stored.
 */
export class AppAuth implements GitHubAuth {
  readonly method = 'APP' as const;
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly settings: GitHubAppSettings,
    private readonly fetchImpl: FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  private async jwt(): Promise<string> {
    const key = await importPKCS8(this.settings.privateKeyPem, 'RS256');
    const issuedAt = Math.floor(this.now() / 1000) - 60;
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.settings.appId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 9 * 60)
      .sign(key);
  }

  async token(_scope: ConnectionScope, repository: string): Promise<string> {
    const cached = this.cache.get(repository);
    if (cached && cached.expiresAt - 5 * 60_000 > this.now()) return cached.token;
    const jwt = await this.jwt();
    const installation = await this.fetchImpl(`${GITHUB_API}/repos/${repository}/installation`, { headers: githubHeaders(jwt) });
    if (installation.status === 404)
      throw new GitHubAdapterError('NOT_INSTALLED', 'The Pactlab GitHub App is not installed on this repository');
    if (!installation.ok) throw new GitHubAdapterError('NO_CREDENTIAL', 'GitHub refused the app credentials');
    const { id } = (await installation.json()) as { id?: number };
    if (typeof id !== 'number') throw new GitHubAdapterError('NO_CREDENTIAL', 'Unexpected installation response');
    const [, name = ''] = repository.split('/');
    const issued = await this.fetchImpl(`${GITHUB_API}/app/installations/${id}/access_tokens`, {
      method: 'POST',
      headers: { ...githubHeaders(jwt), 'content-type': 'application/json' },
      body: JSON.stringify({ repositories: [name], permissions: { contents: 'read', metadata: 'read' } }),
    });
    if (!issued.ok) throw new GitHubAdapterError('PERMISSION_DENIED', 'The installation cannot read this repository');
    const body = (await issued.json()) as { token?: string; expires_at?: string };
    if (!body.token) throw new GitHubAdapterError('NO_CREDENTIAL', 'Unexpected token response');
    const expiresAt = body.expires_at ? Date.parse(body.expires_at) : this.now() + 60 * 60_000;
    this.cache.set(repository, { token: body.token, expiresAt });
    return body.token;
  }
}
