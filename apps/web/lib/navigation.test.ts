import { describe, expect, it } from 'vitest';
import { permissionsForDealRole, permissionsForOrganizationRole } from '@pactlab/domain';
import { isActive, visibleSections } from './navigation';

const icons = (permissions: Parameters<typeof visibleSections>[0]) =>
  visibleSections(permissions).flatMap((section) => section.items.map((item) => item.icon));

describe('main menu', () => {
  it('always offers Home and My deals', () => {
    expect(icons(new Set())).toEqual(['home', 'deals', 'start', 'comparables', 'reports', 'api', 'claude']);
    expect(icons(permissionsForDealRole('TARGET_CONTRIBUTOR'))).toEqual(['home', 'deals', 'start', 'comparables', 'reports', 'api', 'claude']);
  });

  it('shows organization pages to administrators only', () => {
    expect(icons(permissionsForOrganizationRole('ORG_ADMIN'))).toEqual([
      'home',
      'deals',
      'start',
      'comparables',
      'reports',
      'audit',
      'controls',
      'api',
      'claude',
    ]);
    expect(visibleSections(permissionsForOrganizationRole('MEMBER')).map((section) => section.id)).toEqual([null, 'developers']);
  });

  it('offers the Developers pages to members, not to guests on another organization’s pacts (T-128)', () => {
    const member = permissionsForOrganizationRole('MEMBER');
    expect(visibleSections(member).find((section) => section.id === 'developers')?.items.map((item) => item.href)).toEqual(['/developers/api', '/developers/mcp']);
    expect(visibleSections(member, undefined, true).some((section) => section.id === 'developers')).toBe(false);
  });

  it('shows the admin console to platform operators only', () => {
    const owner = permissionsForOrganizationRole('ORG_OWNER');
    const items = (operator: boolean) => visibleSections(owner, undefined, false, operator).flatMap((section) => section.items.map((item) => item.href));
    expect(items(false)).not.toContain('/admin');
    expect(items(true)).toContain('/admin');
  });

  it('marks the current entry, including pages inside a deal', () => {
    expect(isActive({ href: '/', match: 'exact' }, '/')).toBe(true);
    expect(isActive({ href: '/', match: 'exact' }, '/deals')).toBe(false);
    expect(isActive({ href: '/deals' }, '/deals/abc/sources')).toBe(true);
    expect(isActive({ href: '/deals' }, '/dealsx')).toBe(false);
  });
});
