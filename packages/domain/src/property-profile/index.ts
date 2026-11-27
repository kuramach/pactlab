import { toScaled, FACTOR } from '../pricing/decimal';

/**
 * The multifamily property profile (T-188, ADR 0062). A public record proposes values from the property's
 * address; a person reviews, edits and accepts them. Every proposed value carries where it came from, the
 * record's own identifiers and when it was fetched, and is third-party reference data, never diligence
 * evidence: where a seller document or import contradicts it, the document wins and the contradiction is a
 * finding input (a claim), never an overwrite.
 */

export const REFERENCE_DATA_LABEL = 'Third-party reference data';
export const RECORD_SOURCE = 'RentCast public record';
export const NOT_IN_RECORD = 'not in public record';
export const NOT_PUBLISHED = 'sale price not published (non-disclosure state)';

/** US states that do not publish sale prices in public records (a display rule, not legal advice). */
export const NON_DISCLOSURE_STATES: readonly string[] = ['AK', 'ID', 'KS', 'LA', 'MS', 'MO', 'MT', 'NM', 'ND', 'TX', 'UT', 'WY'];

export interface PublicRecordOwner {
  names: readonly string[];
  type: string | null;
  mailingAddress: string | null;
  ownerOccupied: boolean | null;
}

/** A property record as normalized from the provider; every field is optional because coverage varies by county. */
export interface PublicRecord {
  /** The record's own identifier at the provider. */
  id: string;
  formattedAddress: string;
  state: string | null;
  propertyType: string | null;
  squareFootage: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  unitCount: number | null;
  floorCount: number | null;
  roomCount: number | null;
  bedroomCount: number | null;
  bathroomCount: number | null;
  parking: string | null;
  construction: string | null;
  heatingCooling: string | null;
  /** Amounts are decimal strings in USD. */
  taxAssessments: readonly { year: string; value: string }[];
  propertyTaxes: readonly { year: string; total: string }[];
  sales: readonly { date: string; price: string | null }[];
  owner: PublicRecordOwner | null;
}

export type ProfileFieldStatus = 'PRESENT' | 'NOT_IN_PUBLIC_RECORD' | 'NOT_PUBLISHED_NON_DISCLOSURE';

export interface FieldProvenance {
  source: typeof RECORD_SOURCE;
  /** "Third-party reference data": rendered wherever the value appears. */
  label: typeof REFERENCE_DATA_LABEL;
  recordId: string;
  fetchedAt: string;
}

export interface ProfileField {
  key: string;
  label: string;
  /** What is shown: the value, or the honest absence text. */
  value: string;
  status: ProfileFieldStatus;
  provenance: FieldProvenance;
}

export const PROFILE_FIELD_KEYS = [
  'property_type', 'living_area', 'lot_size', 'year_built', 'unit_count', 'floors', 'rooms', 'parking', 'construction', 'heating_cooling',
  'tax_assessments', 'tax_history', 'last_sale', 'sale_history', 'owner_name', 'owner_type', 'owner_mailing', 'owner_occupied',
] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

const LABELS: Record<ProfileFieldKey, string> = {
  property_type: 'Property type', living_area: 'Living area', lot_size: 'Lot size', year_built: 'Year built', unit_count: 'Units', floors: 'Floors',
  rooms: 'Rooms', parking: 'Parking', construction: 'Construction', heating_cooling: 'Heating and cooling',
  tax_assessments: 'Tax assessments', tax_history: 'Property taxes', last_sale: 'Last sale', sale_history: 'Sale history',
  owner_name: 'Owner', owner_type: 'Owner type', owner_mailing: 'Owner mailing address', owner_occupied: 'Owner-occupied',
};

