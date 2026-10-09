import type { Permission } from '@pactlab/domain';

export type NavIcon = 'home' | 'deals' | 'start' | 'audit' | 'controls' | 'settings';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: NavIcon;
  /** Hidden unless the session holds this permission. UI visibility is never authorization. */
  readonly requires?: Permission;
  /** `exact` for the home page; everything else is active on its sub-pages too. */
  readonly match?: 'exact' | 'prefix';
}

export interface NavSection {
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

/** Main menu. Home and My deals are always there, so every page has a way back. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    items: [
      { href: '/', label: 'Home', icon: 'home', match: 'exact' },
      { href: '/deals', label: 'My deals', icon: 'deals' },
      { href: '/pacts/new', label: 'Start a Pact', icon: 'start' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { href: '/audit', label: 'Audit log', icon: 'audit', requires: 'AUDIT_READ' },
      { href: '/settings/controls', label: 'Pilot controls', icon: 'controls', requires: 'ORG_ADMIN' },
    ],
  },
];

export function visibleSections(
  permissions: ReadonlySet<Permission>,
  sections: readonly NavSection[] = NAV_SECTIONS,
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.requires === undefined || permissions.has(item.requires)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Whether a menu entry is the current page (or, for prefix entries, contains it). */
export function isActive(item: Pick<NavItem, 'href' | 'match'>, pathname: string): boolean {
  if (item.match === 'exact' || item.href === '/') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
