import Link from 'next/link';
import { BRAND_LINE, INDUSTRIES, MODULES, NAV, TAGLINE } from '../lib/content';
import { siteConfig } from '../lib/config';
import { Lockup } from './lockup';

export function SiteFooter() {
  const { loginUrl, signUpUrl } = siteConfig();
  const account = [
    ...(loginUrl ? [{ href: loginUrl, label: 'Log in' }] : []),
    ...(signUpUrl ? [{ href: signUpUrl, label: 'Sign up' }] : []),
  ];
  const columns = [
    { title: 'Product', links: MODULES.map((m) => ({ href: `/product/${m.slug}`, label: m.name })) },
    { title: 'Industries', links: INDUSTRIES.map((i) => ({ href: `/industries/${i.slug}`, label: i.name })) },
    {
      title: 'Pactlab',
      links: [
        ...NAV.filter((n) => n.href !== '/product' && n.href !== '/industries').map((n) => ({ href: n.href, label: n.label })),
        ...account,
      ],
    },
  ];
  return (
    <footer className="bg-navy text-white/75">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.3fr_1fr_1fr_0.7fr]">
        <div className="flex flex-col gap-4">
          <Lockup tone="onDark" size="sm" />
          <p className="max-w-xs text-sm font-semibold text-white">{TAGLINE}</p>
          <p className="max-w-xs text-sm">{BRAND_LINE}</p>
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
        <p className="mx-auto max-w-6xl px-6 py-6 text-xs">© {new Date().getFullYear()} Pactlab</p>
      </div>
    </footer>
  );
}
