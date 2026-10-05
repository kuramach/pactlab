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
const LOGIN_PATH = '/auth/login';

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
      ? { kind: 'redirect', location: loginPath(returnTo) }
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

/**
 * The `org_id` claim of an access token, read without verification. Used only
 * to decide whether a token may be sent; the API verifies every token.
 */
export function tokenOrganization(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (typeof claims !== 'object' || claims === null) return null;
    const organization = (claims as Record<string, unknown>)['org_id'];
    return typeof organization === 'string' && organization.length > 0 ? organization : null;
  } catch {
    return null;
  }
}
