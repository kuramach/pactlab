import type { Permission } from '@pactlab/domain';

export interface NavItem {
  href: string;
  label: string;
  /** Hidden unless the session holds this permission. UI visibility is never authorization. */
  requires?: Permission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview' },
  { href: '/deals', label: 'Deals', requires: 'DEAL_READ' },
  { href: '/audit', label: 'Audit log', requires: 'AUDIT_READ' },
  { href: '/admin', label: 'Organization', requires: 'ORG_ADMIN' },
  { href: '/design-system', label: 'Design system' },
];

export function visibleNavigation(permissions: ReadonlySet<Permission>, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => item.requires === undefined || permissions.has(item.requires));
}
