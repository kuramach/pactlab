import type { ReactNode } from 'react';
import { cn } from '../utils';

export interface Crumb {
  readonly href?: string;
  readonly label: string;
}

/** Where you are and how to get back: every crumb but the last is a link. */
export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <a href={item.href} className="hover:text-foreground hover:underline">
                  {item.label}
                </a>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-medium text-foreground')}>
                  {item.label}
                </span>
              )}
              {last ? null : <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Page title block: breadcrumbs, title, one-line description and primary actions. */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  meta,
}: {
  breadcrumbs?: readonly Crumb[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small facts under the title, e.g. badges. */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export interface TabItem {
  readonly href: string;
  readonly label: string;
  readonly active?: boolean;
}

/** Underlined section tabs for a workspace (e.g. one deal). */
export function TabNav({ items, label }: { items: readonly TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto">
      <ul className="flex gap-6 border-b border-border">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'inline-block whitespace-nowrap border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors',
                item.active
                  ? 'border-indigo-ink text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A titled block inside a page. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A labelled figure for summary rows. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold" data-numeric>
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
