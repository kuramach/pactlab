import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import type { FieldProvenance, ProfileField } from '@pactlab/domain';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { acceptProfile, checkProfile, findPhotos, populateProfile } from './actions';

interface Accepted {
  value: string;
  basis: 'RECORD' | 'EDITED' | 'ENTERED';
  provenance: FieldProvenance | null;
}
interface Photo {
  index: number;
  kind: 'STREET_VIEW' | 'PLACES';
  source: string;
  capturedOn: string | null;
  attribution: string | null;
  attributionUri: string | null;
  alt: string;
}
interface ProfileView {
  address: string | null;
  addressFrom: 'PACT' | 'LISTING' | null;
  metadata: { offered: boolean; note: string | null; available: boolean; source: string | null };
  photos: { available: boolean; offered: boolean; source: string | null; items: Photo[]; placeName: string | null; fetchedAt: string | null };
  referenceLabel: string;
  status: 'EMPTY' | 'PROPOSED' | 'ACCEPTED';
  proposed: ProfileField[];
  proposedFetchedAt: string | null;
  accepted: Record<string, Accepted>;
  acceptedAt: string | null;
  contradictions: { key: string; statement: string; rationale: string }[];
}

const OUTCOMES: Record<string, string> = {
  'ok-populated': 'Filled from the public record. Review each value, edit what is wrong, and accept what you keep.',
  'ok-accepted': 'Accepted. The values are now pact data, with their source attached.',
  'ok-photos': 'Photos found. They are reference material only, never evidence.',
  'address-needed': 'Enter the property’s address first.',
  'us-only': 'Public-record property data covers US addresses only (RentCast). For this address the profile stays manual and import-driven.',
  'no-record': 'The public record has nothing for that address. Check the address, or fill the profile by hand.',
  'not-started': 'Fill the profile from the address first.',
  absence: 'A field the record lacks stays "not in public record" unless you type a value of your own.',
  'nothing-kept': 'Nothing was kept. Tick the rows you want to accept.',
  'record-off': 'Property records are not set up in this environment (no RentCast key).',
  'photos-off': 'Photos are not set up in this environment (no Google Maps key).',
  busy: 'The provider is busy right now. Try again in a minute.',
  key: 'The provider refused Pactlab’s key. An administrator needs to set it again.',
  unavailable: 'The provider did not answer. Try again later.',
  forbidden: 'Only the buyer team’s analysts and lead can change the property profile.',
};
const outcomeMessages = (outcome: string | undefined): Record<string, string> => {
  const checked = outcome?.match(/^ok-checked-(\d+)$/);
  if (checked) return { [checked[0]]: checked[1] === '0' ? 'Checked against the imported rent roll. Nothing new contradicts the profile.' : `Checked. ${checked[1]} contradiction${checked[1] === '1' ? '' : 's'} raised on Seller statements; the rent roll and the profile are both unchanged.` };
  return OUTCOMES;
};
const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm';
const ABSENT = new Set(['NOT_IN_PUBLIC_RECORD', 'NOT_PUBLISHED_NON_DISCLOSURE']);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** Where a value came from, on every row it appears: the source, the record's own id and when it was fetched. */
function Provenance({ label, provenance }: { label: string; provenance: FieldProvenance }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="draft">{label}</Badge>
      {provenance.source} · record {provenance.recordId} · fetched {day(provenance.fetchedAt)}
    </span>
  );
}

/**
 * The multifamily property profile (T-188, ADR 0062): the public record proposed from the property's address
 * for the buyer team to review, edit and accept; Street View and Places photos for context. Third-party
 * reference data, never evidence: a seller document wins, and a contradiction is raised, not resolved here.
 */
