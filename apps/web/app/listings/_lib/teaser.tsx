import type { PublicListingView } from '@pactlab/contracts';
import { Badge } from '@pactlab/ui';
import { Check } from 'lucide-react';

/** "40000000.00" → "40,000,000": display only, from the decimal string (never a float). */
export function grouped(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  const digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return /^0*$/.test(fraction) ? digits : `${digits}.${fraction}`;
}

export function askingLabel(asking: PublicListingView['asking']): string | null {
  if (!asking) return null;
  return asking.high ? `${asking.currency} ${grouped(asking.low)} – ${grouped(asking.high)}` : `From ${asking.currency} ${grouped(asking.low)}`;
}

/** The title a visitor sees: the company only when the seller chose to name it. */
export const teaserTitle = (listing: Pick<PublicListingView, 'visibility' | 'publicName' | 'codename'>) =>
  listing.visibility === 'NAMED' && listing.publicName ? listing.publicName : listing.codename;

/** The public teaser, as the seller wrote it. Used on the public page and as the seller's preview. */
export function Teaser({ listing }: { listing: Omit<PublicListingView, 'slug' | 'indexable' | 'publishedAt'> }) {
  const facts = [
    ['Sector', listing.sector],
    ['Region', listing.region],
    ['Size', listing.sizeBand],
    ['Asking', askingLabel(listing.asking)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));
  return (
    <article className="flex flex-col gap-5" aria-label="Deal teaser">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{listing.visibility === 'NAMED' ? 'For sale' : 'Confidential sale'}</Badge>
          {listing.visibility === 'NAMED' ? <span className="text-sm text-muted-foreground">{listing.codename}</span> : null}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{teaserTitle(listing)}</h1>
        <p className="text-lg text-slate-text">{listing.headline}</p>
      </div>
      {facts.length > 0 ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {listing.summary ? <p className="whitespace-pre-wrap leading-relaxed">{listing.summary}</p> : null}
      {listing.highlights.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Highlights">
          {listing.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-2">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
              <span>{highlight}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
