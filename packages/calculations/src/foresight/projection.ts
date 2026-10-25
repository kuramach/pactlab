import { D } from '../metrics/decimal';

/**
 * Foresight projection (T-073): what the business is worth over the next five
 * years under a set of trend lines. Deterministic and decimal-only: trends say
 * direction, size band and confidence; this versioned table turns them into
 * named impacts on growth, margin and the exit multiple. Output is a path and
 * a range — projected value under these assumptions, never a prediction.
 */
export const FORESIGHT_ENGINE_VERSION = 'foresight-1';

type Lever = 'GROWTH' | 'MARGIN' | 'MULTIPLE' | 'DISCOUNT_RATE';
type Band = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ProjectionTrend {
  readonly key: string;
  readonly label: string;
  readonly direction: 'UP' | 'FLAT' | 'DOWN';
  readonly magnitude: Band;
  readonly confidence: Band;
  readonly provenance: 'AI' | 'USER';
  readonly effects: readonly { readonly lever: Lever; readonly whenUp: 1 | -1 }[];
  /** Decimal string, 0–2. */
  readonly weight: string;
}

export interface ProjectionInput {
  /** Today's enterprise value (decimal string) and its currency. */
  readonly startValue: string;
  readonly currency: string;
  /** Yearly growth before trends, and the earnings margin trends move (fractions as decimal strings). */
  readonly baseGrowth: string;
  readonly baseMargin: string;
  readonly trends: readonly ProjectionTrend[];
}

/**
 * Size of one trend's effect per lever and band (weight 1). Growth and margin
 * are points per year and margin points; multiple is a fraction of the exit
 * multiple; a discount-rate move changes the multiple at 10 % per point.
 */
export const IMPACT_TABLE = {
  GROWTH: { LOW: '0.005', MEDIUM: '0.015', HIGH: '0.03' },
  MARGIN: { LOW: '0.005', MEDIUM: '0.01', HIGH: '0.02' },
  MULTIPLE: { LOW: '0.02', MEDIUM: '0.05', HIGH: '0.10' },
  DISCOUNT_RATE: { LOW: '0.0025', MEDIUM: '0.005', HIGH: '0.01' },
} as const satisfies Record<Lever, Record<Band, string>>;
export const RATE_TO_MULTIPLE = '10';
/** How far each impact may be off, by the trend's confidence: the range around the base path. */
export const CONFIDENCE_SPREAD = { LOW: '1', MEDIUM: '0.5', HIGH: '0.25' } as const satisfies Record<Band, string>;

export interface ProjectionImpact {
  readonly trendKey: string;
  readonly trendLabel: string;
  readonly provenance: 'AI' | 'USER';
  readonly lever: Lever;
  /** Signed change: growth/margin in points (fraction), multiple as a fraction, discount rate in points. */
  readonly change: string;
  readonly explanation: string;
}

export interface ProjectionYear {
  readonly year: number;
  readonly low: string;
  readonly base: string;
  readonly high: string;
}

export interface ProjectionResult {
  readonly engineVersion: string;
  readonly currency: string;
  readonly assumptions: { readonly startValue: string; readonly baseGrowth: string; readonly baseMargin: string; readonly rateToMultiple: string };
  readonly impacts: readonly ProjectionImpact[];
  readonly path: readonly ProjectionYear[];
  /** Trends ranked by how much year-5 base value moves without them. */
  readonly sensitivity: readonly { readonly trendKey: string; readonly trendLabel: string; readonly year5Change: string }[];
}

const YEARS = 5;
/** Favourable to value when the change is positive (discount rate is the opposite). */
const VALUE_SIGN: Record<Lever, 1 | -1> = { GROWTH: 1, MARGIN: 1, MULTIPLE: 1, DISCOUNT_RATE: -1 };

