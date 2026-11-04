import type { ListingMediaView, PublicListingView } from '@pactlab/contracts';
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

/** The provider's privacy-enhanced player for a video id; null for anything else. */
export function embedUrl(media: Pick<ListingMediaView, 'videoProvider' | 'videoId'>): string | null {
  if (media.videoProvider === 'YOUTUBE' && media.videoId && /^[A-Za-z0-9_-]{11}$/.test(media.videoId)) return `https://www.youtube-nocookie.com/embed/${media.videoId}`;
  if (media.videoProvider === 'VIMEO' && media.videoId && /^[0-9]{1,12}$/.test(media.videoId)) return `https://player.vimeo.com/video/${media.videoId}?dnt=1`;
  return null;
}

/** Pictures (the first large, the rest as thumbnails opening full size) and video players, in the seller's order. */
export function Media({ media, imageHref }: { media: readonly ListingMediaView[]; imageHref: (id: string) => string }) {
  const images = media.filter((item) => item.kind === 'IMAGE');
  const videos = media.filter((item) => item.kind === 'VIDEO' && embedUrl(item));
  if (images.length === 0 && videos.length === 0) return null;
  const [hero, ...thumbs] = images;
  return (
    <section className="flex flex-col gap-4" aria-label="Pictures and video">
      {hero ? (
        <figure className="flex flex-col gap-1">
          <a href={imageHref(hero.id)} target="_blank" rel="noreferrer">
            <img src={imageHref(hero.id)} alt={hero.caption ?? 'Picture of the business'} className="aspect-video w-full rounded-xl border border-border object-cover" />
          </a>
          {hero.caption ? <figcaption className="text-sm text-muted-foreground">{hero.caption}</figcaption> : null}
        </figure>
      ) : null}
      {thumbs.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="More pictures">
          {thumbs.map((item) => (
            <li key={item.id}>
              <figure className="flex flex-col gap-1">
                <a href={imageHref(item.id)} target="_blank" rel="noreferrer">
                  <img src={imageHref(item.id)} alt={item.caption ?? 'Picture of the business'} loading="lazy" className="aspect-square w-full rounded-lg border border-border object-cover" />
                </a>
                {item.caption ? <figcaption className="text-xs text-muted-foreground">{item.caption}</figcaption> : null}
              </figure>
            </li>
          ))}
        </ul>
      ) : null}
      {videos.map((item) => (
        <figure key={item.id} className="flex flex-col gap-1">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
            <iframe
              src={embedUrl(item) ?? ''}
              title={item.caption ?? 'Video'}
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allow="fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
          {item.caption ? <figcaption className="text-sm text-muted-foreground">{item.caption}</figcaption> : null}
        </figure>
      ))}
    </section>
  );
}

/** The public teaser, as the seller wrote it. Used on the public page and as the seller's preview. */
export function Teaser({ listing, imageHref }: { listing: Omit<PublicListingView, 'slug' | 'indexable' | 'publishedAt' | 'media'> & { media?: readonly ListingMediaView[] }; imageHref?: (id: string) => string }) {
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
      {listing.media && imageHref ? <Media media={listing.media} imageHref={imageHref} /> : null}
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
