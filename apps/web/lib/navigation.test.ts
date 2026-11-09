import { describe, expect, it } from 'vitest';
import { permissionsForDealRole, permissionsForOrganizationRole } from '@pactlab/domain';
import { isActive, visibleSections } from './navigation';

const labels = (permissions: Parameters<typeof visibleSections>[0]) =>
  visibleSections(permissions).flatMap((section) => section.items.map((item) => item.label));

describe('main menu', () => {
  it('always offers Home and My deals', () => {
    expect(labels(new Set())).toEqual(['Home', 'My deals', 'Start a Pact', 'Comparables', 'Reports']);
    expect(labels(permissionsForDealRole('TARGET_CONTRIBUTOR'))).toEqual(['Home', 'My deals', 'Start a Pact', 'Comparables', 'Reports']);
  });

  it('shows organization pages to administrators only', () => {
    expect(labels(permissionsForOrganizationRole('ORG_ADMIN'))).toEqual([
      'Home',
      'My deals',
      'Start a Pact',
      'Comparables',
      'Reports',
      'Audit log',
      'Pilot controls',
    ]);
    expect(visibleSections(permissionsForOrganizationRole('MEMBER')).map((section) => section.label)).toEqual([null]);
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
