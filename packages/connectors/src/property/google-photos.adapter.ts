import type { FetchLike } from '../http/cassette';
import { PropertyDataError, type PropertyPhoto, type PropertyPhotoImage, type PropertyPhotoProvider, type PropertyPhotoSet } from './types';

/**
 * Google Maps Platform photos (T-188), pay-as-you-go, one key (`GOOGLE_MAPS_API_KEY`), from Google's references
 * (Street View Static API metadata + image, Places API (New) Text Search + Place Photos media), read 2026-11-27:
 * - `GET maps.googleapis.com/maps/api/streetview/metadata?location=…&key=…` → `{ status, pano_id, date: "YYYY-MM" }`
 *   (the metadata call is not billed); `GET …/streetview?size=…&pano=…&key=…` is the image.
 * - `POST places.googleapis.com/v1/places:searchText` with `X-Goog-Api-Key` and a field mask → `places[].photos[]`
 *   (`name`, `authorAttributions[]{displayName,uri}`); `GET places.googleapis.com/v1/{name}/media?maxWidthPx=…&key=…` is the image.
 * Photos are illustrative reference material shown with their source, date and the attribution Google requires.
 * Image bytes are fetched on request and passed through; the API key never reaches a browser, and nothing is written to disk.
 */
const MAPS = 'https://maps.googleapis.com/maps/api';
const PLACES = 'https://places.googleapis.com/v1';
const MAX_PLACES_PHOTOS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PANO = /^[A-Za-z0-9_-]{10,80}$/;
const PLACE_PHOTO = /^places\/[A-Za-z0-9_-]{5,200}\/photos\/[A-Za-z0-9_-]{5,400}$/;

interface PlacesBody {
  places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; photos?: { name?: string; authorAttributions?: { displayName?: string; uri?: string }[] }[] }[];
}

/** The street number and first street word of an address, lower case: what a Places hit must share to be "the property". */
export function streetKey(address: string): string | null {
  const match = address.trim().toLowerCase().match(/^(\d+[a-z]?)\s+(?:[nsew]\.?\s+)?([a-z0-9]+)/);
  return match ? `${match[1]} ${match[2]}` : null;
}

export class GoogleMapsPhotoProvider implements PropertyPhotoProvider {
  readonly name = 'Google Maps Platform';
  readonly version = 'google-maps-photos-1';
  readonly mode = 'LIVE' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private fail(status: number): never {
    if (status === 401 || status === 403) throw new PropertyDataError('Google refused the Maps key', 'AUTH');
    if (status === 429) throw new PropertyDataError('Google Maps rate limit reached', 'RATE_LIMITED');
    throw new PropertyDataError('Google Maps is unavailable', 'UNAVAILABLE');
  }

  async photos(address: string): Promise<PropertyPhotoSet> {
    const photos: PropertyPhoto[] = [];
    const meta = await this.fetchImpl(`${MAPS}/streetview/metadata?${new URLSearchParams({ location: address, key: this.apiKey })}`, { headers: { accept: 'application/json' } });
    if (!meta.ok) this.fail(meta.status);
    const view = (await meta.json()) as { status?: string; pano_id?: string; date?: string };
    // Google's metadata status is "OK" when imagery exists; the key being refused arrives as REQUEST_DENIED.
    if (view.status === 'REQUEST_DENIED') throw new PropertyDataError('Google refused the Maps key', 'AUTH');
    if (view.status === 'OVER_QUERY_LIMIT') throw new PropertyDataError('Google Maps rate limit reached', 'RATE_LIMITED');
    if (view.status === 'OK' && view.pano_id && PANO.test(view.pano_id)) {
      photos.push({ ref: `sv:${view.pano_id}`, kind: 'STREET_VIEW', source: 'Google Street View', capturedOn: /^\d{4}-\d{2}$/.test(view.date ?? '') ? (view.date as string) : null, attribution: null, attributionUri: null, alt: `Street View of ${address}` });
    }

    const search = await this.fetchImpl(`${PLACES}/places:searchText`, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos', 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ textQuery: address, maxResultCount: 1 }),
    });
    if (!search.ok) this.fail(search.status);
    const place = ((await search.json()) as PlacesBody).places?.[0];
    const wanted = streetKey(address);
    let placeName: string | null = null;
    if (place && wanted && streetKey(place.formattedAddress ?? '') === wanted) {
      placeName = place.displayName?.text?.slice(0, 160) ?? null;
      for (const photo of (place.photos ?? []).slice(0, MAX_PLACES_PHOTOS)) {
        if (!photo.name || !PLACE_PHOTO.test(photo.name)) continue;
        const author = photo.authorAttributions?.[0];
        photos.push({ ref: `pl:${photo.name}`, kind: 'PLACES', source: 'Google Maps', capturedOn: null, attribution: author?.displayName?.slice(0, 120) ?? 'Google Maps contributor', attributionUri: author?.uri?.startsWith('https://') ? author.uri : null, alt: `${placeName ?? 'Property'} photo from Google Maps` });
      }
    }
    return { photos, placeName };
  }

  async image(ref: string): Promise<PropertyPhotoImage | null> {
    let url: string;
    if (ref.startsWith('sv:') && PANO.test(ref.slice(3))) url = `${MAPS}/streetview?${new URLSearchParams({ size: '640x400', pano: ref.slice(3), key: this.apiKey })}`;
    else if (ref.startsWith('pl:') && PLACE_PHOTO.test(ref.slice(3))) url = `${PLACES}/${ref.slice(3)}/media?${new URLSearchParams({ maxWidthPx: '800', key: this.apiKey })}`;
    else return null;
    const response = await this.fetchImpl(url, { redirect: 'follow' });
    if (response.status === 404) return null;
    if (!response.ok) this.fail(response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) throw new PropertyDataError('Google Maps returned something other than an image', 'UNAVAILABLE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new PropertyDataError('Google Maps returned an oversized image', 'UNAVAILABLE');
    return { contentType, bytes };
  }
}
