import type { BrandKitView } from '@pactlab/contracts';
import { AppShell } from '@pactlab/ui';
import type { Metadata } from 'next';
import { cache, Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { SESSION_ENDED_PATH } from '../../lib/auth-flow';
import { publicEnv } from '../../lib/env';
import { visibleSections } from '../../lib/navigation';
import { currentRelease, releaseLabel } from '../../lib/release';
import { appBrand, themeCss } from '../../lib/brand';
import { getSessionContext } from '../../lib/session';
import { apiGet } from './deals/_lib/api';
import { Sidebar } from './_lib/sidebar';
import { Topbar } from './_lib/topbar';
import { BugReporter } from './_lib/bugs/bug-reporter';
import { DemoBlockedNotice } from './_lib/demo-blocked';
import { PasskeyOffer } from './settings/passkeys-card';

/** The active organization's brand kit (T-123); null for a guest, signed out, or on Pactlab's kit. */
const activeBrand = cache(async () => {
  const session = await getSessionContext();
  if (session.kind !== 'signed-in' || session.guest || !session.organization) return null;
  const kit = await apiGet<BrandKitView>('/v1/organization/brand');
  return appBrand(kit.kind === 'ok' ? kit.data : null);
});

/** A branded organization's tab reads "<page> · <Org> · Pactlab", with its logo as the icon. */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await activeBrand();
  if (!brand) return {};
  return {
    title: { default: `${brand.name} · Pactlab`, template: `%s · ${brand.name} · Pactlab` },
    ...(brand.logoUrl ? { icons: { icon: [{ url: brand.logoUrl }] } } : {}),
  };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = publicEnv();
  const session = await getSessionContext();
  // The cookie outlived its session (signed out from another device, idle, or a lower limit): clear it and sign in again.
  if (session.kind === 'signed-out' && session.ended) redirect(SESSION_ENDED_PATH);
  const sections = visibleSections(session.permissions, undefined, session.kind === 'signed-in' && session.guest, session.kind === 'signed-in' && session.operator);
  const version = releaseLabel(await currentRelease());
  const brand = await activeBrand();
  const css = brand ? themeCss(brand.variables) : null;
  return (
    <AppShell
      environmentLabel={env.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : env.NEXT_PUBLIC_APP_ENV}
      sidebar={<Sidebar sections={sections} organizationName={session.kind === 'signed-in' ? (session.organization?.name ?? null) : null} brand={brand} />}
      topbar={<Topbar session={session} sections={sections} brand={brand} />}
    >
      {/* The organization's accent and font over Pactlab's theme (T-123): hex colors and fixed font stacks only. */}
      {css ? <style>{css}</style> : null}
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
