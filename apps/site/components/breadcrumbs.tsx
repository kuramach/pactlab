import Link from 'next/link';
import { site } from '../lib/i18n/catalog';
import { localeHref, type Locale } from '../lib/i18n/locales';
import { breadcrumbJsonLd, jsonLdScript, type Crumb } from '../lib/seo';

/** Visible breadcrumb trail plus its schema.org BreadcrumbList. The last crumb is the current page. */
/** Crumb hrefs are English paths; they are prefixed for the page's language here. */
export function Breadcrumbs({ crumbs, tone = 'light', locale = 'en' }: { crumbs: readonly Crumb[]; tone?: 'light' | 'dark'; locale?: Locale }) {
  const localized = crumbs.map((crumb) => ({ ...crumb, href: localeHref(locale, crumb.href) }));
  const muted = tone === 'dark' ? 'text-white/70' : 'text-slate-text';
  return (
    <nav aria-label={site(locale).ui.shell.breadcrumb} className={`text-sm ${muted}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(localized)) }} />
      <ol className="flex flex-wrap items-center gap-1">
        {localized.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden>›</span> : null}
            {index === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="underline-offset-4 hover:underline">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
