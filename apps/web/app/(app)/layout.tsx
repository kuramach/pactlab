import { AppShell } from '@pactlab/ui';
import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { SESSION_ENDED_PATH } from '../../lib/auth-flow';
import { publicEnv } from '../../lib/env';
import { visibleSections } from '../../lib/navigation';
import { currentRelease, releaseLabel } from '../../lib/release';
import { getSessionContext } from '../../lib/session';
import { Sidebar } from './_lib/sidebar';
import { Topbar } from './_lib/topbar';
import { BugReporter } from './_lib/bugs/bug-reporter';
import { DemoBlockedNotice } from './_lib/demo-blocked';
import { PasskeyOffer } from './settings/passkeys-card';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const session = await getSessionContext();
  // The cookie outlived its session (signed out from another device, idle, or a lower limit): clear it and sign in again.
  if (session.kind === 'signed-out' && session.ended) redirect(SESSION_ENDED_PATH);
  const sections = visibleSections(session.permissions, undefined, session.kind === 'signed-in' && session.guest, session.kind === 'signed-in' && session.operator);
  const version = releaseLabel(await currentRelease());
  return (
    <AppShell
      environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}
      sidebar={<Sidebar sections={sections} organizationName={session.kind === 'signed-in' ? (session.organization?.name ?? null) : null} />}
      topbar={<Topbar session={session} sections={sections} />}
    >
      {/* A shared demo (T-113): say so, and that changes don't last. */}
      {session.kind === 'signed-in' && session.demo ? (
        <aside aria-label="Shared demo" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span className="font-semibold">Shared demo.</span> Explore freely: every pact and figure is synthetic, and the demo is reset when the share ends. Sending invitations, e-signature, billing and
          connecting outside systems are switched off here.
          <Suspense fallback={null}>
            <DemoBlockedNotice />
          </Suspense>
        </aside>
      ) : null}
      {/* Right after an email sign-in: the one-time passkey offer (T-108). */}
      {session.kind === 'signed-in' ? <PasskeyOffer /> : null}
      <div data-app-root>{children}</div>
      {/* Which release this is, on every page (T-100). */}
      <footer className="mt-12 pb-2 text-xs text-muted-foreground" aria-label="Version">
        Pactlab {version}
      </footer>
      <BugReporter appVersion={version} environment={env.NEXT_PUBLIC_APP_ENV} />
    </AppShell>
  );
}
