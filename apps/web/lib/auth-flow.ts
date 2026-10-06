/**
 * Pure sign-in routing rules shared by the proxy and the organization picker.
 * Kept free of SDK and Next.js imports so they can be unit-tested.
 */

/** Real URL prefixes that require a session. Route groups such as `(app)` never appear in URLs. */
export const PROTECTED_PATH_PREFIXES = [
  '/deals',
  '/metrics',
  '/findings',
  '/documents',
  '/valuation',
  '/settings',
  '/audit',
  '/admin',
  '/select-organization',
] as const;

export const SELECT_ORGANIZATION_PATH = '/select-organization';
/** Sign-in chooser: Auth0 / company SSO, or an emailed one-time code. */
export const SIGN_IN_PATH = '/login';
const LOGIN_PATH = '/auth/login';
/** httpOnly cookie holding the API-signed token of an email-code session. */
export const NATIVE_SESSION_COOKIE = 'pactlab_session';

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Same-origin relative path only; anything else falls back to the overview. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value === '/auth' || value.startsWith('/auth/')) return '/';
  return value;
}

export function signInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`;
}

/** Auth0 Universal Login (organizations that sign in through Auth0). */
export function loginPath(returnTo: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`;
}

/** Re-authorize into one organization so the access token carries `org_id`. */
export function organizationLoginPath(auth0OrganizationId: string, returnTo: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({
    organization: auth0OrganizationId,
    returnTo: safeReturnTo(returnTo),
  })}`;
}

export function selectOrganizationPath(returnTo: string): string {
  return `${SELECT_ORGANIZATION_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`;
}

export type ProxyDecision = { kind: 'next' } | { kind: 'redirect'; location: string };

/**
 * Signed-out visits to app paths go to login; signed-in sessions without an
 * organization go to the picker before anything else renders.
 */
export function proxyDecision(input: {
  pathname: string;
  search: string;
  signedIn: boolean;
  organizationId: string | undefined;
}): ProxyDecision {
  const { pathname, search, signedIn, organizationId } = input;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return { kind: 'next' };
  const returnTo = `${pathname}${search}`;
  if (!signedIn) {
    return isProtectedPath(pathname)
      ? { kind: 'redirect', location: signInPath(returnTo) }
      : { kind: 'next' };
  }
  if (!organizationId && pathname !== SELECT_ORGANIZATION_PATH) {
    return { kind: 'redirect', location: selectOrganizationPath(returnTo) };
  }
  return { kind: 'next' };
}

export type OrganizationStep<T> =
  | { kind: 'none' }
  | { kind: 'single'; organization: T }
  | { kind: 'pick'; organizations: readonly T[] };

export function organizationStep<T>(organizations: readonly T[]): OrganizationStep<T> {
  const [only] = organizations;
  if (only === undefined) return { kind: 'none' };
  if (organizations.length === 1) return { kind: 'single', organization: only };
  return { kind: 'pick', organizations };
}

function unverifiedClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The organization claim of an access token (`org_id` for Auth0,
 * `pactlab_org` for email-code sessions), read without verification. Used
 * only to decide whether a token may be sent; the API verifies every token.
 */
export function tokenOrganization(token: string): string | null {
  const claims = unverifiedClaims(token);
  const organization = claims?.['org_id'] ?? claims?.['pactlab_org'];
  return typeof organization === 'string' && organization.length > 0 ? organization : null;
}

/**
 * Routing view of an email-code session cookie, unverified: null when absent
 * or expired. The API re-verifies the token and its server-side session on
 * every call, so this only decides where to send the browser.
 */
export function nativeSessionState(
  token: string | undefined,
  now: Date = new Date(),
): { organizationId: string | undefined } | null {
  if (!token) return null;
  const claims = unverifiedClaims(token);
  const exp = claims?.['exp'];
  if (claims?.['iss'] !== 'pactlab' || typeof exp !== 'number' || exp * 1000 <= now.getTime()) return null;
  return { organizationId: tokenOrganization(token) ?? undefined };
}
