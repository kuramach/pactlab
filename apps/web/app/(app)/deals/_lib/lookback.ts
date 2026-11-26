/** How much history a GitHub or Jira source reads (T-169): 24 months unless a longer window is chosen on purpose. */
export type LookbackMonths = number | 'ALL';

export const DEFAULT_LOOKBACK_MONTHS = 24;

export const LOOKBACK_CHOICES: readonly { value: string; label: string }[] = [
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months (default)' },
  { value: '36', label: 'Last 36 months' },
  { value: '60', label: 'Last 5 years' },
  { value: 'ALL', label: 'All history' },
];

export const describeLookback = (months: LookbackMonths | null | undefined): string => {
  const value = months ?? DEFAULT_LOOKBACK_MONTHS;
  return value === 'ALL' ? 'all history' : `last ${value} months`;
};

/** The form value as the API wants it, or null when it is not one of the offered choices. */
export function readLookback(raw: FormDataEntryValue | null): LookbackMonths | null {
  if (typeof raw !== 'string' || !LOOKBACK_CHOICES.some((choice) => choice.value === raw)) return null;
  return raw === 'ALL' ? 'ALL' : Number(raw);
}
