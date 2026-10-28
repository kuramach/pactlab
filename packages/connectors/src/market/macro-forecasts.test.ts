import { describe, expect, it } from 'vitest';
import { FixtureMacroForecastProvider, ImfMacroForecastProvider } from './macro-forecasts';

/** A recorded-shape IMF response (values invented), so CI never calls out. */
const imfBody = {
  indicators: { PCPIPCH: { label: 'Inflation rate, average consumer prices', source: 'World Economic Outlook (October 2026)', unit: 'Annual percent change', 'last-modified': '2026-10-08 14:43:36' } },
  values: { PCPIPCH: { USA: { '2026': 3.1, '2027': 2.6, '2028': 2.2, '2029': 2.0, '2030': 2.0, '2031': 2.0 }, ZZZ: { '2027': 9 } } },
};
const respond = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('macro forecasts (T-094 B10)', () => {
  it('reads one area and the requested years from an IMF response, as decimal strings with the source', async () => {
    const calls: string[] = [];
    const provider = new ImfMacroForecastProvider((url) => {
      calls.push(url);
      return respond(200, imfBody)();
    });
    const result = await provider.forecast('PCPIPCH', 'USA', [2027, 2028, 2029, 2030, 2031]);
    expect(calls).toEqual(['https://www.imf.org/external/datamapper/api/v2/PCPIPCH/USA?periods=2027,2028,2029,2030,2031']);
    expect(result).toEqual({
      status: 'OK',
      series: {
        indicator: 'PCPIPCH',
        area: 'USA',
        values: { 2027: '2.6', 2028: '2.2', 2029: '2', 2030: '2', 2031: '2' },
        sourceName: 'IMF World Economic Outlook (October 2026)',
        sourceUrl: 'https://www.imf.org/external/datamapper/PCPIPCH@WEO/USA',
        asOf: '2026-10-08',
      },
    });
  });

  it('reports unavailable rather than guessing: unknown area, provider error, network failure, bad codes', async () => {
    expect(await new ImfMacroForecastProvider(respond(200, imfBody)).forecast('PCPIPCH', 'GBR', [2027])).toEqual({ status: 'UNAVAILABLE', reason: 'NOT_FOUND' });
    expect(await new ImfMacroForecastProvider(respond(503, {})).forecast('PCPIPCH', 'USA', [2027])).toEqual({ status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR' });
    expect(await new ImfMacroForecastProvider(() => Promise.reject(new Error('offline'))).forecast('PCPIPCH', 'USA', [2027])).toEqual({ status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR' });
    expect(await new ImfMacroForecastProvider(respond(200, imfBody)).forecast('PCPIPCH/../x', 'USA', [2027])).toEqual({ status: 'UNAVAILABLE', reason: 'NOT_FOUND' });
  });

  it('fixture series are deterministic and labelled synthetic', async () => {
    const fixture = new FixtureMacroForecastProvider();
    const a = await fixture.forecast('PCPIPCH', 'USA', [2027, 2028, 2029, 2030, 2031]);
    expect(a).toEqual(await fixture.forecast('PCPIPCH', 'USA', [2027, 2028, 2029, 2030, 2031]));
    expect(a.status === 'OK' && a.series.sourceName).toBe('Synthetic macro forecast (fixture)');
  });
});
