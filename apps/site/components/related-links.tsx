import Link from 'next/link';
import { localeHref, type Locale } from '../lib/i18n/locales';

/** "Read next" links at the foot of an answer page. */
export function RelatedLinks({ links, locale = 'en' }: { links: readonly { readonly href: string; readonly label: string }[]; locale?: Locale }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <li key={link.href}>
          <Link href={localeHref(locale, link.href)} className="flex h-full items-center justify-between gap-3 rounded-xl border border-navy/10 p-4 font-semibold hover:border-indigo hover:bg-mist">
            {link.label}
            <span aria-hidden className="text-indigo-ink">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
