'use client';

import { useEffect, useRef } from 'react';

/**
 * Brand charts on ECharts (the project's settled visual library), rendered
 * as SVG in the browser. Amounts reach the browser as decimal strings and are
 * converted to numbers here for drawing only — never for calculation.
 */

export const CHART_COLORS = {
  navy: '#081127',
  indigo: '#6978ff',
  indigoInk: '#4a58e8',
  teal: '#14b8a6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#94a3b8',
  mist: '#eef1ff',
} as const;
const SERIES = [CHART_COLORS.indigo, CHART_COLORS.teal, CHART_COLORS.amber, CHART_COLORS.navy, CHART_COLORS.rose, CHART_COLORS.slate];

export type ValueFormat = 'money' | 'percent' | 'count';

function formatter(format: ValueFormat, currency: string) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return (value: number) =>
    format === 'money' ? money.format(value) : format === 'percent' ? `${(value * 100).toFixed(1)}%` : count.format(value);
}

const toNumber = (value: string | number | null) => (value === null ? null : typeof value === 'number' ? value : Number(value));

type Option = Record<string, unknown>;

function useChart(build: () => Option, deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    let dispose = () => {};
    void import('echarts').then((echarts) => {
      if (disposed) return;
      const chart = echarts.init(element, undefined, { renderer: 'svg' });
      chart.setOption({
        color: SERIES,
        textStyle: { fontFamily: 'var(--font-manrope), ui-sans-serif, system-ui', color: '#4b5568' },
        animationDuration: 600,
        ...build(),
      });
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(element);
      dispose = () => {
        observer.disconnect();
        chart.dispose();
      };
    });
    return () => {
      disposed = true;
      dispose();
    };
  }, deps);
  return ref;
}

function Frame({ label, height, chartRef }: { label: string; height: number; chartRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={chartRef} role="img" aria-label={label} style={{ height }} className="w-full" />;
}

const axisCommon = {
  axisLine: { lineStyle: { color: '#e3e8f2' } },
  axisTick: { show: false },
  axisLabel: { color: '#4b5568', fontSize: 11 },
  splitLine: { lineStyle: { color: '#eef1f6' } },
};

/** Grouped vertical bars, one group per category. */
export function BarChart({
  label,
  categories,
  series,
  format = 'money',
  currency = 'USD',
  height = 280,
  horizontal = false,
}: {
  label: string;
  categories: readonly string[];
  series: readonly { name: string; values: readonly (string | number | null)[]; color?: string }[];
  format?: ValueFormat;
  currency?: string;
  height?: number;
  horizontal?: boolean;
}) {
  const ref = useChart(() => {
    const fmt = formatter(format, currency);
    const category = { type: 'category', data: categories, ...axisCommon };
    const value = { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: fmt } };
    return {
      grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      legend: series.length > 1 ? { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 12 } : undefined,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmt(v) },
      xAxis: horizontal ? value : category,
      yAxis: horizontal ? category : value,
      series: series.map((entry) => ({
        type: 'bar',
        name: entry.name,
        data: entry.values.map(toNumber),
        barMaxWidth: 36,
        itemStyle: { borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0], ...(entry.color ? { color: entry.color } : {}) },
      })),
    };
  }, [JSON.stringify({ categories, series, format, currency, horizontal })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}

/** Donut with the total in the middle. */
/** Text for chart tooltips, which ECharts renders as HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/**
 * Donut with the total in the middle. A slice may list the items it stands
 * for; hovering the slice or its legend entry shows them.
 */
