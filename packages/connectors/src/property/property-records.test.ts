import { readFileSync } from 'node:fs';
import { NOT_IN_RECORD, NOT_PUBLISHED, profileFields } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { cassetteFetch, type Cassette, type FetchLike } from '../http/cassette';
import { FixturePhotoProvider, FixturePropertyRecordProvider, GoogleMapsPhotoProvider, RENTCAST_FIXTURE_RAW, RentCastPropertyRecordProvider, rentCastRecord, streetKey } from './index';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../../fixtures/cassettes/${name}`, import.meta.url), 'utf8')) as Cassette;
const rentcast = load('rentcast/properties-synthetic.json');
const google = load('google-maps/photos-synthetic.json');
const FETCHED = '2026-11-27T12:00:00.000Z';
const field = (fields: ReturnType<typeof profileFields>, key: string) => fields.find((f) => f.key === key);

describe('RentCast property records (T-188)', () => {
  it('searches by address then reads the record by its own id, with the key header (cassette)', async () => {
    const replay = cassetteFetch(rentcast);
    let key = '';
    const provider = new RentCastPropertyRecordProvider('rc-key', async (url, init) => {
      key = init?.headers?.['X-Api-Key'] ?? '';
      return replay(url, init);
    });
    const record = await provider.fetchRecord('1200 Sample St, Columbus, OH 43215');
    expect(key).toBe('rc-key');
    expect(replay.requests).toEqual(['GET /v1/properties?address=1200 Sample St, Columbus, OH 43215&limit=1', 'GET /v1/properties/1200-Sample-St%2C-Columbus%2C-OH-43215']);
    const fields = profileFields(record!, FETCHED);
    expect(fields.map((f) => [f.key, f.value])).toEqual([
      ['property_type', 'Multi-Family'], ['living_area', '42,500 sq ft'], ['lot_size', '87,120 sq ft'], ['year_built', '1987'], ['unit_count', '48'], ['floors', '4'],
      ['rooms', '96 bedrooms, 72 bathrooms, 240 rooms'], ['parking', 'Surface lot, 60 spaces'], ['construction', 'Exterior: Brick; Roof: Flat; Foundation: Slab'],
      ['heating_cooling', 'Heating: Central; Cooling: Central'], ['tax_assessments', '2024: USD 5,100,000; 2023: USD 4,950,000'], ['tax_history', '2024: USD 118,400; 2023: USD 114,900'],
      ['last_sale', 'USD 6,200,000 (2019-05-14)'], ['sale_history', '2019-05-14: USD 6,200,000; 2011-02-03: USD 4,350,000'],
      ['owner_name', 'Example Holdings LLC'], ['owner_type', 'Organization'], ['owner_mailing', 'PO Box 100, Columbus, OH 43216'], ['owner_occupied', 'No'],
    ]);
    // Per-field provenance: source, the record's own id, fetched-at, and the reference-data label.
    expect(fields.every((f) => f.provenance.source === 'RentCast public record' && f.provenance.recordId === '1200-Sample-St,-Columbus,-OH-43215' && f.provenance.fetchedAt === FETCHED && f.provenance.label === 'Third-party reference data')).toBe(true);
  });

  it('shows a Texas record’s sale price as not published, never zero or an estimate (cassette)', async () => {
    const record = await new RentCastPropertyRecordProvider('k', cassetteFetch(rentcast)).fetchRecord('500 Example Ave, Austin, TX 78701');
    const fields = profileFields(record!, FETCHED);
    expect(field(fields, 'last_sale')).toMatchObject({ value: NOT_PUBLISHED, status: 'NOT_PUBLISHED_NON_DISCLOSURE' });
    expect(field(fields, 'sale_history')).toMatchObject({ value: NOT_PUBLISHED, status: 'NOT_PUBLISHED_NON_DISCLOSURE' });
    expect(field(fields, 'unit_count')?.value).toBe('60');
    expect(JSON.stringify(fields)).not.toMatch(/USD 0\b/);
  });

  it('shows a sparse record’s missing fields as not in public record, never blank or guessed (cassette)', async () => {
    const record = await new RentCastPropertyRecordProvider('k', cassetteFetch(rentcast)).fetchRecord('77 Thin Record Rd, Smallville, IA 50010');
    const fields = profileFields(record!, FETCHED);
    expect(field(fields, 'year_built')).toMatchObject({ value: '1962', status: 'PRESENT' });
    for (const key of ['living_area', 'lot_size', 'unit_count', 'tax_assessments', 'last_sale', 'sale_history', 'owner_mailing', 'owner_occupied']) {
      expect(field(fields, key), key).toMatchObject({ value: NOT_IN_RECORD, status: 'NOT_IN_PUBLIC_RECORD' });
    }
  });

  it('reads no result as null and a refused key or rate limit as an error', async () => {
    await expect(new RentCastPropertyRecordProvider('k', cassetteFetch(rentcast)).fetchRecord('1 Nowhere Rd, Austin, TX 78701')).resolves.toBeNull();
    const status = (code: number): FetchLike => async () => new Response('{}', { status: code });
    await expect(new RentCastPropertyRecordProvider('k', status(401)).fetchRecord('a b c d e')).rejects.toMatchObject({ kind: 'AUTH' });
    await expect(new RentCastPropertyRecordProvider('k', status(429)).fetchRecord('a b c d e')).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    await expect(new RentCastPropertyRecordProvider('k', status(500)).fetchRecord('a b c d e')).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('keeps the fixture records identical to the cassette bodies', () => {
    const bodies = rentcast.interactions.filter((entry) => entry.request.path.startsWith('/v1/properties/')).map((entry) => entry.response.body);
    expect(bodies).toEqual([RENTCAST_FIXTURE_RAW.FULL, RENTCAST_FIXTURE_RAW.TEXAS, RENTCAST_FIXTURE_RAW.SPARSE]);
  });

  it('serves the fixture by address; another Texas address loses its sale prices; a non-US address has none', async () => {
    const fixture = new FixturePropertyRecordProvider();
    expect((await fixture.fetchRecord('500 Example Ave, Austin, TX 78701'))?.sales).toEqual([]);
    expect((await fixture.fetchRecord('9 Other Rd, Dallas, TX 75001'))?.sales).toEqual([]);
    expect((await fixture.fetchRecord('9 Other Rd, Akron, OH 44301'))?.sales.length).toBeGreaterThan(0);
    expect(await fixture.fetchRecord('12 Harbour Road, Leeds')).toBeNull();
    expect(rentCastRecord({}, 'x')).toBeNull();
  });
});

describe('Google Maps photos (T-188)', () => {
  const address = '1200 Sample St, Columbus, OH 43215';

  it('finds the Street View exterior with its capture date and the Places photos with attribution (cassette)', async () => {
    const replay = cassetteFetch(google);
    const set = await new GoogleMapsPhotoProvider('test-key', replay).photos(address);
    expect(set.placeName).toBe('Example Apartments');
    expect(set.photos[0]).toMatchObject({ kind: 'STREET_VIEW', source: 'Google Street View', capturedOn: '2024-06', ref: 'sv:FIXTURE_PANO_0001' });
    expect(set.photos[1]).toMatchObject({ kind: 'PLACES', source: 'Google Maps', attribution: 'Synthetic Photographer', attributionUri: 'https://maps.google.com/maps/contrib/synthetic' });
    // The key never appears in what the browser is given.
    expect(JSON.stringify(set)).not.toContain('test-key');
  });

  it('does not attach Places photos when the place is a different building', () => {
    expect(streetKey('1200 Sample St, Columbus, OH')).toBe('1200 sample');
    expect(streetKey('1200 N Sample St')).toBe('1200 sample');
    expect(streetKey('1400 Sample St')).not.toBe(streetKey('1200 Sample St'));
  });

  it('streams image bytes server-side and rejects unknown refs and non-images', async () => {
    const urls: string[] = [];
    const image: FetchLike = async (url) => {
      urls.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    };
    const provider = new GoogleMapsPhotoProvider('secret', image);
    expect((await provider.image('sv:FIXTURE_PANO_0001'))?.bytes.byteLength).toBe(3);
    expect(urls[0]).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/streetview\?/);
    expect(await provider.image('pl:places/../../etc/passwd')).toBeNull();
    expect(await provider.image('https://evil.example/x')).toBeNull();
    const html: FetchLike = async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(new GoogleMapsPhotoProvider('k', html).image('sv:FIXTURE_PANO_0001')).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    const denied: FetchLike = async () => new Response('{"status":"REQUEST_DENIED"}', { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(new GoogleMapsPhotoProvider('k', denied).photos(address)).rejects.toMatchObject({ kind: 'AUTH' });
  });

  it('has a synthetic fixture with the same shape', async () => {
    const fixture = new FixturePhotoProvider();
    const set = await fixture.photos(address);
    expect(set.photos.map((photo) => photo.kind)).toEqual(['STREET_VIEW', 'PLACES', 'PLACES']);
    expect((await fixture.image(set.photos[0]!.ref))?.contentType).toBe('image/svg+xml');
    expect(await fixture.image('sv:other')).toBeNull();
  });
});
