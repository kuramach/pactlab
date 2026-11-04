import { CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { publicListing } from '../_lib/api';
import { ListingPage, RequestForm } from '../_lib/listing-page';
import { teaserTitle } from '../_lib/teaser';
import { requestAccess } from './actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  details: 'Fill in your name, firm, a valid email address and why you are interested, and agree to the note below the form.',
  unavailable: 'We could not send your request right now. Try again shortly.',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const listing = await publicListing((await params).slug);
  if (!listing) return { title: 'Pactlab', robots: { index: false, follow: false } };
  const hero = listing.media.find((item) => item.kind === 'IMAGE');
  return {
    title: `${teaserTitle(listing)} — ${listing.headline}`,
    description: listing.headline,
    // Closed to search engines unless the seller allowed indexing.
    robots: listing.indexable ? { index: true, follow: false } : { index: false, follow: false },
    openGraph: { title: teaserTitle(listing), description: listing.headline, ...(hero ? { images: [`/listings/${listing.slug}/media/${hero.id}`] } : {}) },
  };
}

/**
 * A pact's public page: the seller's teaser (with pictures and video) and a request-for-access
 * form. Nothing here comes from the pact itself; the buyer sees more only after the seller
 * approves them and they sign the NDA.
 */
export default async function PublicListingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const listing = await publicListing(slug);
  if (!listing) notFound();
  return (
    <ListingPage listing={listing} imageHref={(id) => `/listings/${slug}/media/${id}`}>
      {query.sent ? (
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>We sent a link to confirm your address. Your request reaches the seller once you confirm it. The seller reviews every request; if they approve, you get an invitation to sign the NDA and see more.</CardDescription>
        </CardHeader>
      ) : (
        <RequestForm action={requestAccess.bind(null, slug)} {...(query.error && ERRORS[query.error] ? { error: ERRORS[query.error] } : {})} />
      )}
    </ListingPage>
  );
}