export default async function PropertyPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const raw = (await searchParams)['outcome'];
  const outcome = typeof raw === 'string' ? raw : undefined;
  const result = await apiGet<ProfileView>(`/v1/deals/${dealId}/property-profile`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const label = view.referenceLabel;
  const acceptedKeys = Object.keys(view.accepted);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessages(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>{label}.</strong> Public-record values and photos are reference material for orientation. They are never diligence evidence and never enter findings; where a seller document disagrees, the document wins. Only your team sees this page.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>The address</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action={populateProfile.bind(null, dealId)} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs font-medium">
              Property address
              <input name="address" defaultValue={view.address ?? ''} placeholder="Street, City, State ZIP" maxLength={200} className={inputClass} />
            </label>
            <Button type="submit" size="sm" disabled={!view.metadata.offered || !view.metadata.available}>
              {view.status === 'EMPTY' ? 'Fill from the public record' : 'Fetch the record again'}
            </Button>
          </form>
          {view.metadata.note ? <p className="text-sm text-muted-foreground">{view.metadata.note}</p> : null}
          {!view.metadata.available ? <p className="text-sm text-muted-foreground">Property records are not set up in this environment.</p> : null}
          {view.proposedFetchedAt ? <p className="text-xs text-muted-foreground">Record fetched {day(view.proposedFetchedAt)} from {view.metadata.source ?? 'RentCast'}.</p> : null}
        </CardContent>
      </Card>

      {view.proposed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review and accept</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={acceptProfile.bind(null, dealId)} className="flex flex-col gap-3">
              <ul className="flex flex-col divide-y divide-border">
                {view.proposed.map((field) => {
                  const kept = view.accepted[field.key];
                  const absent = ABSENT.has(field.status);
                  return (
                    <li key={field.key} className="grid gap-2 py-3 sm:grid-cols-[auto_12rem_1fr]">
                      <input type="checkbox" name={`keep:${field.key}`} defaultChecked={!absent && !kept} aria-label={`Accept ${field.label}`} className="mt-2" />
                      <span className="pt-1 text-sm font-medium">{field.label}</span>
                      <span className="flex flex-col gap-1">
                        {absent ? (
                          <>
                            <span className="text-sm italic text-muted-foreground">{field.value}</span>
                            <input name={`value:${field.key}`} placeholder="Enter a value of your own (optional)" maxLength={500} className={inputClass} aria-label={`${field.label}, your own value`} />
                          </>
                        ) : (
                          <input name={`value:${field.key}`} defaultValue={kept?.value ?? field.value} maxLength={500} className={inputClass} aria-label={field.label} />
                        )}
                        <Provenance label={label} provenance={field.provenance} />
                        {kept ? (
                          <span className="text-xs">
                            <Badge variant="reviewed">Accepted{kept.basis === 'EDITED' ? ' (edited)' : kept.basis === 'ENTERED' ? ' (entered by hand)' : ''}</Badge> {kept.value}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div>
                <Button type="submit" size="sm">
                  Accept the ticked values
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {acceptedKeys.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Accepted profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
              {view.proposed
                .filter((field) => view.accepted[field.key])
                .map((field) => {
                  const kept = view.accepted[field.key] as Accepted;
                  return (
                    <div key={field.key} className="contents">
                      <dt className="text-sm font-medium">{field.label}</dt>
                      <dd className="flex flex-col text-sm">
                        {kept.value}
                        {kept.provenance ? <Provenance label={label} provenance={kept.provenance} /> : <span className="text-xs text-muted-foreground">Entered by your team</span>}
                      </dd>
                    </div>
                  );
                })}
            </dl>
            {view.contradictions.length > 0 ? (
              <div role="alert" className="flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <strong>The imported rent roll disagrees with this profile.</strong>
                {view.contradictions.map((found) => (
                  <p key={found.key}>{found.rationale}</p>
                ))}
              </div>
            ) : null}
            <form action={checkProfile.bind(null, dealId)}>
              <Button type="submit" size="sm" variant="outline">
                Check against the imported rent roll
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Illustrative only: Google Street View and Google Maps photos, shown with their source and date. Not diligence evidence.</p>
          {view.photos.items.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {view.photos.items.map((photo) => (
                <li key={photo.index} className="flex flex-col gap-1">
                  <img src={`/deals/${dealId}/property/photos/${photo.index}`} alt={photo.alt} loading="lazy" className="aspect-[8/5] w-full rounded-md border border-border object-cover" />
                  <span className="text-xs text-muted-foreground">
                    {photo.source}
                    {photo.capturedOn ? ` · image captured ${photo.capturedOn}` : ''}
                    {photo.attribution ? (
                      <>
                        {' '}
                        · Photo: {photo.attributionUri ? <a href={photo.attributionUri} rel="noreferrer noopener" target="_blank" className="underline">{photo.attribution}</a> : photo.attribution}
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{view.photos.fetchedAt ? 'Google has no photos for this address.' : 'No photos yet.'}</p>
          )}
          {view.photos.items.length > 0 ? <p className="text-xs text-muted-foreground">Imagery © Google. Photos {view.photos.placeName ? `of ${view.photos.placeName} ` : ''}from {view.photos.source ?? 'Google Maps Platform'}{view.photos.fetchedAt ? `, found ${day(view.photos.fetchedAt)}` : ''}.</p> : null}
          <form action={findPhotos.bind(null, dealId)}>
            <Button type="submit" size="sm" variant="outline" disabled={!view.address || !view.photos.offered}>
              {view.photos.items.length > 0 ? 'Find photos again' : 'Find photos'}
            </Button>
            {!view.photos.available ? <span className="ml-2 text-xs text-muted-foreground">Photos are not set up in this environment.</span> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
