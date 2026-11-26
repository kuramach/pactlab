import { Decimal } from 'decimal.js';
import type { MarketRentProvider, PropertyCountry, PropertyDataProvider, PropertyLookup, RentComparable, RentEstimate, RentEstimateRequest } from './types';

/** The fixture provider (dev, demos, tests): a plausible synthetic apartment building for any address. */
export class FixturePropertyProvider implements PropertyDataProvider {
  readonly name = 'Fixture (synthetic)';
  readonly countries: readonly PropertyCountry[] = ['US', 'GB'];

  async lookup(address: string, country: PropertyCountry): Promise<PropertyLookup | null> {
    if (address.trim().length < 5) return null;
    const source = 'Fixture (synthetic)';
    return {
      formattedAddress: address.trim(),
      facts: [
        { key: 'property_type', label: 'Property type', value: country === 'US' ? 'Apartment' : 'Flats', source },
        { key: 'units', label: 'Units', value: '48', source },
        { key: 'floors', label: 'Floors', value: '4', source },
        { key: 'year_built', label: 'Year built', value: '1987', source },
        { key: 'building_area', label: 'Building area', value: country === 'US' ? '42,500 sq ft' : '3,950 sq m', source },
        { key: 'last_sale', label: 'Last sale', value: country === 'US' ? 'USD 6,200,000 (2019-05-14)' : 'GBP 4,100,000 (2019-05-14)', source },
      ],
    };
  }
}

/**
 * The fixture market-rent provider (dev, demos, tests; T-158): a deterministic synthetic estimate for any address,
 * from the floor plan alone — USD 1,000 + 400 a bedroom + 50 a bathroom + 0.5 a square foot, a ±6% range and
 * fifteen synthetic comparables. Same request, same answer; no network.
 */
export class FixtureMarketRentProvider implements MarketRentProvider {
  readonly name = 'RentCast (fixture, synthetic)';
  readonly version = 'rentcast-rent-fixture-1';
  readonly mode = 'FIXTURE' as const;
  /** Requests answered, for tests that count calls. */
  readonly requests: RentEstimateRequest[] = [];

  async estimateRent(request: RentEstimateRequest): Promise<RentEstimate | null> {
    this.requests.push(request);
    if (request.address.trim().length < 5) return null;
    const rent = new Decimal(1000)
      .plus(new Decimal(400).times(request.bedrooms))
      .plus(new Decimal(50).times(request.bathrooms ?? 1))
      .plus(new Decimal(request.squareFootage ?? 700).times('0.5'))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    const comparables: RentComparable[] = Array.from({ length: Math.min(Math.max(request.compCount, 5), 25) }, (_, index) => ({
      formattedAddress: `${100 + index * 10} Fixture Lane (synthetic), Austin, TX 78701`,
      price: rent.plus((index % 5) * 20 - 40).toFixed(2),
      distance: new Decimal('0.20').plus(new Decimal('0.10').times(index)).toFixed(2),
      correlation: new Decimal('0.98').minus(new Decimal('0.01').times(index)).toFixed(4),
      bedrooms: request.bedrooms,
      bathrooms: request.bathrooms,
      squareFootage: request.squareFootage,
    }));
    return { currency: 'USD', rent: rent.toFixed(2), rentRangeLow: rent.times('0.94').toFixed(2), rentRangeHigh: rent.times('1.06').toFixed(2), comparables };
  }
}
