'use client';

import { ChevronDown, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ANNOUNCEMENT, INDUSTRIES, MODULES, NAV } from '../lib/content';
import { Icon } from './icon';
import { Lockup } from './lockup';

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

const MENUS: Readonly<Record<string, { title: string; items: readonly { href: string; label: string; detail: string; icon: Parameters<typeof Icon>[0]['name'] }[] }>> = {
  '/product': {
    title: 'Product',
    items: MODULES.map((module) => ({ href: `/product/${module.slug}`, label: module.name, detail: module.summary, icon: module.icon })),
  },
  '/industries': {
    title: 'Industries',
    items: INDUSTRIES.map((industry) => ({
      href: `/industries/${industry.slug}`,
      label: industry.name,
      detail: industry.status === 'AVAILABLE' ? 'Full industry pack' : 'Industry pack',
      icon: industry.icon,
    })),
  },
};

/** <details> menu that closes on outside click, Escape and navigation. */
function useDisclosure() {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return ref;
}

function MegaMenu({ href, active }: { href: string; active: boolean }) {
  const ref = useDisclosure();
  const menu = MENUS[href]!;
  return (
    <details ref={ref} className="group relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-semibold hover:text-navy ${
          active ? 'text-indigo-ink' : 'text-navy/75'
        }`}
      >
        {menu.title}
        <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-1/2 top-full z-50 mt-3 w-[40rem] -translate-x-1/2 rounded-2xl border border-navy/10 bg-white p-4 shadow-2xl shadow-navy/10">
        <div className="grid grid-cols-2 gap-1">
          {menu.items.map((item) => (
            <Link key={item.href} href={item.href} className="flex gap-3 rounded-xl p-3 hover:bg-mist">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo/10 text-indigo-ink">
                <Icon name={item.icon} className="h-4 w-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold text-navy">{item.label}</span>
                <span className="line-clamp-2 text-xs text-slate-text">{item.detail}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href={href} className="mt-2 block rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-indigo-ink hover:underline">
          All {menu.title.toLowerCase()} →
        </Link>
      </div>
    </details>
  );
}

/**
 * Announcement bar, then a sticky header: logo, name and tagline top left;
 * Product and Industries menus; log in, sign up and talk to us on the right.
 */
export function SiteHeader({
  loginUrl,
  signUpUrl,
  contactHref,
}: {
  loginUrl: string | null;
  signUpUrl: string | null;
  contactHref: string | null;
}) {
  const pathname = usePathname();
  const mobile = useDisclosure();
  return (
    <>
      <div className="bg-indigo text-navy">
        <p className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 px-6 py-2 text-center text-sm font-semibold">
          {ANNOUNCEMENT.text}
          <Link href={ANNOUNCEMENT.link.href} className="underline underline-offset-4 hover:no-underline">
            {ANNOUNCEMENT.link.label} →
          </Link>
        </p>
      </div>
      <header className="sticky top-0 z-40 border-b border-navy/10 bg-white/95 backdrop-blur">
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" aria-label="Pactlab home" className="shrink-0">
            <Lockup withTagline />
          </Link>
          <div className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) =>
              MENUS[item.href] ? (
                <MegaMenu key={item.href} href={item.href} active={isActive(pathname, item.href)} />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className="rounded-md px-3 py-2 text-sm font-semibold text-navy/75 hover:text-navy aria-[current=page]:text-indigo-ink"
                >
                  {item.label}
                </Link>
              ),
            )}
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            {loginUrl ? (
              <a href={loginUrl} className="rounded-md px-3 py-2 text-sm font-semibold text-navy/75 hover:text-navy">
                Log in
              </a>
            ) : null}
            {signUpUrl ? (
              <a href={signUpUrl} className="rounded-lg border border-navy/20 px-4 py-2 text-sm font-bold text-navy hover:border-navy">
                Sign up
              </a>
            ) : null}
            {contactHref ? (
              <a href={contactHref} className="rounded-lg bg-navy px-4 py-2 text-sm font-bold text-white hover:bg-indigo hover:text-navy">
                Talk to us
              </a>
            ) : null}
          </div>
          <details ref={mobile} className="relative lg:hidden [&_summary::-webkit-details-marker]:hidden">
            <summary aria-label="Menu" className="flex cursor-pointer list-none items-center rounded-lg border border-navy/20 p-2">
              <Menu aria-hidden className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 mt-2 flex w-64 flex-col rounded-xl border border-navy/10 bg-white p-2 shadow-xl">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-semibold">
                  {item.label}
                </Link>
              ))}
              {loginUrl ? (
                <a href={loginUrl} className="rounded-md px-3 py-2 text-sm font-semibold">
                  Log in
                </a>
              ) : null}
              {signUpUrl ? (
                <a href={signUpUrl} className="rounded-md px-3 py-2 text-sm font-semibold">
                  Sign up
                </a>
              ) : null}
              {contactHref ? (
                <a href={contactHref} className="mt-1 rounded-lg bg-navy px-3 py-2 text-center text-sm font-bold text-white">
                  Talk to us
                </a>
              ) : null}
            </div>
          </details>
        </nav>
      </header>
    </>
  );
}
