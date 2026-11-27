import { CRITICAL_COMPARATOR_LABELS, CRITICAL_COMPARATORS, CRITICAL_MAX_LOOKBACK_YEARS, CRITICAL_METRICS, formatCriticalValue, percentToRatio, type CriticalMetricId, type CriticalStructure } from '@pactlab/domain';

/** What the API lists as the metrics a critical may target (`GET /v1/criticals/metrics`, or the panel's vocabulary). */
export interface CriticalMetricOption {
  id: CriticalMetricId;
  label: string;
  unit: 'RATIO' | 'MULTIPLE' | 'YEARS';
  lookback: boolean;
}

const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
/** A stored fraction shown in percent for the form ("0.06" → "6"); multiples and years as they are. */
const forInput = (value: string | null | undefined, metric: CriticalMetricId | undefined) =>
  value === null || value === undefined ? '' : metric && CRITICAL_METRICS[metric].unit === 'RATIO' ? formatCriticalValue(value, 'RATIO').replace(/\.?0*%$/, '') : value;

/**
 * The structured form of a critical: metric, comparator, threshold, lookback and Even band. Ratios are typed in
 * percent and points; the form posts them as the person typed them and `structureFrom` turns them into fractions.
 */
export function StructureFields({ metrics, value, lockMetric = false }: { metrics: readonly CriticalMetricOption[]; value: CriticalStructure | null; lockMetric?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Metric</span>
        <select name="metric" defaultValue={value?.metric ?? metrics[0]?.id} className={inputClass} disabled={lockMetric}>
          {metrics.map((metric) => (
            <option key={metric.id} value={metric.id}>
              {metric.label}
            </option>
          ))}
        </select>
        {lockMetric && value ? <input type="hidden" name="metric" value={value.metric} /> : null}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Must be</span>
        <select name="comparator" defaultValue={value?.comparator ?? 'AT_LEAST'} className={inputClass}>
          {CRITICAL_COMPARATORS.map((comparator) => (
            <option key={comparator} value={comparator}>
              {CRITICAL_COMPARATOR_LABELS[comparator]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Threshold (% for a percentage)</span>
        <input name="threshold" required inputMode="decimal" defaultValue={forInput(value?.threshold, value?.metric)} className={`${inputClass} w-28`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">In each of the last … years</span>
        <input name="lookbackYears" type="number" min={1} max={CRITICAL_MAX_LOOKBACK_YEARS} defaultValue={value?.lookbackYears ?? ''} className={`${inputClass} w-20`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Even within (points)</span>
        <input name="evenBand" inputMode="decimal" defaultValue={forInput(value?.evenBand, value?.metric)} className={`${inputClass} w-24`} />
      </label>
    </div>
  );
}

/** The structure a form posted, in the metric's stored units; null when the threshold is missing or not a number. */
export function structureFrom(form: FormData): CriticalStructure | null {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const metric = text('metric') as CriticalMetricId;
  const definition = CRITICAL_METRICS[metric];
  const threshold = text('threshold');
  if (!definition || !/^\d{1,9}(\.\d{1,6})?$/.test(threshold)) return null;
  const band = text('evenBand');
  const lookback = text('lookbackYears');
  const ratio = definition.unit === 'RATIO';
  return {
    metric,
    comparator: text('comparator') === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST',
    threshold: ratio ? percentToRatio(threshold) : threshold,
    lookbackYears: definition.lookback && /^[1-5]$/.test(lookback) ? Number(lookback) : null,
    evenBand: /^\d{1,9}(\.\d{1,6})?$/.test(band) ? (ratio ? percentToRatio(band) : band) : null,
  };
}
