import type { PublicListingView } from '@pactlab/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PactlabLockup } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Teaser } from './teaser';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const INTENTS = [
  ['STRATEGIC', 'A company buying for strategic reasons'],
  ['FINANCIAL', 'A fund or financial buyer'],
  ['INDIVIDUAL', 'An individual buyer'],
  ['ADVISER', 'An adviser acting for a buyer'],
] as const;

/** The request-for-access form. Disabled in the seller's preview. */
export function RequestForm({ action, error, disabled = false }: { action?: (form: FormData) => Promise<void>; error?: string; disabled?: boolean }) {
  return (
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
        <form action={action} className="flex flex-col gap-3 text-sm">
          <fieldset disabled={disabled} className="flex flex-col gap-3">
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
          </fieldset>
        </form>
      </CardContent>
    </>
  );
}

/** The public page's layout: the teaser (with pictures and video) beside the request card. */
export function ListingPage({ listing, imageHref, banner, children }: { listing: Omit<PublicListingView, 'slug' | 'indexable' | 'publishedAt'>; imageHref: (id: string) => string; banner?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/40">
      {banner}
      <header className="border-b border-border bg-white px-4 py-4 sm:px-8">
        <Link href="/" aria-label="Pactlab">
          <PactlabLockup withTagline={false} />
        </Link>
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="pt-6">
            <Teaser listing={listing} imageHref={imageHref} />
          </CardContent>
        </Card>
        <Card id="request" className="h-fit">
          {children}
        </Card>
      </div>
    </main>
  );
}
