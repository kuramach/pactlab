/**
 * Property data for a teaser page (batch 2). A provider proposes facts about a
 * property from its address; the seller approves each one before anything is
 * shown, and every fact keeps where it came from.
 */
export type PropertyCountry = 'US' | 'GB';

export interface PropertyFact {
  /** Stable key, e.g. `units`, `year_built`. */
  readonly key: string;
  readonly label: string;
  /** As shown: "48", "1987", "42,500 sq ft", "USD 6,200,000 (2019-05-14)". */
  readonly value: string;
  /** e.g. "RentCast". */
  readonly source: string;
}

export interface PropertyLookup {
  readonly formattedAddress: string;
  readonly facts: readonly PropertyFact[];
}

export interface PropertyDataProvider {
  readonly name: string;
  readonly countries: readonly PropertyCountry[];
  /** The best match for the address, or null when the provider has no record. */
  lookup(address: string, country: PropertyCountry): Promise<PropertyLookup | null>;
}

export class PropertyDataError extends Error {
  constructor(
    message: string,
    readonly kind: 'AUTH' | 'RATE_LIMITED' | 'UNAVAILABLE',
  ) {
    super(message);
    this.name = 'PropertyDataError';
  }
}

/**
 * A long-term rent estimate for one floor plan of a property (T-158): what one unit of these attributes
 * rents for nearby, with the comparables it rests on. Amounts are decimal strings in USD (RentCast is US-only).
 */
export interface RentEstimateRequest {
  /** "Street, City, State, Zip". */
  readonly address: string;
  readonly propertyType: 'Apartment' | 'Multi-Family';
  /** 0 is a studio. */
  readonly bedrooms: number;
  readonly bathrooms: number | null;
  readonly squareFootage: number | null;
  /** 5–25 comparables. */
  readonly compCount: number;
}

export interface RentComparable {
  /** As the provider returns it; shown only on the citation view, never sent anywhere. */
  readonly formattedAddress: string | null;
  /** Monthly listed rent. */
  readonly price: string;
  /** Miles from the subject property. */
  readonly distance: string | null;
  /** Similarity to the subject, 0 to 1. */
  readonly correlation: string | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly squareFootage: number | null;
}

export interface RentEstimate {
  readonly currency: 'USD';
  readonly rent: string;
  readonly rentRangeLow: string;
  readonly rentRangeHigh: string;
  readonly comparables: readonly RentComparable[];
}

export interface MarketRentProvider {
  /** Shown as the figure's source, e.g. "RentCast". */
  readonly name: string;
  /** Stored as the connector version of each retrieval. */
  readonly version: string;
  readonly mode: 'LIVE' | 'FIXTURE';
  /** The estimate for one floor plan, or null when the provider has none for it (unknown address, too few comparables). */
  estimateRent(request: RentEstimateRequest): Promise<RentEstimate | null>;
}
