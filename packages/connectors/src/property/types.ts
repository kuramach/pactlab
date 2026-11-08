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
