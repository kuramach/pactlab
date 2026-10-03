import { AppShell } from '@pactlab/ui';
import type { ReactNode } from 'react';
import { publicEnv } from '../../lib/env';
import { visibleNavigation } from '../../lib/navigation';
import { getSessionPermissions } from '../../lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const nav = visibleNavigation(await getSessionPermissions()).map(({ href, label }) => ({ href, label }));
  return (
    <AppShell nav={nav} environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}>
      {children}
    </AppShell>
  );
}
