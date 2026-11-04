import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PactlabLockup } from '@pactlab/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publicListing } from '../_lib/api';
import { Teaser, teaserTitle } from '../_lib/teaser';
import { requestAccess } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const INTENTS = [
  ['STRATEGIC', 'A company buying for strategic reasons'],
  ['FINANCIAL', 'A fund or financial buyer'],
  ['INDIVIDUAL', 'An individual buyer'],
  ['ADVISER', 'An adviser acting for a buyer'],
] as const;
const ERRORS: Record<string, string> = {
  details: 'Fill in your name, firm, a valid email address and why you are interested, and agree to the note below the form.',
  unavailable: 'We could not send your request right now. Try again shortly.',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const listing = await publicListing((await params).slug);
  if (!listing) return { title: 'Pactlab', robots: { index: false, follow: false } };
  return {
    title: `${teaserTitle(listing)} — ${listing.headline}`,
    description: listing.headline,
    // Closed to search engines unless the seller allowed indexing.
    robots: listing.indexable ? { index: true, follow: false } : { index: false, follow: false },
    openGraph: { title: teaserTitle(listing), description: listing.headline },
  };
}

/**
 * A pact's public page: the seller's teaser and a request-for-access form. Nothing here
 * comes from the pact itself; the buyer sees more only after the seller approves them and
 * they sign the NDA.
 */
export default async function ListingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const listing = await publicListing(slug);
  if (!listing) notFound();
  const error = query.error ? ERRORS[query.error] : undefined;
  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b border-border bg-white px-4 py-4 sm:px-8">
        <Link href="/" aria-label="Pactlab">
          <PactlabLockup withTagline={false} />
        </Link>
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="pt-6">
            <Teaser listing={listing} />
          </CardContent>
        </Card>
        <Card id="request" className="h-fit">
          {query.sent ? (
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>We sent a link to confirm your address. Your request reaches the seller once you confirm it. The seller reviews every request; if they approve, you get an invitation to sign the NDA and see more.</CardDescription>
            </CardHeader>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Request access</CardTitle>
                <CardDescription>The seller reviews each request. If approved, you sign an NDA and then see the details.</CardDescription>
              </CardHeader>
              <CardContent>
                {error ? (
                  <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                    {error}
                  </p>
                ) : null}
                <form action={requestAccess.bind(null, slug)} className="flex flex-col gap-3 text-sm">
                  <label className="flex flex-col gap-1 font-medium">
                    Your name
                    <input name="name" required maxLength={120} autoComplete="name" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    Firm
                    <input name="firm" required maxLength={200} autoComplete="organization" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    Work email
                    <input name="email" type="email" required maxLength={254} autoComplete="email" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    You are
                    <select name="intent" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Choose one
                      </option>
                      {INTENTS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    Message to the seller (optional)
                    <textarea name="message" rows={3} maxLength={1000} className={inputClass} />
                  </label>
                  {/* Left empty by people; filled by bots. */}
                  <div aria-hidden className="absolute -left-[9999px]">
                    <label>
                      Website
                      <input name="website" tabIndex={-1} autoComplete="off" />
                    </label>
                  </div>
                  <label className="flex items-start gap-2 font-normal text-muted-foreground">
                    <input type="checkbox" name="consent" required className="mt-1" />
                    <span>I agree that the seller sees my name, firm, email and message to decide on my request.</span>
                  </label>
                  <Button type="submit">Send request</Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