function impactsOf(trends: readonly ProjectionTrend[]): (ProjectionImpact & { spread: string })[] {
  const out: (ProjectionImpact & { spread: string })[] = [];
  for (const trend of trends) {
    if (trend.direction === 'FLAT') continue;
    const weight = new D(trend.weight);
    if (weight.lte(0)) continue;
    for (const effect of trend.effects) {
      const sign = (trend.direction === 'UP' ? 1 : -1) * effect.whenUp;
      const change = new D(IMPACT_TABLE[effect.lever][trend.magnitude]).times(sign).times(weight);
      const pct = change.times(100).toDecimalPlaces(2).toString();
      out.push({
        trendKey: trend.key,
        trendLabel: trend.label,
        provenance: trend.provenance,
        lever: effect.lever,
        change: change.toString(),
        spread: CONFIDENCE_SPREAD[trend.confidence],
        explanation:
          effect.lever === 'GROWTH'
            ? `${trend.label} ${trend.direction === 'UP' ? 'rises' : 'falls'} (${trend.magnitude.toLowerCase()}): growth ${sign > 0 ? '+' : ''}${pct} points a year`
            : effect.lever === 'MARGIN'
              ? `${trend.label} ${trend.direction === 'UP' ? 'rises' : 'falls'} (${trend.magnitude.toLowerCase()}): margin ${sign > 0 ? '+' : ''}${pct} points by year 5`
              : effect.lever === 'MULTIPLE'
                ? `${trend.label} ${trend.direction === 'UP' ? 'rises' : 'falls'} (${trend.magnitude.toLowerCase()}): exit multiple ${sign > 0 ? '+' : ''}${pct}% by year 5`
                : `${trend.label} ${trend.direction === 'UP' ? 'rises' : 'falls'} (${trend.magnitude.toLowerCase()}): discount rate ${sign > 0 ? '+' : ''}${pct} points, exit multiple ${sign > 0 ? '−' : '+'}${change.abs().times(RATE_TO_MULTIPLE).times(100).toDecimalPlaces(2).toString()}%`,
      });
    }
  }
  return out;
}

/** Values to three significant figures: no false precision in a five-year view. */
const rounded = (value: InstanceType<typeof D>) => value.toSignificantDigits(3).toFixed(0);

/** Year-by-year value with each impact scaled by `scale(impact)`. */
function path(input: ProjectionInput, impacts: readonly (ProjectionImpact & { spread: string })[], scale: (impact: ProjectionImpact & { spread: string }) => InstanceType<typeof D>): InstanceType<typeof D>[] {
  const sum = (lever: Lever) => impacts.filter((impact) => impact.lever === lever).reduce((total, impact) => total.plus(new D(impact.change).times(scale(impact))), new D(0));
  const growth = new D(input.baseGrowth).plus(sum('GROWTH'));
  const marginShift = sum('MARGIN');
  const multipleShift = sum('MULTIPLE').minus(sum('DISCOUNT_RATE').times(RATE_TO_MULTIPLE));
  const margin = new D(input.baseMargin);
  const values = [new D(input.startValue)];
  let compounded = new D(input.startValue);
  for (let year = 1; year <= YEARS; year += 1) {
    compounded = compounded.times(D.max(growth.plus(1), '0.1'));
    // Margin and multiple shifts phase in evenly over the five years.
    const phase = new D(year).dividedBy(YEARS);
    const marginFactor = margin.gt(0) ? D.max(margin.plus(marginShift.times(phase)).dividedBy(margin), '0.1') : new D(1);
    const multipleFactor = D.max(multipleShift.times(phase).plus(1), '0.1');
    values.push(compounded.times(marginFactor).times(multipleFactor));
  }
  return values;
}

export function projectValue(input: ProjectionInput): ProjectionResult {
  if (!new D(input.startValue).gt(0)) throw new RangeError('The starting value must be positive');
  const impacts = impactsOf(input.trends);
  // Low: adverse impacts larger and favourable ones smaller by the trend's spread; high: the opposite.
  const favourable = (impact: ProjectionImpact) => new D(impact.change).times(VALUE_SIGN[impact.lever]).gt(0);
  const base = path(input, impacts, () => new D(1));
  const low = path(input, impacts, (impact) => (favourable(impact) ? new D(1).minus(impact.spread) : new D(1).plus(impact.spread)));
  const high = path(input, impacts, (impact) => (favourable(impact) ? new D(1).plus(impact.spread) : new D(1).minus(impact.spread)));
  const year5 = base[YEARS] ?? new D(0);
  const sensitivity = [...new Set(impacts.map((impact) => impact.trendKey))]
    .map((key) => {
      const without = path(input, impacts.filter((impact) => impact.trendKey !== key), () => new D(1))[YEARS] ?? new D(0);
      return { trendKey: key, trendLabel: impacts.find((impact) => impact.trendKey === key)?.trendLabel ?? key, change: year5.minus(without) };
    })
    .sort((a, b) => b.change.abs().comparedTo(a.change.abs()) || a.trendKey.localeCompare(b.trendKey))
    .map((entry) => ({ trendKey: entry.trendKey, trendLabel: entry.trendLabel, year5Change: rounded(entry.change) }));
  return {
    engineVersion: FORESIGHT_ENGINE_VERSION,
    currency: input.currency,
    assumptions: { startValue: input.startValue, baseGrowth: input.baseGrowth, baseMargin: input.baseMargin, rateToMultiple: RATE_TO_MULTIPLE },
    impacts: impacts.map(({ spread: _spread, ...impact }) => impact),
    path: base.map((value, year) => ({ year, low: rounded(D.min(low[year] ?? value, value)), base: rounded(value), high: rounded(D.max(high[year] ?? value, value)) })),
    sensitivity,
  };
}
