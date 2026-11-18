import { describe, expect, it } from 'vitest';
import { ImfMacroForecastProvider } from '../market/macro-forecasts';

// Live check of the IMF DataMapper API (T-094 B10); runs only with INTEGRATION_LIVE=1, never in the PR gate.
// The IMF answers GitHub's hosted runners with 403 text/html (datacenter addresses, T-137), so it is skipped
// there. Live checks the IMF itself, from its own network (Admin → Health, operator alert email).
const onHostedRunner = process.env['GITHUB_ACTIONS'] === 'true';
describe.skipIf(process.env['INTEGRATION_LIVE'] !== '1' || onHostedRunner)('IMF DataMapper (live)', () => {
  it('returns five years of inflation and GDP forecasts for the US, the euro area and the UK', async () => {
    const provider = new ImfMacroForecastProvider();
    const years = [2027, 2028, 2029, 2030, 2031];
    for (const indicator of ['PCPIPCH', 'NGDP_RPCH']) {
      for (const area of ['USA', 'EURO', 'GBR']) {
        const result = await provider.forecast(indicator, area, years);
        let probe = '';
        if (result.status === 'UNAVAILABLE') {
          // Diagnostic only: status line and content type, never the body.
          probe = await fetch(`https://www.imf.org/external/datamapper/api/v2/${indicator}/${area}?periods=${years.join(',')}`, { redirect: 'manual', headers: { accept: 'application/json' } })
            .then((r) => ` [probe ${r.status} ${r.headers.get('content-type') ?? ''} ${r.headers.get('location') ?? ''}]`)
            .catch((e: unknown) => ` [probe threw ${e instanceof Error ? `${e.name}: ${e.message}` : 'unknown'}]`);
        }
        expect(result.status, `${indicator}/${area}: ${result.status === 'UNAVAILABLE' ? result.reason : ''}${probe}`).toBe('OK');
        if (result.status === 'OK') {
          expect(Object.keys(result.series.values)).toHaveLength(5);
          expect(result.series.sourceName).toMatch(/^IMF World Economic Outlook/);
        }
      }
    }
  }, 60_000);
});
