import type { PublicRecord } from '@pactlab/domain';
import { Decimal } from 'decimal.js';
import type { FetchLike } from '../http/cassette';
import { PropertyDataError, type PropertyRecordProvider } from './types';

/**
 * RentCast property records (T-188), from RentCast's API reference (read 2026-11-27):
 * `GET https://api.rentcast.io/v1/properties?address=…` (an array of records) and `GET /v1/properties/{id}`
 * (one record), key in `X-Api-Key`. A record carries `id`, `formattedAddress`, `state`, `propertyType`,
 * `squareFootage`, `lotSize`, `yearBuilt`, `bedrooms`, `bathrooms`, `features{}` (`unitCount`, `floorCount`,
 * `roomCount`, `garage*`, `exteriorType`, `roofType`, `foundationType`, `heating*`, `cooling*`),
 * `taxAssessments{year→{year,value}}`, `propertyTaxes{year→{year,total}}`, `history{date→{event,date,price}}`,
 * `lastSaleDate`, `lastSalePrice`, `owner{names[],type,mailingAddress{formattedAddress}}` and `ownerOccupied`.
 * Coverage varies by county: every field is optional and an absent one stays absent.
 */
const BASE = 'https://api.rentcast.io/v1';

interface RawRecord {
  id?: string;
  formattedAddress?: string;
  state?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  ownerOccupied?: boolean;
  features?: Record<string, unknown>;
  taxAssessments?: Record<string, { year?: number; value?: number }>;
  propertyTaxes?: Record<string, { year?: number; total?: number }>;
  history?: Record<string, { event?: string; date?: string; price?: number }>;
  owner?: { names?: string[]; type?: string; mailingAddress?: { formattedAddress?: string } };
}

const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const text = (value: unknown, max = 200): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
/** A JSON number as a decimal string: the provider's figure as written, never float arithmetic. */
const amount = (value: unknown): string | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? new Decimal(String(value)).toFixed() : null);
const words = (parts: readonly (string | null)[]) => {
  const present = parts.filter((part): part is string => part !== null);
  return present.length ? present.join('; ') : null;
};

/** A RentCast record as the domain's normalized public record. */
export function rentCastRecord(raw: RawRecord, fallbackAddress: string): PublicRecord | null {
  const id = text(raw.id, 120);
  if (!id) return null;
  const features = raw.features ?? {};
  const garage = features['garage'] === true ? [text(features['garageType']), positive(features['garageSpaces']) ? `${positive(features['garageSpaces'])} spaces` : null].filter(Boolean).join(', ') || 'Garage' : null;
  const sales = [
    ...Object.values(raw.history ?? {}).flatMap((entry) => (entry.event === 'Sale' && text(entry.date) ? [{ date: text(entry.date) as string, price: amount(entry.price) }] : [])),
  ];
  if (sales.length === 0 && text(raw.lastSaleDate)) sales.push({ date: text(raw.lastSaleDate) as string, price: amount(raw.lastSalePrice) });
  return {
    id,
    formattedAddress: text(raw.formattedAddress) ?? fallbackAddress,
    state: text(raw.state, 2),
    propertyType: text(raw.propertyType, 60),
    squareFootage: positive(raw.squareFootage),
    lotSize: positive(raw.lotSize),
    yearBuilt: positive(raw.yearBuilt),
    unitCount: positive(features['unitCount']),
    floorCount: positive(features['floorCount']),
    roomCount: positive(features['roomCount']),
    bedroomCount: positive(raw.bedrooms),
    bathroomCount: positive(raw.bathrooms),
    parking: garage,
    construction: words([text(features['exteriorType']) && `Exterior: ${text(features['exteriorType'])}`, text(features['roofType']) && `Roof: ${text(features['roofType'])}`, text(features['foundationType']) && `Foundation: ${text(features['foundationType'])}`]),
    heatingCooling: words([text(features['heatingType']) && `Heating: ${text(features['heatingType'])}`, text(features['coolingType']) && `Cooling: ${text(features['coolingType'])}`]),
    taxAssessments: Object.entries(raw.taxAssessments ?? {}).flatMap(([year, row]) => (amount(row.value) ? [{ year: String(row.year ?? year), value: amount(row.value) as string }] : [])),
    propertyTaxes: Object.entries(raw.propertyTaxes ?? {}).flatMap(([year, row]) => (amount(row.total) ? [{ year: String(row.year ?? year), total: amount(row.total) as string }] : [])),
    sales,
    owner: raw.owner ? { names: (raw.owner.names ?? []).flatMap((name) => text(name, 120) ?? []), type: text(raw.owner.type, 60), mailingAddress: text(raw.owner.mailingAddress?.formattedAddress), ownerOccupied: typeof raw.ownerOccupied === 'boolean' ? raw.ownerOccupied : null } : null,
  };
}

export class RentCastPropertyRecordProvider implements PropertyRecordProvider {
  readonly name = 'RentCast';
  readonly version = 'rentcast-properties-1';
  readonly mode = 'LIVE' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async get(path: string): Promise<unknown | null> {
    const response = await this.fetchImpl(`${BASE}${path}`, { headers: { 'X-Api-Key': this.apiKey, accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new PropertyDataError('RentCast refused the API key', 'AUTH');
    if (response.status === 429) throw new PropertyDataError('RentCast rate limit reached', 'RATE_LIMITED');
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new PropertyDataError('RentCast is unavailable', 'UNAVAILABLE');
    return response.json();
  }

  async fetchRecord(address: string) {
    const found = await this.get(`/properties?${new URLSearchParams({ address, limit: '1' })}`);
    const first = Array.isArray(found) ? (found[0] as RawRecord | undefined) : undefined;
    if (!first?.id) return null;
    // The record by its own id carries the full detail; the search hit is the fallback.
    const detail = await this.get(`/properties/${encodeURIComponent(first.id)}`);
    const raw = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as RawRecord) : first;
    return rentCastRecord(raw, address);
  }
}
