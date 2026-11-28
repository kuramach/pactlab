import type { ContactProfileView } from '@pactlab/contracts';
import Link from 'next/link';
import { apiGet } from '../deals/_lib/api';

/**
 * The one-time ask (T-180): until the person has a verified email, every page says so once at the top,
 * with a link to their profile. It goes away by itself once they add one; it never names an address.
 */
export async function EmailBanner() {
  const profile = await apiGet<ContactProfileView>('/v1/me/contact');
  if (profile.kind !== 'ok' || !profile.data.askForEmail) return null;
  return (
    <aside aria-label="Add your email" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="font-semibold">Add your email so Pactlab can tell you when a pact needs you.</span>{' '}
      <Link href="/settings/profile#email" className="font-medium underline">
        Add your email
      </Link>
    </aside>
  );
}
