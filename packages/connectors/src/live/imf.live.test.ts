import { describe, expect, it } from 'vitest';
import { ImfMacroForecastProvider } from '../market/macro-forecasts';

// Live check of the IMF DataMapper API (T-094 B10); runs only with INTEGRATION_LIVE=1 (`pnpm test:live`), never in CI.
describe.skipIf(process.env['INTEGRATION_LIVE'] !== '1')('IMF DataMapper (live)', () => {
  it('returns five years of inflation and GDP forecasts for the US, the euro area and the UK', async () => {
    const provider = new ImfMacroForecastProvider();
    const years = [2027, 2028, 2029, 2030, 2031];
    for (const indicator of ['PCPIPCH', 'NGDP_RPCH']) {
      for (const area of ['USA', 'EURO', 'GBR']) {
        const result = await provider.forecast(indicator, area, years);
        expect(result.status, `${indicator}/${area}`).toBe('OK');
        if (result.status === 'OK') {
          expect(Object.keys(result.series.values)).toHaveLength(5);
          expect(result.series.sourceName).toMatch(/^IMF World Economic Outlook/);
        }
      }
    }
  }, 60_000);
});
