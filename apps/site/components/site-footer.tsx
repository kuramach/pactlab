import Link from 'next/link';
import { siteConfig } from '../lib/config';
import { site } from '../lib/i18n/catalog';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { LEGAL_ENTITY } from '../lib/legal';
import { Lockup } from './lockup';

export function SiteFooter({ locale = 'en' }: { locale?: Locale }) {
  const { loginUrl, signUpUrl } = siteConfig();
  const { content, ui, modules, industries } = site(locale);
  const words = ui.footer;
  const href = (path: string) => localeHref(locale, path);
  const account = [
    ...(loginUrl ? [{ href: loginUrl, label: ui.shell.logIn }] : []),
    ...(signUpUrl ? [{ href: signUpUrl, label: ui.shell.signUp }] : []),
  ];
  const columns = [
    { title: words.product, links: modules.map((m) => ({ href: `/product/${m.slug}`, label: m.name })) },
    { title: words.industries, links: industries.map((i) => ({ href: href(`/industries/${i.slug}`), label: i.name })) },
    {
      title: words.pactlab,
      links: [
        ...content.nav.filter((n) => n.href !== '/product' && n.href !== '/industries').map((n) => ({ href: href(n.href), label: n.label })),
        { href: href('/guides'), label: words.guides },
        { href: href('/faq'), label: words.faq },
        { href: href('/rinse'), label: words.rinse },
        { href: href('/compare/valuation-software'), label: words.compare },
        ...account,
      ],
    },
  ];
  return (
    <footer className="bg-navy text-white/75">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.3fr_1fr_1fr_0.7fr]">
        <div className="flex flex-col gap-4">
          <Lockup tone="onDark" size="sm" withTagline tagline={content.tagline} />
          <p className="max-w-xs text-sm">{words.blurb}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-2 text-sm">
            <p className="font-bold text-white">{column.title}</p>
            {column.links.map((link) =>
              link.href.startsWith('/') ? (
                <Link key={link.href} href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              ) : (
                <a key={link.href} href={link.href} className="hover:text-white">
                  {link.label}
                </a>
              ),
            )}
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs">
          <p>© {new Date().getFullYear()} {LEGAL_ENTITY}</p>
          <nav aria-label={words.legal} className="flex flex-wrap gap-4">
            <Link href="/trust" className="hover:text-white">
              {words.trust}
            </Link>
            <Link href="/privacy" className="hover:text-white">
              {words.privacy}
            </Link>
            <Link href="/terms" className="hover:text-white">
              {words.terms}
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
