'use client';

import { TabNav } from '@pactlab/ui';
import { usePathname } from 'next/navigation';

export const DEAL_SECTIONS = [
  { path: '', label: 'Overview' },
  { path: '/screening', label: 'Screening' },
  // Venture Raise pacts only (T-083): the round, competing offers and the investor view.
  { path: '/raise', label: 'Raise' },
  { path: '/sources', label: 'Sources' },
  { path: '/evidence', label: 'Evidence' },
  { path: '/finances', label: 'Finances' },
  { path: '/findings', label: 'Findings' },
  { path: '/claims', label: 'Said vs observed' },
  { path: '/engineering', label: 'Engineering' },
  { path: '/valuation', label: 'Valuation' },
  { path: '/foresight', label: 'Foresight' },
  { path: '/documents', label: 'Documents' },
  { path: '/post-close', label: 'Post-close' },
  { path: '/team', label: 'Team' },
] as const;

/** The section of a deal a path belongs to ('' for the overview). */
export function dealSection(dealId: string, pathname: string): string {
  const base = `/deals/${dealId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return DEAL_SECTIONS.find((section) => section.path !== '' && (rest === section.path || rest.startsWith(`${section.path}/`)))?.path ?? '';
}

/** Tabs across the deal workspace; sub-pages keep their section highlighted. The Raise tab shows on Venture Raise pacts only. */
export function DealTabs({ dealId, venture = false }: { dealId: string; venture?: boolean }) {
  const active = dealSection(dealId, usePathname());
  return (
    <TabNav
      label="Deal sections"
      items={DEAL_SECTIONS.filter((section) => venture || section.path !== '/raise').map((section) => ({
        href: `/deals/${dealId}${section.path}`,
        label: section.label,
        active: section.path === active,
      }))}
    />
  );
}
