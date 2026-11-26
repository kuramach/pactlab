import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cassetteFetch, type Cassette, type FetchLike } from '../http/cassette';
import { FixtureMarketRentProvider, FixturePropertyProvider, rentCastEstimate, RentCastMarketRentProvider, RentCastPropertyProvider } from './index';

/** A recorded RentCast response shape (from the API reference), trimmed. */
const RECORD = {
  id: '5500-Grand-Lake-Dr,-San-Antonio,-TX-78244',
  formattedAddress: '5500 Grand Lake Dr, San Antonio, TX 78244',
  propertyType: 'Apartment',
  yearBuilt: 1987,
  squareFootage: 42500,
  lotSize: 87120,
  lastSalePrice: 6200000,
  lastSaleDate: '2019-05-14T00:00:00.000Z',
  features: { unitCount: 48, floorCount: 4 },
  owner: { names: ['Somebody Holdings LLC'] },
  taxAssessments: { '2025': { value: 5100000 } },
};

const scripted = (status: number, body: unknown) => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, headers: init?.headers ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, requests };
};

describe('RentCast property lookup (batch 2)', () => {
  it('asks by address with the key header and proposes building facts only', async () => {
    const { fetchImpl, requests } = scripted(200, [RECORD]);
    const result = await new RentCastPropertyProvider('rc-key', fetchImpl).lookup('5500 Grand Lake Dr, San Antonio, TX 78244', 'US');
    expect(requests[0]?.url).toBe('https://api.rentcast.io/v1/properties?address=5500+Grand+Lake+Dr%2C+San+Antonio%2C+TX+78244&limit=1');
    expect(requests[0]?.headers['X-Api-Key']).toBe('rc-key');
    expect(result?.formattedAddress).toBe('5500 Grand Lake Dr, San Antonio, TX 78244');
    expect(result?.facts.map((fact) => [fact.label, fact.value])).toEqual([
      ['Property type', 'Apartment'],
      ['Units', '48'],
      ['Floors', '4'],
      ['Year built', '1987'],
      ['Building area', '42,500 sq ft'],
      ['Lot size', '87,120 sq ft'],
      ['Last sale', 'USD 6,200,000 (2019-05-14)'],
    ]);
    // Owner names and tax details are never proposed.
    expect(JSON.stringify(result)).not.toContain('Somebody Holdings');
    expect(result?.facts.every((fact) => fact.source === 'RentCast')).toBe(true);
  });

  it('says plainly when there is no record, the key is refused, or the rate limit is hit', async () => {
    await expect(new RentCastPropertyProvider('k', scripted(200, []).fetchImpl).lookup('1 Nowhere Rd, Austin, TX 78701', 'US')).resolves.toBeNull();
    await expect(new RentCastPropertyProvider('k', scripted(401, {}).fetchImpl).lookup('a b c d e', 'US')).rejects.toMatchObject({ kind: 'AUTH' });
    await expect(new RentCastPropertyProvider('k', scripted(429, {}).fetchImpl).lookup('a b c d e', 'US')).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    await expect(new RentCastPropertyProvider('k', scripted(200, [RECORD]).fetchImpl).lookup('10 Downing St, London', 'GB')).resolves.toBeNull();
  });

  it('has a synthetic fixture for dev and demos', async () => {
    const result = await new FixturePropertyProvider().lookup('12 Harbour Road, Leeds', 'GB');
    expect(result?.facts.find((fact) => fact.key === 'units')?.value).toBe('48');
  });
});

describe('RentCast market rents (T-158)', () => {
  const cassette = JSON.parse(readFileSync(new URL('../../../../fixtures/cassettes/rentcast/rent-long-term-synthetic.json', import.meta.url), 'utf8')) as Cassette;
  const request = { address: '500 Example Ave, Austin, TX 78701', propertyType: 'Apartment' as const, bathrooms: null, compCount: 15 };

  it('asks for one floor plan with the key header and reads the estimate as decimals (cassette)', async () => {
    const replay = cassetteFetch(cassette);
    let key = '';
    const provider = new RentCastMarketRentProvider('rc-key', async (url, init) => {
      key = init?.headers?.['X-Api-Key'] ?? '';
      return replay(url, init);
    });
    const estimate = await provider.estimateRent({ ...request, bedrooms: 2, squareFootage: 960 });
    expect(key).toBe('rc-key');
    expect(replay.requests).toEqual(['GET /v1/avm/rent/long-term?address=500 Example Ave, Austin, TX 78701&bedrooms=2&compCount=15&propertyType=Apartment&squareFootage=960']);
    expect(estimate).toMatchObject({ currency: 'USD', rent: '1985.50', rentRangeLow: '1890.00', rentRangeHigh: '2081.00' });
    expect(estimate?.comparables).toHaveLength(3);
    expect(estimate?.comparables[0]).toEqual({ formattedAddress: '1200 Sample St, Austin, TX 78702', price: '1940.00', distance: '0.31', correlation: '0.9810', bedrooms: 2, bathrooms: 1, squareFootage: 960 });
  });

  it('reads "no comparables" as no estimate, and a rate limit or refused key as an error (cassette)', async () => {
    const provider = new RentCastMarketRentProvider('k', cassetteFetch(cassette));
    await expect(provider.estimateRent({ ...request, bedrooms: 4, squareFootage: 1500 })).resolves.toBeNull();
    await expect(provider.estimateRent({ ...request, bedrooms: 3, squareFootage: 1180 })).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    await expect(new RentCastMarketRentProvider('k', scripted(401, {}).fetchImpl).estimateRent({ ...request, bedrooms: 1, squareFootage: 690 })).rejects.toMatchObject({ kind: 'AUTH' });
    expect(rentCastEstimate({ rent: 1500 })).toBeNull();
  });

  it('has a deterministic fixture: same plan, same estimate, a ±6% range and the comparables asked for', async () => {
    const fixture = new FixtureMarketRentProvider();
    const first = await fixture.estimateRent({ ...request, bedrooms: 1, squareFootage: 690 });
    expect(first).toMatchObject({ rent: '1795.00', rentRangeLow: '1687.30', rentRangeHigh: '1902.70' });
    expect(first?.comparables).toHaveLength(15);
    expect(await fixture.estimateRent({ ...request, bedrooms: 1, squareFootage: 690 })).toEqual(first);
    expect(fixture.requests).toHaveLength(2);
  });
});
