import type { FetchLike } from '../http/cassette';
import { Decimal } from 'decimal.js';
import { PropertyDataError, type MarketRentProvider, type PropertyCountry, type PropertyDataProvider, type PropertyFact, type PropertyLookup, type RentComparable, type RentEstimate, type RentEstimateRequest } from './types';

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

/**
 * RentCast long-term rent estimates (T-158), from RentCast's API reference (read 2026-11-25):
 * `GET https://api.rentcast.io/v1/avm/rent/long-term` with the key in `X-Api-Key` and `address`,
 * `propertyType`, `bedrooms` (0 = studio), `bathrooms`, `squareFootage` and `compCount` (5–25). The
 * response carries `rent`, `rentRangeLow`, `rentRangeHigh`, `subjectProperty` and `comparables[]` (each
 * with `price`, `distance`, `correlation` and its own attributes). For an apartment the estimate is for one
 * unit of the attributes given. The reference documents 401 and 429 (20 requests a second per key); a
 * 400 or 404 (an address or plan with too few comparables) is read as "no estimate", anything else as unavailable.
 * Only the figures and the comparables' addresses and attributes are kept: never subject owner or tax data.
 */
interface RentCastComparable {
  formattedAddress?: string;
  price?: number;
  distance?: number;
  correlation?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
}

interface RentCastRentEstimate {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
  comparables?: RentCastComparable[];
}

/** A JSON number as a decimal string: the provider's figure as written, never float arithmetic. */
const decimal = (value: unknown, places: number): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Decimal(String(value)).toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN).toFixed(places) : null;
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** A RentCast rent-estimate response as an estimate; null when it has no rent or range. */
export function rentCastEstimate(body: RentCastRentEstimate): RentEstimate | null {
  const rent = decimal(body.rent, 2);
  const low = decimal(body.rentRangeLow, 2);
  const high = decimal(body.rentRangeHigh, 2);
  if (!rent || !low || !high) return null;
  const comparables: RentComparable[] = (Array.isArray(body.comparables) ? body.comparables : []).flatMap((comp) => {
    const price = decimal(comp.price, 2);
    return price
      ? [{
          formattedAddress: typeof comp.formattedAddress === 'string' ? comp.formattedAddress.slice(0, 200) : null,
          price,
          distance: decimal(comp.distance, 2),
          correlation: decimal(comp.correlation, 4),
          bedrooms: count(comp.bedrooms),
          bathrooms: count(comp.bathrooms),
          squareFootage: count(comp.squareFootage),
        }]
      : [];
  });
  return { currency: 'USD', rent, rentRangeLow: low, rentRangeHigh: high, comparables };
}

export class RentCastMarketRentProvider implements MarketRentProvider {
  readonly name = 'RentCast';
  readonly version = 'rentcast-rent-avm-1';
  readonly mode = 'LIVE' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async estimateRent(request: RentEstimateRequest): Promise<RentEstimate | null> {
    const query = new URLSearchParams({ address: request.address, propertyType: request.propertyType, bedrooms: String(request.bedrooms), compCount: String(request.compCount) });
    if (request.bathrooms !== null) query.set('bathrooms', String(request.bathrooms));
    if (request.squareFootage !== null) query.set('squareFootage', String(request.squareFootage));
    const response = await this.fetchImpl(`${BASE}/avm/rent/long-term?${query}`, { headers: { 'X-Api-Key': this.apiKey, accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new PropertyDataError('RentCast refused the API key', 'AUTH');
    if (response.status === 429) throw new PropertyDataError('RentCast rate limit reached', 'RATE_LIMITED');
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new PropertyDataError('RentCast is unavailable', 'UNAVAILABLE');
    return rentCastEstimate((await response.json()) as RentCastRentEstimate);
  }
}