/** Whole-number text with thousands separators, from a digit string. */
export const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const whole = (value: number) => groupDigits(String(Math.round(value)));
/** "USD 5,100,000" from a decimal string, shown to the dollar (half to even, on scaled integers; never a float). */
function money(amount: string): string {
  const scaled = toScaled(amount);
  if (scaled === null) return `USD ${amount}`;
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  let dollars = abs / FACTOR;
  const rest = abs % FACTOR;
  const half = FACTOR / 2n;
  if (rest > half || (rest === half && dollars % 2n === 1n)) dollars += 1n;
  return `USD ${negative ? '-' : ''}${groupDigits(dollars.toString())}`;
}

/** A record as the profile's fields, in a fixed order; a value the record lacks says so, it is never blank-filled or guessed. */
export function profileFields(record: PublicRecord, fetchedAt: string): ProfileField[] {
  const provenance: FieldProvenance = { source: RECORD_SOURCE, label: REFERENCE_DATA_LABEL, recordId: record.id, fetchedAt };
  const nonDisclosure = record.state !== null && NON_DISCLOSURE_STATES.includes(record.state.toUpperCase());
  const priced = record.sales.filter((sale) => sale.price !== null);
  const lastSale = [...record.sales].sort((a, b) => b.date.localeCompare(a.date))[0];
  const value = (key: ProfileFieldKey): string | null => {
    switch (key) {
      case 'property_type': return record.propertyType;
      case 'living_area': return record.squareFootage ? `${whole(record.squareFootage)} sq ft` : null;
      case 'lot_size': return record.lotSize ? `${whole(record.lotSize)} sq ft` : null;
      case 'year_built': return record.yearBuilt ? String(record.yearBuilt) : null;
      case 'unit_count': return record.unitCount ? String(record.unitCount) : null;
      case 'floors': return record.floorCount ? String(record.floorCount) : null;
      case 'rooms': {
        const parts = [
          record.bedroomCount !== null ? `${record.bedroomCount} bedrooms` : null,
          record.bathroomCount !== null ? `${record.bathroomCount} bathrooms` : null,
          record.roomCount !== null ? `${record.roomCount} rooms` : null,
        ].filter((part): part is string => part !== null);
        return parts.length ? parts.join(', ') : null;
      }
      case 'parking': return record.parking;
      case 'construction': return record.construction;
      case 'heating_cooling': return record.heatingCooling;
      case 'tax_assessments': return record.taxAssessments.length ? [...record.taxAssessments].sort((a, b) => b.year.localeCompare(a.year)).map((row) => `${row.year}: ${money(row.value)}`).join('; ') : null;
      case 'tax_history': return record.propertyTaxes.length ? [...record.propertyTaxes].sort((a, b) => b.year.localeCompare(a.year)).map((row) => `${row.year}: ${money(row.total)}`).join('; ') : null;
      case 'last_sale': return lastSale?.price ? `${money(lastSale.price)} (${lastSale.date.slice(0, 10)})` : null;
      case 'sale_history': return priced.length ? [...priced].sort((a, b) => b.date.localeCompare(a.date)).map((sale) => `${sale.date.slice(0, 10)}: ${money(sale.price as string)}`).join('; ') : null;
      case 'owner_name': return record.owner?.names.length ? record.owner.names.join(', ') : null;
      case 'owner_type': return record.owner?.type ?? null;
      case 'owner_mailing': return record.owner?.mailingAddress ?? null;
      case 'owner_occupied': return record.owner?.ownerOccupied == null ? null : record.owner.ownerOccupied ? 'Yes' : 'No';
    }
  };
  return PROFILE_FIELD_KEYS.map((key) => {
    const text = value(key);
    if (text !== null) return { key, label: LABELS[key], value: text, status: 'PRESENT' as const, provenance };
    if ((key === 'last_sale' || key === 'sale_history') && nonDisclosure) return { key, label: LABELS[key], value: NOT_PUBLISHED, status: 'NOT_PUBLISHED_NON_DISCLOSURE' as const, provenance };
    return { key, label: LABELS[key], value: NOT_IN_RECORD, status: 'NOT_IN_PUBLIC_RECORD' as const, provenance };
  });
}

