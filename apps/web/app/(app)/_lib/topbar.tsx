import { buttonVariants, PactlabLogo } from '@pactlab/ui';
import { LogOut, Menu, Plus, Settings, ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import type { NavSection } from '../../../lib/navigation';
import type { SessionContext } from '../../../lib/session';
import { signOut } from '../../_actions/sign-out';
import { Dropdown } from './dropdown';
import { NavLinks } from './sidebar';

const menuItem = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted';

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

/**
 * Global actions, always top right: Start a Pact, Settings and the account
 * menu. On small screens the main menu folds into a button here.
 */
export function Topbar({ session, sections }: { session: SessionContext; sections: readonly NavSection[] }) {
  return (
    <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
      <div className="flex items-center gap-3 lg:hidden">
        <Dropdown label="Open menu" align="left" trigger={<span className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Menu aria-hidden className="h-5 w-5" /></span>}>
          <div className="p-2">
            <NavLinks sections={sections} />
          </div>
        </Dropdown>
        <Link href="/" aria-label="Pactlab home">
          <PactlabLogo />
        </Link>
      </div>
      <div className="hidden text-sm text-muted-foreground lg:block">
        {session.kind === 'signed-in' && session.organization ? session.organization.name : null}
      </div>

      {session.kind === 'signed-out' ? (
        <a href="/login" className={buttonVariants({ size: 'sm' })}>
          Sign in
        </a>
      ) : (
        <div className="flex items-center gap-2">
          <Link href="/pacts/new" className={`${buttonVariants({ size: 'sm' })} hidden sm:inline-flex`}>
            <Plus aria-hidden className="h-4 w-4" />
            Start a Pact
          </Link>
          <Link href="/settings" aria-label="Settings" title="Settings" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <Settings aria-hidden className="h-5 w-5" />
          </Link>
          <Dropdown
            label="Account menu"
            trigger={
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
                {initials(session.displayName)}
              </span>
            }
          >
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium">{session.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{session.organization?.name ?? 'No active organization'}</p>
            </div>
            <div className="py-1">
              <Link href="/settings" className={menuItem}>
                <Settings aria-hidden className="h-4 w-4" /> Settings
              </Link>
              <Link href="/select-organization" className={menuItem}>
                <ArrowLeftRight aria-hidden className="h-4 w-4" /> Switch organization
              </Link>
              <form action={signOut}>
                <button type="submit" className={menuItem}>
                  <LogOut aria-hidden className="h-4 w-4" /> Sign out
                </button>
              </form>
            </div>
          </Dropdown>
        </div>
      )}
    </div>
  );
}
