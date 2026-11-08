import type { ListingInterestView, ListingMediaView, ListingPropertyFact, ListingView } from '@pactlab/contracts';
import { Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { ArrowDown, ArrowUp, Eye, ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { CopyButton } from '../../../_lib/copy-button';
import { serverEnv } from '../../../../../lib/env';
import { embedUrl, Teaser } from '../../../../listings/_lib/teaser';
import { apiGet, apiSend } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import { addImages, addVideo, approveInterest, captionMedia, declineInterest, moveMedia, removeMedia, saveListing, saveProperty, setListingStatus } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const STATUS: Record<string, { label: string; variant: 'draft' | 'calculation' | 'neutral' }> = {
  DRAFT: { label: 'Draft — not public', variant: 'draft' },
  PUBLISHED: { label: 'Published', variant: 'calculation' },
  CLOSED: { label: 'Closed', variant: 'neutral' },
};
const INTENT_LABELS: Record<string, string> = { STRATEGIC: 'Strategic buyer', FINANCIAL: 'Fund / financial buyer', INDIVIDUAL: 'Individual buyer', ADVISER: 'Adviser for a buyer' };
const OUTCOMES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  'ok-saved': { tone: 'ok', text: 'Saved.' },
  'ok-property': { tone: 'ok', text: 'Property facts saved to the teaser.' },
  'ok-published': { tone: 'ok', text: 'Published. Anyone with the link can see the teaser and request access.' },
  'ok-draft': { tone: 'ok', text: 'Unpublished. The link shows nothing until you publish again.' },
  'ok-closed': { tone: 'ok', text: 'Closed. The page is offline; requests already received stay below.' },
  'ok-approved': { tone: 'ok', text: 'Approved. Their firm is now a bidder and they were emailed an invitation; they sign the NDA before seeing more.' },
  'ok-declined': { tone: 'ok', text: 'Declined. They were told by email.' },
  'name-missing': { tone: 'error', text: 'A named page needs the company name to show.' },
  'process-closed': { tone: 'error', text: 'The sale process is closed, so no new bidders can be added.' },
  invalid: { tone: 'error', text: 'Some details are missing or invalid. Check the codename, headline and asking range.' },
  conflict: { tone: 'error', text: 'That request was already decided.' },
  forbidden: { tone: 'error', text: 'Only the seller’s team can run this page.' },
  'ok-media': { tone: 'ok', text: 'Pictures and video updated.' },
  'no-file': { tone: 'error', text: 'Choose at least one picture.' },
  'image-too-large': { tone: 'error', text: 'Each picture must be 5 MB or smaller.' },
  'not-an-image': { tone: 'error', text: 'Only JPEG, PNG and WebP pictures can be added.' },
  'too-many-images': { tone: 'error', text: 'A page can have up to 8 pictures.' },
  'too-many-videos': { tone: 'error', text: 'A page can have up to 3 videos.' },
  'bad-video-link': { tone: 'error', text: 'Use a YouTube or Vimeo link, for example https://youtu.be/… or https://vimeo.com/….' },
  error: { tone: 'error', text: 'Something went wrong. Try again.' },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function MediaEditor({ dealId, media }: { dealId: string; media: readonly ListingMediaView[] }) {
  const ids = media.map((item) => item.id);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <form action={addImages.bind(null, dealId)} className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <Field label="Add pictures" hint="JPEG, PNG or WebP, up to 5 MB each, 8 in all. Location and camera details are removed.">
            <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple className="text-sm" />
          </Field>
          <Field label="Caption (for a single picture)">
            <input name="caption" maxLength={200} className={inputClass} />
          </Field>
          <Button type="submit" size="sm" variant="outline">
            Upload
          </Button>
        </form>
        <form action={addVideo.bind(null, dealId)} className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <Field label="Video link (YouTube or Vimeo)" hint="Up to 3. Shown with the provider's privacy-enhanced player.">
            <input name="url" type="url" placeholder="https://youtu.be/…" className={inputClass} />
          </Field>
          <Field label="Caption">
            <input name="caption" maxLength={200} className={inputClass} />
          </Field>
          <Button type="submit" size="sm" variant="outline">
            Add video
          </Button>
        </form>
      </div>
      {media.length > 0 ? (
        <ol className="flex flex-col gap-2" aria-label="Pictures and video on the page">
          {media.map((item, index) => {
            const video = item.kind === 'VIDEO' ? embedUrl(item) : null;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-2 text-sm">
                {item.kind === 'IMAGE' ? (
                  <img src={`/deals/${dealId}/listing/media/${item.id}`} alt={item.caption ?? 'Picture'} className="h-16 w-24 rounded object-cover" />
                ) : (
                  <span className="flex h-16 w-24 items-center justify-center rounded bg-navy text-xs font-semibold text-white">{item.videoProvider === 'VIMEO' ? 'Vimeo' : 'YouTube'}</span>
                )}
                <form action={captionMedia.bind(null, dealId, item.id)} className="flex flex-1 items-center gap-2">
                  <input name="caption" maxLength={200} defaultValue={item.caption ?? ''} placeholder="Caption" aria-label={`Caption for item ${index + 1}`} className={inputClass} />
                  <Button type="submit" size="sm" variant="ghost">
                    Save
                  </Button>
                </form>
                {video ? (
                  <a href={video} target="_blank" rel="noreferrer" className="text-xs text-indigo-ink underline">
                    Watch
                  </a>
                ) : null}
                <span className="flex gap-1">
                  <form action={moveMedia.bind(null, dealId, ids, index, -1)}>
                    <Button type="submit" size="sm" variant="ghost" disabled={index === 0} aria-label={`Move item ${index + 1} up`}>
                      <ArrowUp aria-hidden className="h-4 w-4" />
                    </Button>
                  </form>
                  <form action={moveMedia.bind(null, dealId, ids, index, 1)}>
                    <Button type="submit" size="sm" variant="ghost" disabled={index === ids.length - 1} aria-label={`Move item ${index + 1} down`}>
                      <ArrowDown aria-hidden className="h-4 w-4" />
                    </Button>
                  </form>
                  <form action={removeMedia.bind(null, dealId, item.id)}>
                    <Button type="submit" size="sm" variant="ghost" aria-label={`Remove item ${index + 1}`}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </form>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No pictures or videos yet. The first picture is shown large at the top of the page.</p>
      )}
    </div>
  );
}

function Requests({ dealId, items }: { dealId: string; items: ListingInterestView[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No requests yet. A request appears here once the visitor confirms their email address.</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Access requests">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.name}</span>
            <span className="text-muted-foreground">· {item.firm} · {item.email}</span>
            <Badge variant={item.status === 'APPROVED' ? 'calculation' : item.status === 'DECLINED' ? 'neutral' : 'draft'}>{item.status === 'NEW' ? 'New' : item.status === 'APPROVED' ? 'Approved' : 'Declined'}</Badge>
          </div>
          <p className="text-muted-foreground">{INTENT_LABELS[item.intent] ?? item.intent}{item.confirmedAt ? ` · confirmed ${item.confirmedAt.slice(0, 10)}` : ''}</p>
          {item.message ? <p className="whitespace-pre-wrap">“{item.message}”</p> : null}
          {item.status === 'NEW' ? (
            <div className="flex flex-wrap items-end gap-3">
              <form action={approveInterest.bind(null, dealId, item.id)}>
                <Button type="submit" size="sm" title={`Creates bidder ${item.firm} and emails an invitation to ${item.email}; they sign the NDA before seeing anything.`}>
                  Approve
                </Button>
              </form>
              <form action={declineInterest.bind(null, dealId, item.id)} className="flex flex-wrap items-end gap-2">
                <input name="note" maxLength={1000} placeholder="Optional note to them" className={`${inputClass} w-64`} aria-label={`Note to ${item.name}`} />
                <Button type="submit" size="sm" variant="outline">
                  Decline
                </Button>
              </form>
            </div>
          ) : item.decisionNote ? (
            <p className="text-xs text-muted-foreground">Your note: {item.decisionNote}</p>
          ) : null}
          {item.status === 'NEW' ? <p className="text-xs text-muted-foreground">Approving creates bidder “{item.firm}” and emails {item.email} an invitation; they sign the NDA before seeing anything beyond the teaser.</p> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The pact's public page: a teaser the seller writes and publishes at an unguessable link,
 * and the requests for access interested buyers leave on it.
 */
type LookupResult = Awaited<ReturnType<typeof apiSend<{ available: boolean; formattedAddress: string | null; facts: ListingPropertyFact[] }>>> | null;

/**
 * The property behind the teaser (batch 2): look its facts up by address
 * (RentCast in the US), approve the ones to show, save. The address is public
 * only on a named page; anonymous pages show the facts alone.
 */
function PropertyCard({ dealId, listing, lookupAddress, lookupCountry, lookup }: { dealId: string; listing: ListingView; lookupAddress: string; lookupCountry: 'US' | 'GB'; lookup: LookupResult }) {
  const proposals = lookup?.kind === 'ok' ? lookup.data : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Property</CardTitle>
        <CardDescription>
          Look the property up by address and choose which facts to show. {listing.visibility === 'NAMED' ? 'The address is shown on your named page.' : 'Your page is anonymous, so the address is never shown; only the facts you choose.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {listing.propertyFacts.length > 0 || listing.propertyAddress ? (
          <div className="flex flex-col gap-1">
            {listing.propertyAddress ? <span className="font-semibold">{listing.propertyAddress}</span> : null}
            <span className="text-muted-foreground">{listing.propertyFacts.map((fact) => `${fact.label}: ${fact.value}`).join(' · ') || 'No facts saved.'}</span>
          </div>
        ) : null}
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-72 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Address</span>
            <input name="address" required minLength={5} maxLength={300} defaultValue={lookupAddress || listing.propertyAddress || ''} placeholder="5500 Grand Lake Dr, San Antonio, TX 78244" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Country</span>
            <select name="country" defaultValue={lookupCountry} className={inputClass}>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
            </select>
          </label>
          <Button type="submit" size="sm" variant="outline">
            Look up
          </Button>
        </form>
        {lookup && lookup.kind !== 'ok' ? <p role="alert" className="text-amber-800">The property data service couldn’t be reached. Try again shortly.</p> : null}
        {proposals && !proposals.available ? <p className="text-muted-foreground">Property lookup isn’t available for this country here yet. You can still describe the property in the teaser.</p> : null}
        {proposals?.available && proposals.facts.length === 0 ? <p className="text-muted-foreground">No record found for that address. Check the spelling, or describe the property in the teaser.</p> : null}
        {proposals?.available && proposals.facts.length > 0 ? (
          <form action={saveProperty.bind(null, dealId)} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <input type="hidden" name="address" value={proposals.formattedAddress ?? lookupAddress} />
            <span className="font-semibold">{proposals.formattedAddress ?? lookupAddress}</span>
            <span className="text-xs text-muted-foreground">Tick the facts to show; edit any value first if it needs correcting.</span>
            {proposals.facts.map((fact, index) => (
              <div key={fact.key} className="grid items-center gap-2 sm:grid-cols-[1.5rem_10rem_1fr_8rem]">
                <input type="checkbox" name={`use-${index}`} defaultChecked aria-label={`Show ${fact.label}`} className="h-4 w-4 accent-navy" />
                <span>{fact.label}</span>
                <input name={`value-${index}`} defaultValue={fact.value} maxLength={120} className={inputClass} aria-label={`${fact.label} value`} />
                <span className="text-xs text-muted-foreground">{fact.source}</span>
                <input type="hidden" name={`fact-${index}`} value={JSON.stringify({ key: fact.key, label: fact.label, source: fact.source, retrievedAt: fact.retrievedAt })} />
              </div>
            ))}
            <Button type="submit" size="sm" className="self-start">
              Save to teaser
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function ListingTab({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<{ outcome?: string; address?: string; country?: string }> }) {
  const { dealId } = await params;
  const query = await searchParams;
  const outcome = OUTCOMES[query.outcome ?? ''];
  // A property lookup asked for (batch 2): proposals only, shown for the seller to approve.
  const lookupAddress = typeof query.address === 'string' ? query.address.trim().slice(0, 300) : '';
  const lookupCountry = query.country === 'GB' ? 'GB' : 'US';
  const lookup =
    lookupAddress.length >= 5
      ? await apiSend<{ available: boolean; formattedAddress: string | null; facts: ListingPropertyFact[] }>('POST', `/v1/deals/${dealId}/listing/property-lookup`, { address: lookupAddress, country: lookupCountry })
      : null;
  const [result, interests] = await Promise.all([apiGet<{ listing: ListingView | null }>(`/v1/deals/${dealId}/listing`), apiGet<{ items: ListingInterestView[] }>(`/v1/deals/${dealId}/listing/interests`)]);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const listing = result.data.listing;
  const link = listing ? new URL(`/listings/${listing.slug}`, serverEnv().APP_BASE_URL ?? 'http://localhost:3000').toString() : null;
  const draft = {
    visibility: listing?.visibility ?? 'ANONYMOUS',
    codename: listing?.codename ?? '',
    publicName: listing?.publicName ?? null,
    headline: listing?.headline ?? '',
    sector: listing?.sector ?? null,
    region: listing?.region ?? null,
    sizeBand: listing?.sizeBand ?? null,
    asking: listing?.asking ?? null,
    summary: listing?.summary ?? '',
    highlights: listing?.highlights ?? [],
    media: listing?.media ?? [],
    propertyAddress: listing?.propertyAddress ?? null,
    propertyFacts: listing?.propertyFacts ?? [],
  } as const;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Public page</h2>
        <p className="text-sm text-muted-foreground">Market this pact with a teaser at a private link. Interested buyers request access; you approve them as bidders, and they sign the NDA before seeing anything more. Only what you write here is ever public.</p>
      </div>
      {outcome ? (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${outcome.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {outcome.text}
        </p>
      ) : null}

      {listing && link ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
            <Badge variant={STATUS[listing.status]?.variant ?? 'neutral'}>{STATUS[listing.status]?.label ?? listing.status}</Badge>
            <span className="font-mono text-xs">{link}</span>
            <CopyButton text={link} label="Copy link" />
            {listing.status === 'PUBLISHED' ? (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-ink underline">
                Open <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <Link href={`/preview/listing/${dealId}`} target="_blank" className={`${buttonVariants({ size: 'sm', variant: 'outline' })} inline-flex items-center gap-1`}>
              <Eye aria-hidden className="h-4 w-4" /> Preview as a visitor
            </Link>
            <span className="ml-auto flex gap-2">
              {listing.status !== 'PUBLISHED' ? (
                <form action={setListingStatus.bind(null, dealId, 'PUBLISHED')}>
                  <Button type="submit" size="sm">{listing.status === 'CLOSED' ? 'Reopen' : 'Publish'}</Button>
                </form>
              ) : (
                <form action={setListingStatus.bind(null, dealId, 'DRAFT')}>
                  <Button type="submit" size="sm" variant="outline">Unpublish</Button>
                </form>
              )}
              {listing.status !== 'CLOSED' ? (
                <form action={setListingStatus.bind(null, dealId, 'CLOSED')}>
                  <Button type="submit" size="sm" variant="outline">Close</Button>
                </form>
              ) : null}
            </span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{listing ? 'Teaser' : 'Write the teaser'}</CardTitle>
            <CardDescription>Everything here becomes public when you publish. Do not include anything confidential.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveListing.bind(null, dealId)} className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1 font-medium">Show the company?</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="visibility" value="ANONYMOUS" defaultChecked={draft.visibility === 'ANONYMOUS'} /> Anonymous — only the codename
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="visibility" value="NAMED" defaultChecked={draft.visibility === 'NAMED'} /> Named — show the company name
                </label>
              </fieldset>
              <Field label="Codename" hint="e.g. Project Atlas. Shown on the page and in invitations before the NDA.">
                <input name="codename" required maxLength={80} defaultValue={draft.codename} className={inputClass} />
              </Field>
              <Field label="Company name to show" hint="Only used when the page is Named.">
                <input name="publicName" maxLength={160} defaultValue={draft.publicName ?? ''} className={inputClass} />
              </Field>
              <Field label="Headline">
                <input name="headline" required maxLength={160} defaultValue={draft.headline} className={inputClass} placeholder="Profitable workflow SaaS for logistics firms" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Sector">
                  <input name="sector" maxLength={80} defaultValue={draft.sector ?? ''} className={inputClass} />
                </Field>
                <Field label="Region">
                  <input name="region" maxLength={80} defaultValue={draft.region ?? ''} className={inputClass} />
                </Field>
                <Field label="Size" hint="A band, e.g. USD 5–10M ARR">
                  <input name="sizeBand" maxLength={80} defaultValue={draft.sizeBand ?? ''} className={inputClass} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Asking from (optional)">
                  <input name="askingLow" inputMode="decimal" defaultValue={draft.asking?.low ?? ''} className={inputClass} />
                </Field>
                <Field label="Asking to">
                  <input name="askingHigh" inputMode="decimal" defaultValue={draft.asking?.high ?? ''} className={inputClass} />
                </Field>
                <Field label="Currency">
                  <input name="askingCurrency" maxLength={3} defaultValue={draft.asking?.currency ?? 'USD'} className={inputClass} />
                </Field>
              </div>
              <Field label="Summary">
                <textarea name="summary" rows={5} maxLength={2000} defaultValue={draft.summary} className={inputClass} />
              </Field>
              <Field label="Highlights" hint="One per line, up to six.">
                <textarea name="highlights" rows={4} defaultValue={draft.highlights.join('\n')} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="indexable" defaultChecked={listing?.indexable ?? false} /> Let search engines list this page (off: only people with the link find it)
              </label>
              <Button type="submit">{listing ? 'Save' : 'Create the page'}</Button>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>What visitors see (after your last save).</CardDescription>
          </CardHeader>
          <CardContent>{listing ? <Teaser listing={draft} imageHref={(id) => `/deals/${dealId}/listing/media/${id}`} /> : <p className="text-sm text-muted-foreground">Save the teaser to preview it.</p>}</CardContent>
        </Card>
      </div>

      {listing ? <PropertyCard dealId={dealId} listing={listing} lookupAddress={lookupAddress} lookupCountry={lookupCountry} lookup={lookup} /> : null}

      {listing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pictures and video</CardTitle>
            <CardDescription>Public once the page is published. Use pictures you have the right to share.</CardDescription>
          </CardHeader>
          <CardContent>
            <MediaEditor dealId={dealId} media={listing.media} />
          </CardContent>
        </Card>
      ) : null}

      {listing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Access requests</CardTitle>
          </CardHeader>
          <CardContent>{interests.kind === 'ok' ? <Requests dealId={dealId} items={interests.data.items} /> : <ApiState result={interests} />}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
