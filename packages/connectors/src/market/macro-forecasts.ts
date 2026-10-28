import type { FetchLike } from '../http/cassette';

/**
 * Published macro forecasts for Foresight (T-094 B10). The live adapter
 * reads the IMF DataMapper API (World Economic Outlook) — public, free, no
 * credentials: GET https://www.imf.org/external/datamapper/api/v2/{indicator}/{area}
 * returns { indicators: { [id]: { label, source, unit, 'last-modified' } },
 * values: { [id]: { [area]: { [year]: number } } } } (verified 2026-10-28;
 * the service ignores the area and periods filters and returns every area,
 * about 120 KB). The fixture adapter returns invented, deterministic series
 * for tests and local work. Downstream code never branches on which is used.
 */
export interface MacroForecastSeries {
  readonly indicator: string;
  readonly area: string;
  /** Percent a year as decimal strings, keyed by calendar year. */
  readonly values: Readonly<Record<number, string>>;
  /** E.g. "IMF World Economic Outlook (October 2026)". */
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** When the provider last changed the series (YYYY-MM-DD), or null. */
  readonly asOf: string | null;
}

export type MacroForecastResult = { readonly status: 'OK'; readonly series: MacroForecastSeries } | { readonly status: 'UNAVAILABLE'; readonly reason: 'NOT_FOUND' | 'PROVIDER_ERROR' | 'MALFORMED' };

export interface MacroForecastProvider {
  readonly name: string;
  forecast(indicator: string, area: string, years: readonly number[]): Promise<MacroForecastResult>;
}

const IMF_BASE = 'https://www.imf.org/external/datamapper/api/v2';

/** Numbers from the provider become decimal strings once, here; nothing downstream does float arithmetic on them. */
const asDecimal = (value: unknown): string | null => (typeof value === 'number' && Number.isFinite(value) ? String(value) : null);

export class ImfMacroForecastProvider implements MacroForecastProvider {
  readonly name = 'imf-datamapper';

  constructor(private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike, private readonly timeoutMs = 15_000) {}

  async forecast(indicator: string, area: string, years: readonly number[]): Promise<MacroForecastResult> {
    if (!/^[A-Z_]{2,20}$/.test(indicator) || !/^[A-Z_]{2,20}$/.test(area)) return { status: 'UNAVAILABLE', reason: 'NOT_FOUND' };
    const url = `${IMF_BASE}/${indicator}/${area}?periods=${years.join(',')}`;
    let body: unknown;
    try {
      const response = await this.fetchImpl(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return { status: 'UNAVAILABLE', reason: response.status === 404 ? 'NOT_FOUND' : 'PROVIDER_ERROR' };
      body = await response.json();
    } catch {
      return { status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR' };
    }
    const root = body as { indicators?: Record<string, { source?: unknown; 'last-modified'?: unknown }>; values?: Record<string, Record<string, Record<string, unknown>>> };
    const series = root.values?.[indicator]?.[area];
    if (!series || typeof series !== 'object') return { status: 'UNAVAILABLE', reason: 'NOT_FOUND' };
    const values: Record<number, string> = {};
    for (const year of years) {
      const value = asDecimal(series[String(year)]);
      if (value !== null) values[year] = value;
    }
    if (Object.keys(values).length === 0) return { status: 'UNAVAILABLE', reason: 'MALFORMED' };
    const meta = root.indicators?.[indicator];
    const source = typeof meta?.source === 'string' ? meta.source.slice(0, 120) : 'World Economic Outlook';
    const modified = typeof meta?.['last-modified'] === 'string' ? meta['last-modified'].slice(0, 10) : null;
    return {
      status: 'OK',
      series: {
        indicator,
        area,
        values,
        sourceName: `IMF ${source}`,
        sourceUrl: `https://www.imf.org/external/datamapper/${indicator}@WEO/${area}`,
        asOf: modified && /^\d{4}-\d{2}-\d{2}$/.test(modified) ? modified : null,
      },
    };
  }
}

/** Invented, deterministic series for tests and local work; labelled synthetic so it is never mistaken for a real forecast. */
export class FixtureMacroForecastProvider implements MacroForecastProvider {
  readonly name = 'fixture';

  async forecast(indicator: string, area: string, years: readonly number[]): Promise<MacroForecastResult> {
    const start = indicator === 'PCPIPCH' ? 3.0 : indicator === 'NGDP_RPCH' ? 1.8 : null;
    if (start === null) return { status: 'UNAVAILABLE', reason: 'NOT_FOUND' };
    const values: Record<number, string> = {};
    years.forEach((year, index) => {
      values[year] = (indicator === 'PCPIPCH' ? Math.max(2, start - index * 0.3) : start + (index % 2) * 0.1).toFixed(1);
    });
    return { status: 'OK', series: { indicator, area, values, sourceName: 'Synthetic macro forecast (fixture)', sourceUrl: 'https://example.invalid/fixture', asOf: '2026-10-01' } };
  }
}
