/** Pure helpers for the draggable forecast line (batch 1). Percent a year throughout. */

/** The allowed band for a forecast value, the same as the API's. */
export const VALUE_MIN = -50;
export const VALUE_MAX = 100;

/** Round to one decimal place (0.1 points), the drag step. */
export function snap(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min = VALUE_MIN, max = VALUE_MAX): number {
  return Math.min(max, Math.max(min, value));
}

/** The y-axis range: every line on the chart and the neutral level, with room to drag either way, on whole numbers. */
export function chartRange(series: readonly (readonly number[])[], neutral: number, padding = 2): { min: number; max: number } {
  const values = [...series.flat(), neutral].filter((value) => Number.isFinite(value));
  const low = Math.floor(Math.min(...values) - padding);
  const high = Math.ceil(Math.max(...values) + padding);
  return { min: clamp(low), max: clamp(Math.max(high, low + 1)) };
}

/** The value at a vertical position inside the plot (0 at the top). */
export function valueAt(y: number, height: number, range: { min: number; max: number }): number {
  const ratio = 1 - Math.min(1, Math.max(0, y / height));
  return snap(clamp(range.min + ratio * (range.max - range.min), range.min, range.max));
}

/** The vertical position of a value inside the plot. */
export function yOf(value: number, height: number, range: { min: number; max: number }): number {
  return (1 - (value - range.min) / (range.max - range.min)) * height;
}

/** A value as the API takes it: up to two decimals, no trailing zeros. */
export function formatValue(value: number): string {
  return String(snap(value));
}
