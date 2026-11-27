'use client';

import { ChevronDown, Globe } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { HTML_LANG, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_NAMES, localeHref, splitLocale, type Locale } from '../lib/i18n/locales';

/**
 * The language menu (T-171). Choosing a language stores it in a cookie, which
 * always wins over country detection at the edge, then opens the same page
 * in that language (its home page when the page is English only). Only
 * published languages are offered; with English alone it renders nothing.
 */
export function LanguageSwitcher({ locale, languages, label }: { locale: Locale; languages: readonly Locale[]; label: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { path } = splitLocale(usePathname());
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
  if (languages.length < 2) return null;

  const choose = (next: Locale) => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  };
  const target = (next: Locale) => {
    const same = localeHref(next, path);
    // An English-only page has no translation: the chosen language's home page instead.
    const href = next !== 'en' && same === path ? localeHref(next, '/') : same;
    // The static export serves directories (trailingSlash): link the canonical form.
    return href.endsWith('/') ? href : `${href}/`;
  };

  return (
    <details ref={ref} className="group relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        aria-label={`${label}: ${LOCALE_NAMES[locale]}`}
        className="flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-md px-2 py-2 text-sm font-semibold text-navy/75 hover:text-navy"
      >
        <Globe aria-hidden className="h-4 w-4" />
        <span>{locale.toUpperCase()}</span>
        <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul aria-label={label} className="absolute right-0 top-full z-50 mt-2 flex w-44 flex-col rounded-xl border border-navy/10 bg-white p-2 shadow-xl">
        {languages.map((option) => (
          <li key={option}>
            {/* A full page load: each language has its own root layout and <html lang>. */}
            <a
              href={target(option)}
              hrefLang={HTML_LANG[option]}
              lang={HTML_LANG[option]}
              aria-current={option === locale ? 'true' : undefined}
              onClick={() => choose(option)}
              className="block rounded-md px-3 py-2 text-sm font-semibold hover:bg-mist aria-[current=true]:text-indigo-ink"
            >
              {LOCALE_NAMES[option]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
