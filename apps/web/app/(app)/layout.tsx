import { AppShell } from '@pactlab/ui';
import type { ReactNode } from 'react';
import { publicEnv } from '../../lib/env';
import { visibleNavigation } from '../../lib/navigation';
import { getSessionContext } from '../../lib/session';
import { AccountBar } from './_lib/account-bar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const session = await getSessionContext();
  const nav = visibleNavigation(session.permissions).map(({ href, label }) => ({ href, label }));
  return (
    <AppShell nav={nav} environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}>
      <AccountBar session={session} />
      {children}
    </AppShell>
  );
}