/**
 * The country of a free-text address, read conservatively: a trailing US state and ZIP, or "USA" / "United States",
 * is US. Anything else is not claimed to be US, and gets no metadata lookup.
 */
export function addressCountry(address: string): 'US' | 'OTHER' {
  const text = address.trim();
  if (/\b(USA|U\.S\.A\.?|United States)\s*$/i.test(text)) return 'US';
  return /,\s*[A-Za-z]{2}\s+\d{5}(-\d{4})?\s*$/.test(text) ? 'US' : 'OTHER';
}

/** The two-letter state of a US address ("…, San Antonio, TX 78244"), or null. */
export function addressState(address: string): string | null {
  return address.match(/,\s*([A-Za-z]{2})\s+\d{5}(-\d{4})?\s*(,?\s*(USA|United States))?\s*$/i)?.[1]?.toUpperCase() ?? null;
}

export interface ProfileContradiction {
  key: 'unit_count' | 'living_area';
  statement: string;
  rationale: string;
}

/**
 * Where an import (the rent roll) contradicts an accepted profile value: the document wins; this only names the
 * contradiction so it can become a claim and a finding input. Rentable area cannot exceed the building's recorded
 * area, so only an excess is a contradiction; unit counts must agree.
 */
export function contradictionsWithRentRoll(accepted: Readonly<Record<string, string>>, rentRoll: { units: number; rentableSquareFeet: string | null }): ProfileContradiction[] {
  const out: ProfileContradiction[] = [];
  const recordUnits = accepted['unit_count'] && /^\d+$/.test(accepted['unit_count']) ? Number(accepted['unit_count']) : null;
  if (recordUnits !== null && rentRoll.units > 0 && recordUnits !== rentRoll.units) {
    out.push({
      key: 'unit_count',
      statement: `The accepted property profile (${REFERENCE_DATA_LABEL}, ${RECORD_SOURCE}) lists ${recordUnits} units`,
      rationale: `The imported rent roll lists ${rentRoll.units} units. The rent roll is the seller's document and stands; the public-record count is not changed. Ask the seller which is right.`,
    });
  }
  const recordArea = accepted['living_area']?.match(/^([\d,]+) sq ft$/);
  const rentable = rentRoll.rentableSquareFeet !== null ? toScaled(rentRoll.rentableSquareFeet) : null;
  if (recordArea && rentable !== null) {
    const area = BigInt((recordArea[1] as string).replaceAll(',', '')) * FACTOR;
    if (rentable > area) {
      out.push({
        key: 'living_area',
        statement: `The accepted property profile (${REFERENCE_DATA_LABEL}, ${RECORD_SOURCE}) lists ${recordArea[1]} sq ft of living area`,
        rationale: `The imported rent roll's rentable area totals ${groupDigits(String(rentable / FACTOR))} sq ft, more than the recorded building area. The rent roll stands; the public-record area is not changed.`,
      });
    }
  }
  return out;
}

/**
 * The rent roll's totals for the comparison: the unit count, and the rentable area when every unit states one
 * (a partial sum would understate it, so a roll with a gap yields null).
 */
export function rentRollTotals(sqftByUnit: readonly (string | null)[]): { units: number; rentableSquareFeet: string | null } {
  let total = 0n;
  for (const raw of sqftByUnit) {
    const scaled = raw === null ? null : toScaled(raw);
    if (scaled === null || scaled <= 0n) return { units: sqftByUnit.length, rentableSquareFeet: null };
    total += scaled;
  }
  const whole = total / FACTOR;
  const fraction = (total % FACTOR).toString().padStart(6, '0').replace(/0+$/, '');
  return { units: sqftByUnit.length, rentableSquareFeet: sqftByUnit.length === 0 ? null : fraction ? `${whole}.${fraction}` : String(whole) };
}
