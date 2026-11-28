import { buttonVariants, fill, PactlabLockup } from '@pactlab/ui';
import { ArrowLeftRight, Bell, Bug, LogOut, Menu, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import type { NavSection } from '../../../lib/navigation';
import type { SessionContext } from '../../../lib/session';
import { signOut } from '../../_actions/sign-out';
import { Dropdown } from './dropdown';
import { NavLinks, OrgMark, type ShellBrand, type ShellCopy } from './sidebar';

const menuItem = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted';

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** The bell (T-145): the inbox, with the unread count. */
function NotificationsBell({ unread, copy }: { unread: number; copy: ShellCopy }) {
  const label = unread > 0 ? fill(copy.notificationsUnread, { count: unread }) : copy.notifications;
  return (
    <Link href="/notifications" aria-label={label} title={label} className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} relative`}>
      <Bell aria-hidden className="h-5 w-5" />
      {unread > 0 ? (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-navy px-1 text-center text-[0.65rem] font-bold leading-5 text-white" data-numeric>
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Global actions, always top right: Start a Pact, notifications, Settings and the account
 * menu. On small screens the main menu folds into a button here.
 */
export function Topbar({ copy, session, sections, brand = null, unread = null }: { copy: ShellCopy; session: SessionContext; sections: readonly NavSection[]; brand?: ShellBrand | null; unread?: number | null }) {
  return (
    <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
      <div className="flex items-center gap-3 lg:hidden">
        <Dropdown label={copy.openMenu} align="left" trigger={<span className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Menu aria-hidden className="h-5 w-5" /></span>}>
          <div className="p-2">
            <NavLinks copy={copy} sections={sections} />
          </div>
        </Dropdown>
        <Link href="/" aria-label={brand ? fill(copy.brandHome, { name: brand.name }) : copy.home}>
          {brand ? <OrgMark brand={brand} tone="light" copy={copy} /> : <PactlabLockup withTagline={false} />}
        </Link>
      </div>
      {/* The organization lives in the sidebar (with Switch organization) and the account menu; the top bar stays for actions. */}
      <div className="hidden lg:block" />

      {session.kind === 'signed-out' ? (
        <a href="/login" className={buttonVariants({ size: 'sm' })}>
          {copy.signIn}
        </a>
      ) : (
        <div className="flex items-center gap-2">
          {session.guest ? null : (
            <Link href="/pacts/new" className={`${buttonVariants({ size: 'sm' })} hidden sm:inline-flex`}>
              <Plus aria-hidden className="h-4 w-4" />
              {copy.startPact}
            </Link>
          )}
          {unread === null ? null : <NotificationsBell unread={unread} copy={copy} />}
          <Link href="/settings" aria-label={copy.settings} title={copy.settings} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <Settings aria-hidden className="h-5 w-5" />
          </Link>
          <Dropdown
            label={copy.accountMenu}
            trigger={
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo text-xs font-extrabold text-navy ring-2 ring-indigo/30">
                {initials(session.displayName)}
              </span>
            }
          >
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium">{session.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{session.organization?.name ?? copy.noOrganization}</p>
            </div>
            <div className="py-1">
              <Link href="/settings" className={menuItem}>
                <Settings aria-hidden className="h-4 w-4" /> {copy.settings}
              </Link>
              <Link href="/settings/bug-reports" className={menuItem}>
                <Bug aria-hidden className="h-4 w-4" /> {copy.bugsSubmitted}
              </Link>
              <Link href="/select-organization" className={menuItem}>
                <ArrowLeftRight aria-hidden className="h-4 w-4" /> {copy.switchOrganization}
              </Link>
              <form action={signOut}>
                <button type="submit" className={menuItem}>
                  <LogOut aria-hidden className="h-4 w-4" /> {copy.signOut}
                </button>
              </form>
            </div>
          </Dropdown>
        </div>
      )}
    </div>
  );
}
