import type { PublicListingView } from '@pactlab/contracts';
import { publicEnv } from '../../../lib/env';

/** A published page's teaser, signed out; null when there is none at this link. */
export async function publicListing(slug: string): Promise<PublicListingView | null> {
  if (!/^pl-[a-z0-9]{10}$/.test(slug)) return null;
  const response = await fetch(new URL(`/v1/public/listings/${slug}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { cache: 'no-store' });
  return response.ok ? ((await response.json()) as PublicListingView) : null;
}
