'use client';

import { TabNav } from '@pactlab/ui';
import { usePathname } from 'next/navigation';

export const DEAL_SECTIONS = [
  { path: '', label: 'Overview' },
  { path: '/sources', label: 'Sources' },
  { path: '/evidence', label: 'Evidence' },
  { path: '/finances', label: 'Finances' },
  { path: '/findings', label: 'Findings' },
  { path: '/valuation', label: 'Valuation' },
  { path: '/documents', label: 'Documents' },
] as const;

/** The section of a deal a path belongs to ('' for the overview). */
export function dealSection(dealId: string, pathname: string): string {
  const base = `/deals/${dealId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return DEAL_SECTIONS.find((section) => section.path !== '' && (rest === section.path || rest.startsWith(`${section.path}/`)))?.path ?? '';
}

/** Tabs across the deal workspace; sub-pages keep their section highlighted. */
export function DealTabs({ dealId }: { dealId: string }) {
  const active = dealSection(dealId, usePathname());
  return (
    <TabNav
      label="Deal sections"
      items={DEAL_SECTIONS.map((section) => ({
        href: `/deals/${dealId}${section.path}`,
        label: section.label,
        active: section.path === active,
      }))}
    />
  );
}
