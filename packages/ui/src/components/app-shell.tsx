import type { ReactNode } from 'react';
import { cn } from '../utils';

export interface ShellNavItem {
  href: string;
  label: string;
  active?: boolean;
}

export function AppShell({
  nav,
  environmentLabel,
  children,
}: {
  nav: readonly ShellNavItem[];
  /** Shown as a persistent banner outside production. */
  environmentLabel?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {environmentLabel ? (
        <div role="note" className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950">
          Non-production environment: {environmentLabel}
        </div>
      ) : null}
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-muted/40 p-4 md:block">
          <div className="mb-6">
            <p className="text-lg font-semibold tracking-tight">Pactlab</p>
            <p className="text-xs text-muted-foreground">Test the pact before you sign it.</p>
          </div>
          <nav aria-label="Primary">
            <ul className="flex flex-col gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-3 py-2 text-sm hover:bg-muted',
                      item.active && 'bg-muted font-medium',
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="flex-1 p-6 md:p-10">{children}</main>
      </div>
    </div>
  );
}
