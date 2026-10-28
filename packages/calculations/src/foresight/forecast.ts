import { D } from '../metrics/decimal';

/**
 * Value under numeric forecasts (T-094 B10). Each metric's yearly forecast
 * (percent a year) is compared with its neutral level; the gap shifts that
 * year's growth and the discount rate by versioned elasticities, and a
 * discount-rate shift moves the exit multiple (RATE_TO_MULTIPLE per point).
 * Deterministic and decimal-only: the same forecasts always give the same
 * path. A projection under assumptions, never a prediction.
 */
export const FORECAST_ENGINE_VERSION = 'foresight-forecast-1';
export const FORECAST_RATE_TO_MULTIPLE = '10';

export interface ForecastMetricInput {
  readonly key: string;
  readonly label: string;
  readonly neutral: string;
  readonly growthPerPoint: string;
  readonly discountPerPoint: string;
  /** Five yearly values, percent a year (decimal strings). */
  readonly values: readonly string[];
}

export interface ForecastProjection {
  readonly engineVersion: string;
  readonly currency: string;
  readonly startValue: string;
  readonly baseGrowth: string;
  /** Year 0 is today; years 1–5 follow the forecasts. Values rounded to three significant figures. */
  readonly path: readonly { readonly year: number; readonly value: string; readonly growth: string; readonly multipleFactor: string }[];
  /** How much each metric moves year-5 value against holding it at neutral. */
  readonly drivers: readonly { readonly key: string; readonly label: string; readonly year5Change: string }[];
}

const YEARS = 5;
const rounded = (value: InstanceType<typeof D>) => value.toSignificantDigits(3).toFixed(0);

function run(startValue: string, baseGrowth: string, metrics: readonly ForecastMetricInput[]) {
  let compounded = new D(startValue);
  const path = [{ year: 0, value: new D(startValue), growth: new D(baseGrowth), multipleFactor: new D(1) }];
  for (let year = 1; year <= YEARS; year += 1) {
    let growth = new D(baseGrowth);
    let rateShift = new D(0);
    for (const metric of metrics) {
      const raw = metric.values[year - 1];
      if (raw === undefined) continue;
      const gap = new D(raw).minus(metric.neutral).dividedBy(100);
      growth = growth.plus(gap.times(metric.growthPerPoint));
      rateShift = rateShift.plus(gap.times(metric.discountPerPoint));
    }
    compounded = compounded.times(D.max(growth.plus(1), '0.1'));
    const multipleFactor = D.max(new D(1).minus(rateShift.times(FORECAST_RATE_TO_MULTIPLE)), '0.1');
    path.push({ year, value: compounded.times(multipleFactor), growth, multipleFactor });
  }
  return path;
}

export function projectWithForecasts(input: { startValue: string; currency: string; baseGrowth: string; metrics: readonly ForecastMetricInput[] }): ForecastProjection {
  if (!new D(input.startValue).gt(0)) throw new RangeError('The starting value must be positive');
  const path = run(input.startValue, input.baseGrowth, input.metrics);
  const year5 = path[YEARS]?.value ?? new D(0);
  const drivers = input.metrics
    .map((metric) => {
      const neutral = input.metrics.map((other) => (other.key === metric.key ? { ...other, values: other.values.map(() => other.neutral) } : other));
      const without = run(input.startValue, input.baseGrowth, neutral)[YEARS]?.value ?? new D(0);
      return { key: metric.key, label: metric.label, change: year5.minus(without) };
    })
    .sort((a, b) => b.change.abs().comparedTo(a.change.abs()) || a.key.localeCompare(b.key))
    .map((entry) => ({ key: entry.key, label: entry.label, year5Change: rounded(entry.change) }));
  return {
    engineVersion: FORECAST_ENGINE_VERSION,
    currency: input.currency,
    startValue: input.startValue,
    baseGrowth: input.baseGrowth,
    path: path.map((entry) => ({ year: entry.year, value: rounded(entry.value), growth: entry.growth.toDecimalPlaces(6).toString(), multipleFactor: entry.multipleFactor.toDecimalPlaces(6).toString() })),
    drivers,
  };
}