export function DonutChart({
  label,
  slices,
  centerLabel,
  height = 240,
}: {
  label: string;
  slices: readonly { name: string; value: number; color?: string; items?: readonly string[] }[];
  centerLabel?: string;
  height?: number;
}) {
  const ref = useChart(() => {
    const describe = (name: string) => {
      const slice = slices.find((entry) => entry.name === name);
      if (!slice) return escapeHtml(name);
      const heading = `<b>${escapeHtml(slice.name)}</b> · ${slice.value}`;
      if (!slice.items) return heading;
      const list = slice.items.length
        ? slice.items.map((item) => `<div style="margin-top:2px">• ${escapeHtml(item)}</div>`).join('')
        : '<div style="margin-top:2px;opacity:.7">None</div>';
      return `${heading}${list}`;
    };
    return {
      tooltip: { trigger: 'item', confine: true, formatter: (params: { name: string }) => describe(params.name) },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
        tooltip: { show: true, formatter: (params: { name: string }) => describe(params.name) },
      },
      title: centerLabel
        ? { text: centerLabel, left: 'center', top: '36%', textStyle: { fontSize: 20, fontWeight: 800, color: CHART_COLORS.navy } }
        : undefined,
      series: [
        {
          type: 'pie',
          radius: ['55%', '78%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
          data: slices.map((slice) => ({ name: slice.name, value: slice.value, ...(slice.color ? { itemStyle: { color: slice.color } } : {}) })),
        },
      ],
    };
  }, [JSON.stringify({ slices, centerLabel })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}

/** Area line over time. */
export function LineChart({
  label,
  categories,
  series,
  format = 'money',
  currency = 'USD',
  height = 280,
}: {
  label: string;
  categories: readonly string[];
  series: readonly { name: string; values: readonly (string | number | null)[]; color?: string }[];
  format?: ValueFormat;
  currency?: string;
  height?: number;
}) {
  const ref = useChart(() => {
    const fmt = formatter(format, currency);
    return {
      grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      legend: series.length > 1 ? { top: 0 } : undefined,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmt(v) },
      xAxis: { type: 'category', data: categories, boundaryGap: false, ...axisCommon },
      yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: fmt } },
      series: series.map((entry, index) => {
        const color = entry.color ?? SERIES[index % SERIES.length];
        return {
          type: 'line',
          name: entry.name,
          data: entry.values.map(toNumber),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 3, color },
          itemStyle: { color },
          areaStyle: index === 0 ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}55` }, { offset: 1, color: `${color}05` }] } } : undefined,
        };
      }),
    };
  }, [JSON.stringify({ categories, series, format, currency })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}

/**
 * Waterfall: a starting total, signed steps and subtotals — the
 * purchase-price bridge. An optional reference line marks the asking price.
 */
export function WaterfallChart({
  label,
  steps,
  currency = 'USD',
  reference,
  height = 300,
}: {
  label: string;
  steps: readonly { name: string; amount: string; kind: 'total' | 'step' }[];
  currency?: string;
  reference?: { name: string; amount: string } | null;
  height?: number;
}) {
  const ref = useChart(() => {
    const fmt = formatter('money', currency);
    const base: number[] = [];
    const rise: (number | string)[] = [];
    const fall: (number | string)[] = [];
    const total: (number | string)[] = [];
    let running = 0;
    for (const step of steps) {
      const value = Number(step.amount);
      if (step.kind === 'total') {
        running = value;
        base.push(0);
        total.push(value);
        rise.push('-');
        fall.push('-');
      } else {
        const next = running + value;
        base.push(Math.min(running, next));
        rise.push(value >= 0 ? value : '-');
        fall.push(value < 0 ? -value : '-');
        total.push('-');
        running = next;
      }
    }
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { name: string; dataIndex: number }[]) => {
          const step = steps[params[0]?.dataIndex ?? 0];
          return step ? `${step.name}<br/><b>${fmt(Number(step.amount))}</b>` : '';
        },
      },
      xAxis: { type: 'category', data: steps.map((step) => step.name), ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 0, rotate: steps.length > 6 ? 25 : 0 } },
      yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: fmt } },
      series: [
        { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, silent: true },
        { type: 'bar', stack: 'w', name: 'Total', data: total, barMaxWidth: 44, itemStyle: { color: CHART_COLORS.navy, borderRadius: [6, 6, 0, 0] } },
        { type: 'bar', stack: 'w', name: 'Adds', data: rise, barMaxWidth: 44, itemStyle: { color: CHART_COLORS.teal, borderRadius: [6, 6, 0, 0] } },
        {
          type: 'bar',
          stack: 'w',
          name: 'Reduces',
          data: fall,
          barMaxWidth: 44,
          itemStyle: { color: CHART_COLORS.rose, borderRadius: [6, 6, 0, 0] },
          markLine: reference
            ? {
                symbol: 'none',
                lineStyle: { color: CHART_COLORS.amber, width: 2, type: 'dashed' },
                label: { formatter: `${reference.name} ${fmt(Number(reference.amount))}`, color: '#92400e', fontWeight: 700 },
                data: [{ yAxis: Number(reference.amount) }],
              }
            : undefined,
        },
      ],
    };
  }, [JSON.stringify({ steps, currency, reference })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}

/** Heatmap grid, e.g. revenue retention by cohort and month. */
export function HeatmapChart({
  label,
  rows,
  columns,
  cells,
  format = 'percent',
  height = 320,
}: {
  label: string;
  rows: readonly string[];
  columns: readonly string[];
  /** `cells[row][column]`, decimal strings or null. */
  cells: readonly (readonly (string | null)[])[];
  format?: ValueFormat;
  height?: number;
}) {
  const ref = useChart(() => {
    const fmt = formatter(format, 'USD');
    const data: [number, number, number][] = [];
    cells.forEach((row, r) => row.forEach((value, c) => value !== null && data.push([c, r, Number(value)])));
    const values = data.map((entry) => entry[2]);
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
      tooltip: { formatter: (p: { value: [number, number, number] }) => `${rows[p.value[1]]} · ${columns[p.value[0]]}<br/><b>${fmt(p.value[2])}</b>` },
      xAxis: { type: 'category', data: columns, ...axisCommon, splitArea: { show: false } },
      yAxis: { type: 'category', data: rows, ...axisCommon, inverse: true },
      visualMap: {
        min: Math.min(...values, 0),
        max: Math.max(...values, 1),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 120,
        inRange: { color: ['#fde2e4', '#eef1ff', '#6978ff', '#081127'] },
        formatter: (value: number) => fmt(value),
      },
      series: [{ type: 'heatmap', data, label: { show: columns.length <= 8, formatter: (p: { value: [number, number, number] }) => fmt(p.value[2]), fontSize: 10 } }],
    };
  }, [JSON.stringify({ rows, columns, cells, format })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}
