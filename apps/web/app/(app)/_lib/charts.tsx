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

/** Where each comparable came from, with one colour per origin across every chart. */
export const ORIGIN_COLORS: Readonly<Record<string, string>> = {
  OWN_DEAL: CHART_COLORS.indigo,
  ENTERED: CHART_COLORS.teal,
  PROVIDER: CHART_COLORS.navy,
  SYNTHETIC: CHART_COLORS.amber,
};

interface ComparablePoint {
  readonly name: string;
  readonly multiple: string;
  readonly origin: string;
  readonly originLabel: string;
}

/**
 * Comparable EV ÷ ARR multiples on one axis: a dot per comparable (by
 * origin), the middle half shaded, the median marked, and the scenario's and
 * the asking price's multiples drawn as labelled lines.
 */
export function MultipleRangeChart({
  label,
  comparables,
  stats,
  marks,
  height = 220,
}: {
  label: string;
  comparables: readonly ComparablePoint[];
  stats: { readonly p25: string; readonly median: string; readonly p75: string } | null;
  marks: readonly { readonly name: string; readonly multiple: string; readonly color: string }[];
  height?: number;
}) {
  const ref = useChart(() => {
    const origins = [...new Set(comparables.map((point) => point.originLabel))];
    const values = [...comparables.map((point) => Number(point.multiple)), ...marks.map((mark) => Number(mark.multiple))];
    const max = Math.ceil(Math.max(1, ...values) + 0.5);
    const min = Math.max(0, Math.floor(Math.min(...values, max) - 0.5));
    const lines = [
      ...(stats ? [{ name: 'Median', multiple: stats.median, color: CHART_COLORS.slate, dashed: true }] : []),
      ...marks.map((mark) => ({ ...mark, dashed: false })),
    ];
    return {
      grid: { left: 8, right: 16, top: 34, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: { data: { name?: string; value: [number, string] } }) =>
          `<b>${escapeHtml(params.data.name ?? '')}</b><br/>${params.data.value[0].toFixed(2)}× ARR`,
      },
      xAxis: { type: 'value', min, max, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (value: number) => `${value}×` } },
      yAxis: { type: 'category', data: origins, ...axisCommon, splitLine: { show: false } },
      series: [
        ...origins.map((originLabel, index) => {
          const points = comparables.filter((point) => point.originLabel === originLabel);
          return {
            name: originLabel,
            type: 'scatter',
            symbolSize: 12,
            itemStyle: { color: ORIGIN_COLORS[points[0]?.origin ?? ''] ?? CHART_COLORS.slate, opacity: 0.85, borderColor: '#fff', borderWidth: 1 },
            data: points.map((point) => ({ name: point.name, value: [Number(point.multiple), originLabel] })),
            ...(index === 0
              ? {
                  markArea: stats
                    ? { silent: true, itemStyle: { color: 'rgba(105,120,255,0.10)' }, data: [[{ xAxis: Number(stats.p25) }, { xAxis: Number(stats.p75) }]] }
                    : undefined,
                  markLine: {
                    silent: true,
                    symbol: 'none',
                    data: lines.map((line) => ({
                      xAxis: Number(line.multiple),
                      lineStyle: { color: line.color, width: 2, type: line.dashed ? 'dashed' : 'solid' },
                      label: { formatter: `${line.name} ${Number(line.multiple).toFixed(1)}×`, color: line.color, fontWeight: 700, fontSize: 11, position: 'end' },
                    })),
                  },
                }
              : {}),
          };
        }),
      ],
    };
  }, [JSON.stringify({ comparables, stats, marks })]);
  return <Frame label={label} height={height} chartRef={ref} />;
}

/** Comparables by ARR growth (x) and EV ÷ ARR multiple (y); dot size by ARR, colour by origin. */
export function ComparablesScatterChart({
  label,
  points,
  height = 320,
}: {
  label: string;
  points: readonly (ComparablePoint & { readonly growth: string; readonly arr: string })[];
  height?: number;
}) {
  const ref = useChart(() => {
    const origins = [...new Set(points.map((point) => point.originLabel))];
    const size = (arr: string) => Math.max(8, Math.min(34, 4 * Math.log10(Math.max(Number(arr), 1)) - 14));
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 44, containLabel: true },
      legend: { bottom: 0, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: { data: { name: string; value: [number, number] } }) =>
          `<b>${escapeHtml(params.data.name)}</b><br/>ARR growth ${(params.data.value[0] * 100).toFixed(0)}% · ${params.data.value[1].toFixed(2)}× ARR`,
      },
      xAxis: {
        type: 'value',
        name: 'ARR growth (year over year)',
        nameLocation: 'middle',
        nameGap: 26,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (value: number) => `${Math.round(value * 100)}%` },
      },
      yAxis: { type: 'value', name: 'EV ÷ ARR', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (value: number) => `${value}×` } },
      series: origins.map((originLabel) => {
        const group = points.filter((point) => point.originLabel === originLabel);
        return {
          name: originLabel,
          type: 'scatter',
          itemStyle: { color: ORIGIN_COLORS[group[0]?.origin ?? ''] ?? CHART_COLORS.slate, opacity: 0.8, borderColor: '#fff', borderWidth: 1 },
          data: group.map((point) => ({ name: point.name, value: [Number(point.growth), Number(point.multiple)], symbolSize: size(point.arr) })),
        };
      }),
    };
  }, [JSON.stringify(points)]);
  return <Frame label={label} height={height} chartRef={ref} />;
}
