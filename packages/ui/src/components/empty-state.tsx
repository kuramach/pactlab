import type { ReactNode } from 'react';
import { cn } from '../utils';

/** The website's module mark: a white line icon on a navy-to-indigo tile. Decorative. */
export function Mark({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-mark=""
      className={cn(
        'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-navy to-indigo-ink text-white shadow-md shadow-navy/20 ring-1 ring-inset ring-white/15 [&_svg]:h-6 [&_svg]:w-6',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** A line icon shown as a mark above the title; the title carries the meaning. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center', className)}
    >
      {icon ? <Mark className="mb-2">{icon}</Mark> : null}
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
