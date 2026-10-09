'use client';

import { PactlabLogo, cn } from '@pactlab/ui';
import { ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, type NavSection } from '../../../lib/navigation';
import { NAV_ICONS } from './nav-icons';

/** Main menu links; shared by the desktop sidebar and the mobile menu. */
export function NavLinks({ sections, onNavigate }: { sections: readonly NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.label ?? 'main'} className="flex flex-col gap-1">
          {section.label ? (
            <span className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</span>
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
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-secondary text-indigo-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Left sidebar: logo (always back to Home), main menu, active organization. */
export function Sidebar({ sections, organizationName }: { sections: readonly NavSection[]; organizationName: string | null }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex h-16 items-center border-b border-border px-5" aria-label="Pactlab home">
        <PactlabLogo />
      </Link>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <NavLinks sections={sections} />
      </div>
      {organizationName ? (
        <Link
          href="/select-organization"
          className="m-3 flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">Organization</span>
            <span className="truncate font-medium">{organizationName}</span>
          </span>
          <ArrowLeftRight aria-label="Switch organization" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}
    </div>
  );
}
