import { addressState, NON_DISCLOSURE_STATES, type PublicRecord } from '@pactlab/domain';
import { rentCastRecord } from './rentcast-records.adapter';
import type { PropertyPhotoImage, PropertyPhotoProvider, PropertyPhotoSet, PropertyRecordProvider } from './types';

/**
 * Synthetic RentCast records in the provider's own shape (T-188). The cassettes under `fixtures/cassettes/rentcast/`
 * replay the same bodies for the live adapter's tests; a test keeps the two identical. Fictional addresses and owners.
 */
const FULL = {
  id: '1200-Sample-St,-Columbus,-OH-43215',
  formattedAddress: '1200 Sample St, Columbus, OH 43215',
  state: 'OH',
  propertyType: 'Multi-Family',
  bedrooms: 96,
  bathrooms: 72,
  squareFootage: 42500,
  lotSize: 87120,
  yearBuilt: 1987,
  lastSaleDate: '2019-05-14T00:00:00.000Z',
  lastSalePrice: 6200000,
  ownerOccupied: false,
  features: { unitCount: 48, floorCount: 4, roomCount: 240, garage: true, garageType: 'Surface lot', garageSpaces: 60, exteriorType: 'Brick', roofType: 'Flat', foundationType: 'Slab', heating: true, heatingType: 'Central', cooling: true, coolingType: 'Central' },
  taxAssessments: { '2024': { year: 2024, value: 5100000 }, '2023': { year: 2023, value: 4950000 } },
  propertyTaxes: { '2024': { year: 2024, total: 118400 }, '2023': { year: 2023, total: 114900 } },
  history: {
    '2019-05-14': { event: 'Sale', date: '2019-05-14T00:00:00.000Z', price: 6200000 },
    '2011-02-03': { event: 'Sale', date: '2011-02-03T00:00:00.000Z', price: 4350000 },
  },
  owner: { names: ['Example Holdings LLC'], type: 'Organization', mailingAddress: { formattedAddress: 'PO Box 100, Columbus, OH 43216' } },
};

/** Texas: sale prices are not published; the record has none. */
const TEXAS = {
  id: '500-Example-Ave,-Austin,-TX-78701',
  formattedAddress: '500 Example Ave, Austin, TX 78701',
  state: 'TX',
  propertyType: 'Multi-Family',
  squareFootage: 51200,
  lotSize: 65340,
  yearBuilt: 1994,
  ownerOccupied: false,
  features: { unitCount: 60, floorCount: 3, garage: true, garageType: 'Carport', garageSpaces: 72, exteriorType: 'Stucco', roofType: 'Pitched', heating: true, heatingType: 'Central', cooling: true, coolingType: 'Central' },
  taxAssessments: { '2024': { year: 2024, value: 7200000 } },
  propertyTaxes: { '2024': { year: 2024, total: 161000 } },
  owner: { names: ['Sample Apartments LP'], type: 'Organization', mailingAddress: { formattedAddress: '9 Example Plaza, Austin, TX 78701' } },
};

/** A county with a thin record: type, year and owner only. */
const SPARSE = {
  id: '77-Thin-Record-Rd,-Smallville,-IA-50010',
  formattedAddress: '77 Thin Record Rd, Smallville, IA 50010',
  state: 'IA',
  propertyType: 'Multi-Family',
  yearBuilt: 1962,
  owner: { names: ['Thin Record Partners'], type: 'Organization' },
};

export const RENTCAST_FIXTURE_RAW = { FULL, TEXAS, SPARSE } as const;

const KEYED: readonly (readonly [string, (typeof RENTCAST_FIXTURE_RAW)[keyof typeof RENTCAST_FIXTURE_RAW]])[] = [FULL, TEXAS, SPARSE].map((raw) => [raw.formattedAddress.toLowerCase(), raw] as const);

/**
 * The fixture record provider (dev, demos, tests): the three synthetic records above by address; any other US
 * address gets the full record re-addressed, with its sale prices dropped in a non-disclosure state, as the
 * live provider would. No network.
 */
export class FixturePropertyRecordProvider implements PropertyRecordProvider {
  readonly name = 'RentCast (fixture, synthetic)';
  readonly version = 'rentcast-properties-fixture-1';
  readonly mode = 'FIXTURE' as const;
  readonly requests: string[] = [];

  async fetchRecord(address: string): Promise<PublicRecord | null> {
    this.requests.push(address);
    const text = address.trim();
    if (text.length < 5) return null;
    const known = KEYED.find(([key]) => key === text.toLowerCase());
    if (known) return rentCastRecord(known[1], text);
    const state = addressState(text);
    if (!state) return null;
    const { history: _history, lastSalePrice: _price, lastSaleDate: _date, ...rest } = FULL;
    const sales = NON_DISCLOSURE_STATES.includes(state) ? rest : FULL;
    return rentCastRecord({ ...sales, id: `fixture-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, formattedAddress: text, state }, text);
  }
}

const svg = (label: string, colour: string) =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="${colour}"/><text x="320" y="200" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff">${label}</text></svg>`);

/** The fixture photo provider: a synthetic Street View exterior and two Places photos, as SVG; no network. */
export class FixturePhotoProvider implements PropertyPhotoProvider {
  readonly name = 'Google Maps (fixture, synthetic)';
  readonly version = 'google-maps-photos-fixture-1';
  readonly mode = 'FIXTURE' as const;

  async photos(address: string): Promise<PropertyPhotoSet> {
    if (address.trim().length < 5) return { photos: [], placeName: null };
    return {
      placeName: 'Example Apartments (synthetic)',
      photos: [
        { ref: 'sv:FIXTURE_PANO_0001', kind: 'STREET_VIEW', source: 'Google Street View', capturedOn: '2024-06', attribution: null, attributionUri: null, alt: `Street View of ${address.trim()}` },
        { ref: 'pl:places/FIXTURE_PLACE/photos/FIXTURE_PHOTO_1', kind: 'PLACES', source: 'Google Maps', capturedOn: null, attribution: 'Synthetic Photographer', attributionUri: 'https://maps.google.com/maps/contrib/synthetic', alt: 'Example Apartments (synthetic) photo from Google Maps' },
        { ref: 'pl:places/FIXTURE_PLACE/photos/FIXTURE_PHOTO_2', kind: 'PLACES', source: 'Google Maps', capturedOn: null, attribution: 'Synthetic Photographer', attributionUri: null, alt: 'Example Apartments (synthetic) photo from Google Maps' },
      ],
    };
  }

  async image(ref: string): Promise<PropertyPhotoImage | null> {
    if (ref === 'sv:FIXTURE_PANO_0001') return { contentType: 'image/svg+xml', bytes: svg('Street View (synthetic)', '#3b5b7a') };
    if (ref.startsWith('pl:places/FIXTURE_PLACE/photos/')) return { contentType: 'image/svg+xml', bytes: svg('Places photo (synthetic)', '#5b7a3b') };
    return null;
  }
}
