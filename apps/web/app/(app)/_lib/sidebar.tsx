'use client';

import { PactlabLockup, cn, fill } from '@pactlab/ui';
import { ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, type NavSection } from '../../../lib/navigation';
import type { Messages } from '../../../lib/i18n';
import { NAV_ICONS } from './nav-icons';

/** Main menu links; shared by the desktop sidebar and the mobile menu. */
/** The shell's words, read on the server and passed down: this file is a client component. */
export type ShellCopy = Messages['shell'];

export function NavLinks({
  copy,
  sections,
  onNavigate,
  tone = 'light',
}: {
  copy: ShellCopy;
  sections: readonly NavSection[];
  onNavigate?: () => void;
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  const pathname = usePathname();
  return (
    <nav aria-label={copy.mainMenu} className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.id ?? 'main'} className="flex flex-col gap-1">
          {section.id ? (
            <span className={cn('px-3 pb-1 text-xs font-bold uppercase tracking-wider', dark ? 'text-white/45' : 'text-muted-foreground')}>
              {copy.sections[section.id]}
            </span>
          ) : null}
          {section.items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                  dark
                    ? active
                      ? 'bg-indigo text-navy shadow-md shadow-indigo/30'
                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                    : active
                      ? 'bg-secondary text-indigo-ink'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {copy.nav[item.icon]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** A branded organization's mark (T-123): its logo, or its name, with "on Pactlab" beneath. */
export interface ShellBrand {
  name: string;
  logoUrl: string | null;
  /** Drawn for a dark background (T-123): no white pill on dark, a navy chip on light. */
  logoLight?: boolean;
}

export function OrgMark({ brand, tone, copy }: { brand: ShellBrand; tone: 'light' | 'dark'; copy: ShellCopy }) {
  const dark = tone === 'dark';
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {brand.logoUrl ? (
        <span className={brand.logoLight ? (dark ? 'inline-flex w-fit' : 'inline-flex w-fit rounded-lg bg-navy px-2 py-1') : dark ? 'inline-flex w-fit rounded-lg bg-white px-2 py-1' : 'inline-flex w-fit'}>
          <img src={brand.logoUrl} alt={brand.name} className="h-8 w-auto max-w-[10rem] object-contain" />
        </span>
      ) : (
        <span className="truncate text-lg font-extrabold tracking-tight">{brand.name}</span>
      )}
      <span className={cn('text-[0.7rem] font-medium', dark ? 'text-white/55' : 'text-muted-foreground')}>{copy.onPactlab}</span>
    </span>
  );
}

/** Left sidebar: logo (always back to Home), main menu, active organization. */
export function Sidebar({ copy, sections, organizationName, brand = null }: { copy: ShellCopy; sections: readonly NavSection[]; organizationName: string | null; brand?: ShellBrand | null }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex h-20 items-center border-b border-white/10 px-5" aria-label={brand ? fill(copy.brandHome, { name: brand.name }) : copy.home}>
        {brand ? <OrgMark brand={brand} tone="dark" copy={copy} /> : <PactlabLockup tone="onDark" />}
      </Link>
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <NavLinks copy={copy} sections={sections} tone="dark" />
      </div>
      {organizationName ? (
        <Link
          href="/select-organization"
          className="m-3 flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-white/55">{copy.organization}</span>
            <span className="truncate font-medium">{organizationName}</span>
          </span>
          <ArrowLeftRight aria-label={copy.switchOrganization} className="h-4 w-4 shrink-0 text-white/60" />
        </Link>
      ) : null}
    </div>
  );
}
