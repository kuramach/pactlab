import { PactlabLockup } from '@pactlab/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiGet } from '../(app)/deals/_lib/api';
import { currentRelease, releaseLabel } from '../../lib/release';

export const dynamic = 'force-dynamic';

/**
 * The operator console (T-072). Only platform operators get past this: anyone
 * else sees "not found" (the API answers 403 to every admin route anyway).
 * No bug button here, and no customer deal content anywhere.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [overview, release] = await Promise.all([apiGet<{ environment: string; appVersion: string }>('/v1/admin'), currentRelease()]);
  if (overview.kind !== 'ok') notFound();
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-navy px-6 py-3 text-white">
        <a href="/admin" className="flex items-center gap-3" aria-label="Pactlab operator console">
          <PactlabLockup tone="onDark" withTagline={false} />
          <span className="border-l border-white/20 pl-3 text-sm font-semibold uppercase tracking-wide text-white/80">Operator console</span>
        </a>
        <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-bold uppercase tracking-wide text-navy" aria-label="Environment">
          {overview.data.environment} · {releaseLabel(release)}
        </span>
        <a href="/" className="text-sm underline">
          Back to the app
        </a>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">{children}</main>
    </div>
  );
}
