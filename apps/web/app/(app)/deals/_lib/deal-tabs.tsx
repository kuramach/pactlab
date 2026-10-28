'use client';

import { TabNav } from '@pactlab/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface DealSection {
  readonly path: string;
  readonly label: string;
  /** Venture Raise pacts only (T-083). */
  readonly ventureOnly?: boolean;
  /** Seller-led pacts only: the bid process (T-097). */
  readonly sellerLedOnly?: boolean;
}

export interface DealGroup {
  readonly key: 'overview' | 'diligence' | 'valuation' | 'close';
  readonly label: string;
  readonly sections: readonly DealSection[];
}

/**
 * The deal workspace in four tabs (T-094 B13). Every page keeps its URL, so
 * deep links still land; each sits under one tab, at most two clicks from
 * anywhere in the deal. "Said vs observed" is reached from Findings, where
 * its verdicts now show on each finding (B7).
 */
export const DEAL_GROUPS: readonly DealGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    sections: [
      { path: '', label: 'Summary' },
      { path: '/bidders', label: 'Bidders', sellerLedOnly: true },
      { path: '/screening', label: 'Screening' },
      { path: '/team', label: 'Team' },
    ],
  },
  {
    key: 'diligence',
    label: 'Diligence',
    sections: [
      { path: '/documents', label: 'Documents' },
      { path: '/findings', label: 'Findings' },
      { path: '/sources', label: 'Sources' },
      { path: '/evidence', label: 'Evidence' },
      { path: '/finances', label: 'Finances' },
      { path: '/engineering', label: 'Engineering' },
      { path: '/claims', label: 'Seller statements' },
    ],
  },
  {
    key: 'valuation',
    label: 'Valuation',
    sections: [
      { path: '/raise', label: 'Raise', ventureOnly: true },
      { path: '/valuation', label: 'Scenarios and bridge' },
      { path: '/foresight', label: 'Foresight' },
    ],
  },
  { key: 'close', label: 'Close', sections: [{ path: '/post-close', label: 'Post-close' }] },
];

/** Every section, flattened; kept for callers that only need the paths. */
export const DEAL_SECTIONS: readonly DealSection[] = DEAL_GROUPS.flatMap((group) => group.sections);

/** The section of a deal a path belongs to ('' for the overview). */
export function dealSection(dealId: string, pathname: string): string {
  const base = `/deals/${dealId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return DEAL_SECTIONS.find((section) => section.path !== '' && (rest === section.path || rest.startsWith(`${section.path}/`)))?.path ?? '';
}

/** The tab a section sits under. */
export function dealGroup(section: string): DealGroup {
  return DEAL_GROUPS.find((group) => group.sections.some((entry) => entry.path === section)) ?? (DEAL_GROUPS[0] as DealGroup);
}

const visible = (sections: readonly DealSection[], venture: boolean, sellerLed = false) =>
  sections.filter((section) => (venture || !section.ventureOnly) && (sellerLed || !section.sellerLedOnly));

/** Four tabs across the deal, and the open tab's sections beneath them; sub-pages keep their section highlighted. */
export function DealTabs({ dealId, venture = false, sellerLed = false }: { dealId: string; venture?: boolean; sellerLed?: boolean }) {
  const active = dealSection(dealId, usePathname());
  const group = dealGroup(active);
  const sections = visible(group.sections, venture, sellerLed);
  return (
    <div className="flex flex-col gap-3">
      <TabNav
        label="Deal sections"
        items={DEAL_GROUPS.map((entry) => ({
          href: `/deals/${dealId}${visible(entry.sections, venture, sellerLed)[0]?.path ?? ''}`,
          label: entry.label,
          active: entry.key === group.key,
        }))}
      />
      {sections.length > 1 ? (
        <nav aria-label={`${group.label} sections`} className="flex flex-wrap gap-2 text-sm">
          {sections.map((section) => (
            <Link
              key={section.path}
              href={`/deals/${dealId}${section.path}`}
              aria-current={section.path === active ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${section.path === active ? 'border-primary bg-muted font-semibold' : 'border-border hover:bg-muted'}`}
            >
              {section.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
