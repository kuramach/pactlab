'use client';

import { Button } from '@pactlab/ui';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chartRange, clamp, formatValue, snap, valueAt, yOf } from './forecast-line';

const WIDTH = 560;
const HEIGHT = 180;
const PAD = { top: 14, right: 18, bottom: 26, left: 40 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const toNumbers = (values: readonly string[] | null) => (values ? values.map(Number) : null);

/**
 * Your five-year line for one metric, dragged into shape (batch 1). Published
 * and AI lines show dashed for reference; each year's handle drags in 0.1-point
 * steps (arrow keys: 0.1, Shift+arrow: 1). The values ride along as hidden
 * inputs on the metric's save form, so saving is unchanged. "Type numbers"
 * swaps the chart for plain inputs.
 */
export function ForecastLineEditor({
  formId,
  label,
  years,
  neutral,
  published,
  ai,
  initial,
}: {
  formId: string;
  label: string;
  years: readonly number[];
  neutral: string;
  published: readonly string[] | null;
  ai: readonly string[] | null;
  initial: readonly string[];
}) {
  const [values, setValues] = useState<number[]>(initial.map(Number));
  const [typing, setTyping] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const references = [toNumbers(published), toNumbers(ai)].filter((series): series is number[] => series !== null);
  const range = chartRange([...references, values], Number(neutral));
  const x = (index: number) => PAD.left + (years.length === 1 ? PLOT_W / 2 : (index / (years.length - 1)) * PLOT_W);
  const y = (value: number) => PAD.top + yOf(value, PLOT_H, range);
  const path = (series: readonly number[]) => series.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' ');
  const set = (index: number, value: number) => setValues((current) => current.map((entry, position) => (position === index ? snap(clamp(value)) : entry)));

  const drag = (index: number, event: PointerEvent<SVGCircleElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const scale = HEIGHT / box.height;
    set(index, valueAt((event.clientY - box.top) * scale - PAD.top, PLOT_H, range));
  };
  const key = (index: number, event: KeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') set(index, (values[index] ?? 0) + step);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') set(index, (values[index] ?? 0) - step);
    else return;
    event.preventDefault();
  };
  const ticks = [range.min, (range.min + range.max) / 2, range.max];

  return (
    <div className="flex flex-col gap-2">
      {values.map((value, index) => (
        <input key={years[index]} type="hidden" form={formId} name={`y${index}`} value={formatValue(value)} />
      ))}
      {typing ? (
        <div className="flex flex-wrap gap-2">
          {years.map((year, index) => (
            <label key={year} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {year}
              <input
                inputMode="decimal"
                value={formatValue(values[index] ?? 0)}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) set(index, parsed);
                }}
                aria-label={`Your ${label} forecast for ${year}, percent`}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
              />
            </label>
          ))}
        </div>
      ) : (
        <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-2xl touch-none select-none" role="group" aria-label={`Your ${label} forecast: drag each year's point`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {formatValue(tick)}%
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(Number(neutral))} y2={y(Number(neutral))} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="2 4" />
          {published ? <path d={path(published.map(Number))} fill="none" className="stroke-navy/50" strokeWidth={2} strokeDasharray="6 4" /> : null}
          {ai ? <path d={path(ai.map(Number))} fill="none" className="stroke-indigo" strokeWidth={2} strokeDasharray="3 3" /> : null}
          <path d={path(values)} fill="none" className="stroke-teal" strokeWidth={3} />
          {years.map((year, index) => (
            <text key={year} x={x(index)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {year}
            </text>
          ))}
          {values.map((value, index) => (
            <g key={years[index]}>
              {dragging === index ? (
                <text x={x(index)} y={y(value) - 12} textAnchor="middle" className="fill-foreground text-[12px] font-bold">
                  {formatValue(value)}%
                </text>
              ) : null}
              <circle
                cx={x(index)}
                cy={y(value)}
                r={8}
                tabIndex={0}
                role="slider"
                aria-label={`${years[index]}: ${formatValue(value)}%`}
                aria-valuemin={range.min}
                aria-valuemax={range.max}
                aria-valuenow={value}
                className="cursor-ns-resize fill-white stroke-teal outline-none focus:stroke-navy"
                strokeWidth={3}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(index);
                  drag(index, event);
                }}
                onPointerMove={(event) => {
                  if (dragging === index) drag(index, event);
                }}
                onPointerUp={() => setDragging(null)}
                onFocus={() => setDragging(index)}
                onBlur={() => setDragging(null)}
                onKeyDown={(event) => key(index, event)}
              />
            </g>
          ))}
        </svg>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-teal" /> Yours
        </span>
        {published ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-2 border-dashed border-navy/50" /> Published
          </span>
        ) : null}
        {ai ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-2 border-dotted border-indigo" /> AI
          </span>
        ) : null}
        <span>Neutral {neutral}%</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setTyping((value) => !value)}>
          {typing ? 'Drag the line' : 'Type numbers'}
        </Button>
      </div>
    </div>
  );
}
