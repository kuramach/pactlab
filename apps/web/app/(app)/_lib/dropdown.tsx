'use client';

import { cn } from '@pactlab/ui';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Disclosure menu on a native <details>: keyboard and screen-reader friendly,
 * closes on outside click, Escape and link selection.
 */
export function Dropdown({
  trigger,
  label,
  align = 'right',
  children,
  className,
}: {
  trigger: ReactNode;
  label: string;
  align?: 'left' | 'right';
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
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
  return (
    <details ref={ref} className={cn('relative [&_summary::-webkit-details-marker]:hidden', className)}>
      <summary aria-label={label} className="flex cursor-pointer list-none items-center rounded-md">
        {trigger}
      </summary>
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a') && ref.current) ref.current.open = false;
        }}
        className={cn(
          'absolute z-30 mt-2 min-w-56 rounded-lg border border-border bg-background p-1 shadow-lg',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {children}
      </div>
    </details>
  );
}
