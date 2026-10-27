import Link from 'next/link';
import { breadcrumbJsonLd, jsonLdScript, type Crumb } from '../lib/seo';

/** Visible breadcrumb trail plus its schema.org BreadcrumbList. The last crumb is the current page. */
export function Breadcrumbs({ crumbs, tone = 'light' }: { crumbs: readonly Crumb[]; tone?: 'light' | 'dark' }) {
  const muted = tone === 'dark' ? 'text-white/70' : 'text-slate-text';
  return (
    <nav aria-label="Breadcrumb" className={`text-sm ${muted}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((crumb, index) => (
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
