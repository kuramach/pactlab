import { describe, expect, it } from 'vitest';
import {
  isProtectedPath,
  organizationLoginPath,
  organizationStep,
  proxyDecision,
  safeReturnTo,
  tokenOrganization,
} from './auth-flow';

const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('proxyDecision', () => {
  const base = { search: '', signedIn: false, organizationId: undefined };

  it('redirects a signed-out visit to an app page to login with a return path', () => {
    expect(proxyDecision({ ...base, pathname: '/deals', search: '?stage=open' })).toEqual({
      kind: 'redirect',
      location: '/auth/login?returnTo=%2Fdeals%3Fstage%3Dopen',
    });
  });

  it('matches real URL paths, not route groups', () => {
    expect(isProtectedPath('/metrics/abc')).toBe(true);
    expect(isProtectedPath('/(app)/deals')).toBe(false);
    expect(isProtectedPath('/dealsx')).toBe(false);
  });

  it('lets signed-out visitors see the overview and auth routes', () => {
    expect(proxyDecision({ ...base, pathname: '/' })).toEqual({ kind: 'next' });
    expect(proxyDecision({ ...base, pathname: '/auth/login' })).toEqual({ kind: 'next' });
  });

  it('sends a signed-in session without an organization to the picker', () => {
    expect(proxyDecision({ ...base, signedIn: true, pathname: '/deals' })).toEqual({
      kind: 'redirect',
      location: '/select-organization?returnTo=%2Fdeals',
    });
    expect(proxyDecision({ ...base, signedIn: true, pathname: '/select-organization' })).toEqual({
      kind: 'next',
    });
  });

  it('lets an organization-scoped session through', () => {
    expect(
      proxyDecision({ ...base, signedIn: true, organizationId: 'org_a', pathname: '/deals' }),
    ).toEqual({ kind: 'next' });
  });
});

describe('organization flow', () => {
  it('re-authorizes a single-org user silently and offers a picker for several', () => {
    expect(organizationStep([])).toEqual({ kind: 'none' });
    expect(organizationStep(['a'])).toEqual({ kind: 'single', organization: 'a' });
    expect(organizationStep(['a', 'b'])).toEqual({ kind: 'pick', organizations: ['a', 'b'] });
  });

  it('builds the organization login path', () => {
    expect(organizationLoginPath('org_abc', '/deals')).toBe(
      '/auth/login?organization=org_abc&returnTo=%2Fdeals',
    );
  });

  it('never returns to another origin or an auth route', () => {
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('/auth/logout')).toBe('/');
    expect(safeReturnTo(['/deals'])).toBe('/');
    expect(safeReturnTo('/deals?x=1')).toBe('/deals?x=1');
  });
});

describe('tokenOrganization', () => {
  it('reads org_id from an access token', () => {
    expect(tokenOrganization(jwt({ sub: 'auth0|1', org_id: 'org_a' }))).toBe('org_a');
  });

  it('treats tokens without org_id or malformed tokens as unscoped', () => {
    expect(tokenOrganization(jwt({ sub: 'auth0|1' }))).toBeNull();
    expect(tokenOrganization(jwt({ org_id: '' }))).toBeNull();
    expect(tokenOrganization('not-a-jwt')).toBeNull();
    expect(tokenOrganization('a.%%%.c')).toBeNull();
  });
});
