import type { ListingView } from '@pactlab/contracts';
import { isUuid } from '@pactlab/domain';
import { Card, CardContent } from '@pactlab/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../(app)/deals/_lib/api';
import { ListingPage, RequestForm } from '../../../listings/_lib/listing-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Preview — Pactlab', robots: { index: false, follow: false } };

/**
 * The seller's full-page preview of their public page, exactly as a visitor sees it, also
 * while it is a draft. Only the seller's team can open it (the API decides); the form is off.
 */
export default async function ListingPreviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuid(dealId)) notFound();
  const result = await apiGet<{ listing: ListingView | null }>(`/v1/deals/${dealId}/listing`);
  if (result.kind !== 'ok' || !result.data.listing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-sm">
            There is nothing to preview yet. <Link href={`/deals/${dealId}/listing`} className="text-indigo-ink underline">Back to the public page</Link>
          </CardContent>
        </Card>
      </main>
    );
  }
  const listing = result.data.listing;
  const banner = (
    <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <strong>Preview — {listing.status === 'PUBLISHED' ? 'this is what visitors see now' : 'not published, visitors cannot see this yet'}.</strong>
      <Link href={`/deals/${dealId}/listing`} className="underline">
        Back to editing
      </Link>
    </div>
  );
  return (
    <ListingPage listing={listing} imageHref={(id) => `/deals/${dealId}/listing/media/${id}`} banner={banner}>
      <RequestForm disabled />
    </ListingPage>
  );
}
