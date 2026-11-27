'use client';

import { ChevronDown, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { fill } from '../lib/i18n/localize';
import { localeHref, splitLocale, type Locale } from '../lib/i18n/locales';
import type { Messages } from '../messages/en/ui';
import { Icon } from './icon';
import { LanguageSwitcher } from './language-switcher';
import { Lockup } from './lockup';

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** A menu entry: an icon, or (industries) a miniature of the pack's editorial art (T-143). */
export type MenuItem = { href: string; label: string; detail: string; icon: Parameters<typeof Icon>[0]['name']; image?: string };
/** The Product, Industries and About menus, keyed by the section's English path, already in the page's language. */
export type Menus = Readonly<Record<string, { title: string; items: readonly MenuItem[] }>>;

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

function MegaMenu({ href, active, menus, locale, allOf, pad }: { href: string; active: boolean; menus: Menus; locale: Locale; allOf: string; pad: string }) {
  const ref = useDisclosure();
  const menu = menus[href];
  if (!menu) return null;
  return (
    <details ref={ref} className="group relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-md ${pad} py-2 text-sm font-semibold hover:text-navy ${
          active ? 'text-indigo-ink' : 'text-navy/75'
        }`}
      >
        {menu.title}
        <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-1/2 top-full z-50 mt-3 w-[40rem] -translate-x-1/2 rounded-2xl border border-navy/10 bg-white p-4 shadow-2xl shadow-navy/10">
        <div className="grid grid-cols-2 gap-1">
          {menu.items.map((item) => (
            <Link key={item.href} href={localeHref(locale, item.href)} className="flex gap-3 rounded-xl p-3 hover:bg-mist">
              {item.image ? (
                // Decorative: the label beside it names the industry.
                <img src={item.image} alt="" width={36} height={36} loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo/10 text-indigo-ink">
                  <Icon name={item.icon} className="h-4 w-4" />
                </span>
              )}
              <span className="flex flex-col">
                <span className="text-sm font-bold text-navy">{item.label}</span>
                <span className="line-clamp-2 text-xs text-slate-text">{item.detail}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href={localeHref(locale, href)} className="mt-2 block rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-indigo-ink hover:underline">
          {fill(allOf, { section: menu.title })}
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
  locale,
  words,
  nav,
  menus,
  announcement,
  tagline,
  languages,
}: {
  loginUrl: string | null;
  signUpUrl: string | null;
  contactHref: string | null;
  locale: Locale;
  words: Messages['shell'];
  nav: readonly { readonly href: string; readonly label: string }[];
  menus: Menus;
  announcement: { readonly text: string; readonly link: { readonly href: string; readonly label: string } };
  tagline: string;
  /** The published languages the switcher offers; one (English) hides it. */
  languages: readonly Locale[];
}) {
  // Active state compares English paths: /de/faq is the FAQ section.
  const pathname = splitLocale(usePathname()).path;
  const mobile = useDisclosure();
  const href = (path: string) => localeHref(locale, path);
  // German and French labels run longer: tighter padding keeps the full menu on one line at 1,280px (T-171).
  const pad = locale === 'de' || locale === 'fr' ? 'px-2' : 'px-3';
  return (
    <>
      <div className="bg-indigo text-navy">
        <p className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 px-6 py-2 text-center text-sm font-semibold">
          {announcement.text}
          <Link href={href(announcement.link.href)} className="underline underline-offset-4 hover:no-underline">
            {announcement.link.label} →
          </Link>
        </p>
      </div>
      <header className="sticky top-0 z-40 border-b border-navy/10 bg-white/95 backdrop-blur">
        {/* The full menu needs about 1,150px: it shows from xl (1,280px); below that, the compact menu. Labels never wrap. */}
        <nav aria-label={words.primaryNav} className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href={href('/')} aria-label={words.homeLabel} className="min-w-0 shrink">
            <Lockup withTagline tagline={tagline} />
          </Link>
          <div className="hidden items-center gap-1 xl:flex">
            {nav.map((item) =>
              menus[item.href] ? (
                <MegaMenu key={item.href} href={item.href} active={isActive(pathname, item.href)} menus={menus} locale={locale} allOf={words.allOf} pad={pad} />
              ) : (
                <Link
                  key={item.href}
                  href={href(item.href)}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-md ${pad} py-2 text-sm font-semibold text-navy/75 hover:text-navy aria-[current=page]:text-indigo-ink`}
                >
                  {item.label}
                </Link>
              ),
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <LanguageSwitcher locale={locale} languages={languages} label={words.language} />
            {loginUrl ? (
              <a href={loginUrl} className={`whitespace-nowrap rounded-md ${pad} py-2 text-sm font-semibold text-navy/75 hover:text-navy`}>
                {words.logIn}
              </a>
            ) : null}
            {signUpUrl ? (
              <a href={signUpUrl} className="whitespace-nowrap rounded-lg border border-navy/20 px-4 py-2 text-sm font-bold text-navy hover:border-navy">
                {words.signUp}
              </a>
            ) : null}
            {contactHref ? (
              <a href={contactHref} className="whitespace-nowrap rounded-lg bg-navy px-4 py-2 text-sm font-bold text-white hover:bg-indigo hover:text-navy">
                {words.talkToUs}
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2 xl:hidden">
            <LanguageSwitcher locale={locale} languages={languages} label={words.language} />
            <details ref={mobile} className="relative [&_summary::-webkit-details-marker]:hidden">
              <summary aria-label={words.menu} className="flex cursor-pointer list-none items-center rounded-lg border border-navy/20 p-2">
                <Menu aria-hidden className="h-5 w-5" />
              </summary>
              <div className="absolute right-0 mt-2 flex w-64 flex-col rounded-xl border border-navy/10 bg-white p-2 shadow-xl">
                {nav.map((item) => (
                  <Link key={item.href} href={href(item.href)} className="rounded-md px-3 py-2 text-sm font-semibold">
                    {item.label}
                  </Link>
                ))}
                {loginUrl ? (
                  <a href={loginUrl} className="rounded-md px-3 py-2 text-sm font-semibold">
                    {words.logIn}
                  </a>
                ) : null}
                {signUpUrl ? (
                  <a href={signUpUrl} className="rounded-md px-3 py-2 text-sm font-semibold">
                    {words.signUp}
                  </a>
                ) : null}
                {contactHref ? (
                  <a href={contactHref} className="mt-1 rounded-lg bg-navy px-3 py-2 text-center text-sm font-bold text-white">
                    {words.talkToUs}
                  </a>
                ) : null}
              </div>
            </details>
          </div>
        </nav>
      </header>
    </>
  );
}
