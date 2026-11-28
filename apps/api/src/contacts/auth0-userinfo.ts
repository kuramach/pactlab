/**
 * The Auth0 / SSO email claim (T-180). Auth0 access tokens for a custom API carry no email by default,
 * so the API asks Auth0's `/userinfo` with the caller's own access token (auth0.com/docs, read
 * 2026-11-27): `GET https://{domain}/userinfo`, `Authorization: Bearer <access token>`; it works because
 * the web requests `audience` with scope `openid profile email` (@auth0/nextjs-auth0 v4's DEFAULT_SCOPES),
 * which makes the token valid for `/userinfo` too. Only `email` and `email_verified` are read.
 */
export interface IdentityEmail {
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface IdentityEmailSource {
  /** The provider's email for this access token, or null (no email, refused, unreachable). */
  email(accessToken: string): Promise<IdentityEmail | null>;
}

export class Auth0UserInfo implements IdentityEmailSource {
  constructor(
    private readonly domain: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('AUTH0_DOMAIN is not a host name');
  }

  async email(accessToken: string): Promise<IdentityEmail | null> {
    try {
      const response = await this.fetcher(`https://${this.domain}/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { email?: unknown; email_verified?: unknown };
      return typeof body.email === 'string' ? { email: body.email, emailVerified: body.email_verified === true } : null;
    } catch {
      return null;
    }
  }
}

/** Tests and local runs: the claims a token would carry, keyed by the token itself. */
export class FixtureIdentityEmails implements IdentityEmailSource {
  constructor(private readonly byToken: Map<string, IdentityEmail> = new Map()) {}

  set(accessToken: string, claim: IdentityEmail): void {
    this.byToken.set(accessToken, claim);
  }

  async email(accessToken: string): Promise<IdentityEmail | null> {
    return this.byToken.get(accessToken) ?? null;
  }
}
