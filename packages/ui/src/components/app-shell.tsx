import type { ReactNode } from 'react';

/**
 * Application frame in the style of a financial dashboard (Stripe-like):
 * a fixed left sidebar for navigation, a sticky top bar for global actions
 * (start, settings, account) and a centered content column. The host app
 * supplies the sidebar and top bar so they can follow the current route.
 */
export function AppShell({
  sidebar,
  topbar,
  environmentLabel,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  /** Shown as a persistent banner outside production. */
  environmentLabel?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted text-foreground">
      {environmentLabel ? (
        <div role="note" className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950">
          Non-production environment: {environmentLabel}
        </div>
      ) : null}
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-background lg:flex">
          {sidebar}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">{topbar}</header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
