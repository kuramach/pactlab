import type { PropertyCountry, PropertyDataProvider, PropertyLookup } from './types';

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
