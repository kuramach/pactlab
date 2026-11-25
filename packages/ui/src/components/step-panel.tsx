import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * The one panel for stepping through items one at a time (Kumar, 2026-11-25): the guided tour's design is the
 * approved one, and the What's new cards on the home and behind the icon use the same. An icon on the left;
 * "Label · 2 of 5" before the title; the text; and the controls (Back, Next, dismiss) inside the panel, on the
 * right. Every stepper or carousel in the app is built from this, never restyled (docs/ui-patterns.md).
 */
export function StepPanel({
  label,
  icon,
  eyebrow,
  title,
  children,
  actions,
  className,
  ...rest
}: {
  /** The panel's accessible name, e.g. "Why this matters" or "What’s new". */
  label: string;
  icon: ReactNode;
  /** "Tour · 2 of 9" or "What’s new · 2 of 5"; omitted when not stepping. */
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  /** Back, Next, Finish, dismiss: buttons inside the panel. */
  actions?: ReactNode;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onTouchStart?: React.TouchEventHandler<HTMLElement>;
  onTouchEnd?: React.TouchEventHandler<HTMLElement>;
}) {
  return (
    <aside aria-label={label} className={cn('rounded-xl border border-indigo/30 bg-indigo/5 p-4 text-sm', className)} {...rest}>
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-indigo-ink [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold text-navy">
            {eyebrow ? <span className="mr-2 text-xs font-bold uppercase tracking-wide text-indigo-ink">{eyebrow}</span> : null}
            {title}
          </p>
          {children}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </aside>
  );
}
