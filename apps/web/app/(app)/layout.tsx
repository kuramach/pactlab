import { AppShell } from '@pactlab/ui';
import type { ReactNode } from 'react';
import { publicEnv } from '../../lib/env';
import { visibleSections } from '../../lib/navigation';
import { currentRelease, releaseLabel } from '../../lib/release';
import { getSessionContext } from '../../lib/session';
import { Sidebar } from './_lib/sidebar';
import { Topbar } from './_lib/topbar';
import { BugReporter } from './_lib/bugs/bug-reporter';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const session = await getSessionContext();
  const sections = visibleSections(session.permissions, undefined, session.kind === 'signed-in' && session.guest);
  const version = releaseLabel(await currentRelease());
  return (
    <AppShell
      environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}
      sidebar={<Sidebar sections={sections} organizationName={session.kind === 'signed-in' ? (session.organization?.name ?? null) : null} />}
      topbar={<Topbar session={session} sections={sections} />}
    >
      <div data-app-root>{children}</div>
      {/* Which release this is, on every page (T-100). */}
      <footer className="mt-12 pb-2 text-xs text-muted-foreground" aria-label="Version">
        Pactlab {version}
      </footer>
      <BugReporter appVersion={version} environment={env.NEXT_PUBLIC_APP_ENV} />
    </AppShell>
  );
}
