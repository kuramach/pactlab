import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { tokenOrganization } from './auth-flow';
import { serverEnv } from './env';
import { nativeSessionToken } from './native-session';

let client: Auth0Client | null | undefined;

/**
 * Auth0 Regular Web Application client, or null when this deployment has no
 * Auth0 configured (email-code sign-in only). Session lives in an encrypted
 * cookie keyed by AUTH0_SECRET; login, logout and callback are served under
 * /auth/* by the proxy. Built lazily so configuration is validated on first use.
 */
export function auth0(): Auth0Client | null {
  if (client === undefined) {
    const env = serverEnv();
    client =
      env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET && env.AUTH0_SECRET && env.AUTH0_AUDIENCE
        ? new Auth0Client({
            domain: env.AUTH0_DOMAIN,
            clientId: env.AUTH0_CLIENT_ID,
            clientSecret: env.AUTH0_CLIENT_SECRET,
            secret: env.AUTH0_SECRET,
            appBaseUrl: env.APP_BASE_URL,
            authorizationParameters: { audience: env.AUTH0_AUDIENCE },
          })
        : null;
  }
  return client;
}

/** The Auth0 session, or null when signed out of Auth0 or Auth0 is not configured. */
export async function auth0Session() {
  return (await auth0()?.getSession()) ?? null;
}

/**
 * The session's API access token: Auth0 (refreshed when expired) or an
 * email-code session; null when signed out.
 */
async function sessionToken(): Promise<string | null> {
  const client = auth0();
  const session = await auth0Session();
  if (!client || !session) return nativeSessionToken();
  try {
    return (await client.getAccessToken()).token;
  } catch {
    return null;
  }
}

/**
 * Bearer token for Pactlab API calls. Only tokens that carry `org_id` are
 * ever sent; an organization-less session resolves to signed-out.
 */
export async function organizationAccessToken(): Promise<string | null> {
  const token = await sessionToken();
  return token && tokenOrganization(token) ? token : null;
}

/** Bearer token for `GET /v1/me` only, which accepts tokens issued before an organization is picked. */
export async function identityAccessToken(): Promise<string | null> {
  return sessionToken();
}
