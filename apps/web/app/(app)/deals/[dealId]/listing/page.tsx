import type { ListingInterestView, ListingView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { ExternalLink } from 'lucide-react';
import { CopyButton } from '../../../_lib/copy-button';
import { serverEnv } from '../../../../../lib/env';
import { Teaser } from '../../../../listings/_lib/teaser';
import { apiGet } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import { approveInterest, declineInterest, saveListing, setListingStatus } from './actions';

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
export default async function ListingTab({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const { dealId } = await params;
  const outcome = OUTCOMES[(await searchParams).outcome ?? ''];
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
          <CardContent>{listing ? <Teaser listing={draft} /> : <p className="text-sm text-muted-foreground">Save the teaser to preview it.</p>}</CardContent>
        </Card>
      </div>

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
