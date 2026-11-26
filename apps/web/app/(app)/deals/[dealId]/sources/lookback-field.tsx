import { DEFAULT_LOOKBACK_MONTHS, LOOKBACK_CHOICES, type LookbackMonths } from '../../_lib/lookback';

const selectClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** The history window of a GitHub or Jira source. Older history often describes people who have left, so longer is a deliberate choice. */
export function LookbackField({ current = DEFAULT_LOOKBACK_MONTHS }: { current?: LookbackMonths }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      History to read
      <select name="lookbackMonths" defaultValue={String(current)} className={selectClass}>
        {LOOKBACK_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="text-xs font-normal text-muted-foreground">
        Older history often describes people who have left, so it can mislead key-person and activity findings. Choose longer only on purpose.
      </span>
    </label>
  );
}
