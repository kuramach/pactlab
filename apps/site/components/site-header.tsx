'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '../lib/content';
import { Lockup } from './lockup';

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Sticky white header with the lockup. On small screens the links sit in a
 * <details> menu, which works without JavaScript.
 */
export function SiteHeader({ signInUrl }: { signInUrl: string | null }) {
  const pathname = usePathname();
  const links = NAV.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
      className="rounded-md px-3 py-2 text-sm font-semibold text-navy/75 hover:text-navy aria-[current=page]:text-indigo-ink"
    >
      {item.label}
    </Link>
  ));
  return (
    <header className="sticky top-0 z-40 border-b border-navy/10 bg-white/95 backdrop-blur">
      <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" aria-label="Pactlab home" className="shrink-0">
          <Lockup />
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {links}
          {signInUrl ? (
            <a href={signInUrl} className="ml-3 rounded-lg border border-navy/20 px-4 py-2 text-sm font-semibold hover:border-navy">
              Sign in
            </a>
          ) : null}
        </div>
        <details className="relative md:hidden">
          <summary className="cursor-pointer list-none rounded-lg border border-navy/20 px-3 py-2 text-sm font-semibold">Menu</summary>
          <div className="absolute right-0 mt-2 flex w-56 flex-col rounded-xl border border-navy/10 bg-white p-2 shadow-xl">
            {links}
            {signInUrl ? (
              <a href={signInUrl} className="rounded-md px-3 py-2 text-sm font-semibold">
                Sign in
              </a>
            ) : null}
          </div>
        </details>
      </nav>
    </header>
  );
}
