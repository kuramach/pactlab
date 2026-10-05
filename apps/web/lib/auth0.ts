import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { tokenOrganization } from './auth-flow';
import { serverEnv } from './env';

let client: Auth0Client | undefined;

/**
 * Auth0 Regular Web Application client. Session lives in an encrypted cookie
 * keyed by AUTH0_SECRET; login, logout and callback are served under /auth/*
 * by the proxy. Built lazily so configuration is validated on first use.
 */
export function auth0(): Auth0Client {
  if (!client) {
    const env = serverEnv();
    client = new Auth0Client({
      domain: env.AUTH0_DOMAIN,
      clientId: env.AUTH0_CLIENT_ID,
      clientSecret: env.AUTH0_CLIENT_SECRET,
      secret: env.AUTH0_SECRET,
      appBaseUrl: env.APP_BASE_URL,
      authorizationParameters: { audience: env.AUTH0_AUDIENCE },
    });
  }
  return client;
}

/** The session's API access token, refreshed when expired; null when signed out. */
async function sessionToken(): Promise<string | null> {
  const session = await auth0().getSession();
  if (!session) return null;
  try {
    return (await auth0().getAccessToken()).token;
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
