import { AppShell } from '@pactlab/ui';
import type { ReactNode } from 'react';
import { publicEnv } from '../../lib/env';
import { visibleSections } from '../../lib/navigation';
import { getSessionContext } from '../../lib/session';
import { Sidebar } from './_lib/sidebar';
import { Topbar } from './_lib/topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const session = await getSessionContext();
  const sections = visibleSections(session.permissions);
  return (
    <AppShell
      environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}
      sidebar={<Sidebar sections={sections} organizationName={session.kind === 'signed-in' ? (session.organization?.name ?? null) : null} />}
      topbar={<Topbar session={session} sections={sections} />}
    >
      {children}
    </AppShell>
  );
}
