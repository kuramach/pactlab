import type { ReactNode } from 'react';
import { cn } from '../utils';

export interface Crumb {
  readonly href?: string;
  readonly label: string;
}

/** Where you are and how to get back: every crumb but the last is a link. */
export function Breadcrumbs({ items, className, tone = 'light' }: { items: readonly Crumb[]; className?: string; tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
      <ol className={cn('flex flex-wrap items-center gap-1.5', dark ? 'text-white/60' : 'text-muted-foreground')}>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <a href={item.href} className={cn('hover:underline', dark ? 'hover:text-white' : 'hover:text-foreground')}>
                  {item.label}
                </a>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && (dark ? 'font-semibold text-white' : 'font-medium text-foreground'))}>
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
  tone = 'light',
  eyebrow,
}: {
  breadcrumbs?: readonly Crumb[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small facts under the title, e.g. badges. */
  meta?: ReactNode;
  /** `navy`: the website's hero band, for landing pages and workspaces. */
  tone?: 'light' | 'navy';
  eyebrow?: ReactNode;
}) {
  if (tone === 'navy') {
    return (
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-navy px-6 py-7 text-white shadow-lg shadow-navy/20 sm:px-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-teal/10 blur-3xl" />
        <div className="relative flex flex-col gap-3">
          {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} tone="dark" /> : null}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              {eyebrow ? <p className="text-xs font-bold uppercase tracking-widest text-indigo">{eyebrow}</p> : null}
              <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
              {description ? <p className="max-w-3xl text-sm leading-relaxed text-white/80">{description}</p> : null}
              {meta ? <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">{meta}</div> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </header>
    );
  }
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className="text-xs font-bold uppercase tracking-widest text-indigo-ink">{eyebrow}</p> : null}
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
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

const ACCENTS = {
  indigo: 'bg-indigo/12 text-indigo-ink',
  teal: 'bg-teal/12 text-teal',
  amber: 'bg-amber/15 text-amber',
  rose: 'bg-rose/12 text-rose',
  navy: 'bg-navy text-indigo',
} as const;
export type Accent = keyof typeof ACCENTS;

/** Icon on a soft coloured tile, as on the website. */
export function IconTile({ children, accent = 'indigo', className }: { children: ReactNode; accent?: Accent; className?: string }) {
  return (
    <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5', ACCENTS[accent], className)}>
      {children}
    </span>
  );
}

/** A labelled figure with an icon, for summary rows. */
export function Stat({
  label,
  value,
  hint,
  icon,
  accent = 'indigo',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-navy/10 bg-card p-5 shadow-sm shadow-navy/5">
      {icon ? <IconTile accent={accent}>{icon}</IconTile> : null}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</span>
        <span className="text-2xl font-extrabold tracking-tight" data-numeric>
          {value}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
