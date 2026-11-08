import type { FetchLike } from '../http/cassette';
import { PropertyDataError, type PropertyCountry, type PropertyDataProvider, type PropertyFact, type PropertyLookup } from './types';

/**
 * RentCast property records (US), from RentCast's API reference:
 * `GET https://api.rentcast.io/v1/properties?address=Street, City, State, Zip`
 * with the key in `X-Api-Key`; the response is an array of property records
 * (`formattedAddress`, `propertyType`, `yearBuilt`, `squareFootage`, `lotSize`,
 * `lastSalePrice`, `lastSaleDate`, `features.unitCount`, `features.floorCount`, …).
 * Only building facts are proposed; owner names and tax details never are.
 */
const BASE = 'https://api.rentcast.io/v1';

interface RentCastRecord {
  formattedAddress?: string;
  propertyType?: string;
  yearBuilt?: number;
  squareFootage?: number;
  lotSize?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  features?: { unitCount?: number; floorCount?: number };
}

const grouped = (value: number) => Math.round(value).toLocaleString('en-US');

/** A RentCast record as facts, in a fixed order; missing values are left out. */
export function rentCastFacts(record: RentCastRecord): PropertyFact[] {
  const fact = (key: string, label: string, value: string | null): PropertyFact[] => (value ? [{ key, label, value, source: 'RentCast' }] : []);
  return [
    ...fact('property_type', 'Property type', record.propertyType ?? null),
    ...fact('units', 'Units', record.features?.unitCount ? grouped(record.features.unitCount) : null),
    ...fact('floors', 'Floors', record.features?.floorCount ? grouped(record.features.floorCount) : null),
    ...fact('year_built', 'Year built', record.yearBuilt ? String(record.yearBuilt) : null),
    ...fact('building_area', 'Building area', record.squareFootage ? `${grouped(record.squareFootage)} sq ft` : null),
    ...fact('lot_size', 'Lot size', record.lotSize ? `${grouped(record.lotSize)} sq ft` : null),
    ...fact(
      'last_sale',
      'Last sale',
      record.lastSalePrice ? `USD ${grouped(record.lastSalePrice)}${record.lastSaleDate ? ` (${record.lastSaleDate.slice(0, 10)})` : ''}` : null,
    ),
  ];
}

export class RentCastPropertyProvider implements PropertyDataProvider {
  readonly name = 'RentCast';
  readonly countries: readonly PropertyCountry[] = ['US'];

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async lookup(address: string, country: PropertyCountry): Promise<PropertyLookup | null> {
    if (country !== 'US') return null;
    const response = await this.fetchImpl(`${BASE}/properties?${new URLSearchParams({ address, limit: '1' })}`, { headers: { 'X-Api-Key': this.apiKey, accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new PropertyDataError('RentCast refused the API key', 'AUTH');
    if (response.status === 429) throw new PropertyDataError('RentCast rate limit reached', 'RATE_LIMITED');
    if (response.status === 404) return null;
    if (!response.ok) throw new PropertyDataError('RentCast is unavailable', 'UNAVAILABLE');
    const records = (await response.json()) as RentCastRecord[];
    const record = Array.isArray(records) ? records[0] : undefined;
    if (!record) return null;
    return { formattedAddress: record.formattedAddress ?? address, facts: rentCastFacts(record) };
  }
}
