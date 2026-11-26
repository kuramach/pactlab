import { D } from '../metrics/decimal';
import { pnlPeriods } from '../pnl/pnl';
import { pnlLinesFromRecords, pnlTrend, type KeyExpense, type PnlTrend, type TrendYear } from '../pnl/trend';
import { grouped, percent } from './common';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from './rule-types';

/**
 * Multi-year P&L trend rules, one factory for every pack (Kumar, 2026-11-26): a pack names its key
 * expenses and gets three rules over the imported P&L (`finance.pnl_line`), whatever years it holds.
 * - `<prefix>-pnl-trend` (0): the years side by side — revenue, growth, margins and the key ratios —
 *   so the trend is a reviewable record even when nothing is wrong; one year reads as one year.
 * - `<prefix>-pnl-margin-drift` (−1): gross or operating margin down 3 points or more, first year to last.
 * - `<prefix>-pnl-expense-outpacing` (−1): a key expense rising faster than revenue every year, by a
 *   quarter or more of its first-year ratio — the defect a single-year view misses.
 * Withdrawn imports never reach a rule (the evidence loader filters them). Deterministic, decimal-only.
 */
export const PNL_LINE = 'finance.pnl_line';

/** Margin drift that is a finding: down this many points (as a fraction), first fiscal year to last. */
export const MARGIN_DRIFT_POINTS = '0.03';
/** An expense ratio that is a finding: rising every year and ending this many times its first year or more. */
export const EXPENSE_OUTPACING_FACTOR = '1.25';

type Decimal = InstanceType<typeof D>;
const share = (value: string | null) => (value === null ? 'n/a' : percent(new D(value)));
const points = (value: Decimal) => `${value.times(100).abs().toFixed(1)} points`;

export function trendOf(evidence: readonly PackRuleEvidence[], keyExpenses: readonly KeyExpense[]): PnlTrend {
  return pnlTrend(pnlPeriods(pnlLinesFromRecords(evidence.filter((row) => row.evidenceType === PNL_LINE))), keyExpenses);
}

const cited = (years: readonly TrendYear[], ids?: readonly string[]) => [...new Set(ids ?? years.flatMap((year) => year.evidenceIds))].slice(0, MAX_CITED);
const span = (years: readonly TrendYear[]) => (years.length === 1 ? years[0]?.year ?? '' : `${years[0]?.year ?? ''}–${years.at(-1)?.year ?? ''}`);

export function pnlTrendRules(prefix: string, keyExpenses: readonly KeyExpense[]): readonly PackRule[] {
  const trend: PackRule = {
    id: `${prefix}-pnl-trend`,
    version: '1',
    evidenceTypes: [PNL_LINE],
    detect: ({ evidence }) => {
      const { years, partialYears } = trendOf(evidence, keyExpenses);
      if (years.length === 0) return [];
      const lines = years.map((year) => {
        const ratios = year.ratios.filter((ratio) => new D(ratio.amount).gt(0)).map((ratio) => `${ratio.label.toLowerCase()} ${share(ratio.ratio)}`);
        return `${year.year}: revenue ${grouped(new D(year.revenue))}${year.revenueGrowth ? ` (${new D(year.revenueGrowth).gte(0) ? '+' : ''}${percent(new D(year.revenueGrowth))})` : ''}, gross margin ${share(year.grossMargin)}, operating margin ${share(year.operatingMargin)}${ratios.length ? `, ${ratios.join(', ')}` : ''}`;
      });
      return [
        {
          key: `years:${years.map((year) => year.year).join(',')}`,
          domain: 'FINANCIAL',
          title: years.length === 1 ? `P&L for ${years[0]?.year ?? ''}: one year imported` : `P&L trend, ${span(years)}`,
          description:
            `From the imported P&L, year by year. ${lines.join('. ')}.` +
            (years.length === 1 ? ' One fiscal year is imported, so there is no trend yet; import earlier years to read one.' : '') +
            (partialYears.length ? ` Left out because not every month is imported: ${partialYears.join(', ')}.` : ''),
          severity: 'INFO',
          confidence: 'HIGH',
          direction: 0,
          directionRationale: 'A record of the trend for review; drifts and expenses outpacing revenue are drafted on their own.',
          evidenceIds: cited(years),
        },
      ];
    },
  };

  const drift: PackRule = {
    id: `${prefix}-pnl-margin-drift`,
    version: '1',
    evidenceTypes: [PNL_LINE],
    detect: ({ evidence }) => {
      const { years } = trendOf(evidence, keyExpenses);
      const first = years[0];
      const last = years.at(-1);
      if (!first || !last || years.length < 2) return [];
      const drifts = (['grossMargin', 'operatingMargin'] as const).flatMap((field) => {
        const from = first[field];
        const to = last[field];
        if (from === null || to === null) return [];
        const change = new D(to).minus(from);
        return change.lte(new D(MARGIN_DRIFT_POINTS).neg()) ? [{ field, from, to, change }] : [];
      });
      if (drifts.length === 0) return [];
      const label = { grossMargin: 'Gross margin', operatingMargin: 'Operating margin' } as const;
      return [
        {
          key: `${first.year}-${last.year}:${drifts.map((entry) => entry.field).join(',')}`,
          domain: 'FINANCIAL',
          title: `${drifts.map((entry) => label[entry.field]).join(' and ')} down across ${span(years)}`,
          description:
            drifts.map((entry) => `${label[entry.field]} fell from ${share(entry.from)} in ${first.year} to ${share(entry.to)} in ${last.year}, ${points(entry.change)}`).join('; ') +
            '. From the imported P&L; price it as a haircut on the margin the scenarios assume.',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: cited([first, last]),
        },
      ];
    },
  };

  const outpacing: PackRule = {
    id: `${prefix}-pnl-expense-outpacing`,
    version: '1',
    evidenceTypes: [PNL_LINE],
    detect: ({ evidence }) => {
      const { years } = trendOf(evidence, keyExpenses);
      if (years.length < 2) return [];
      const first = years[0] as TrendYear;
      const last = years.at(-1) as TrendYear;
      return keyExpenses.flatMap((expense): PackRuleProposal[] => {
        const series = years.map((year) => year.ratios.find((ratio) => ratio.key === expense.key));
        if (series.some((ratio) => !ratio || ratio.ratio === null || !new D(ratio.amount).gt(0))) return [];
        const ratios = series.map((ratio) => new D(ratio?.ratio ?? '0'));
        const rising = ratios.every((ratio, index) => index === 0 || ratio.gt(ratios[index - 1] as Decimal));
        const firstRatio = ratios[0] as Decimal;
        const lastRatio = ratios.at(-1) as Decimal;
        if (!rising || lastRatio.lt(firstRatio.times(EXPENSE_OUTPACING_FACTOR))) return [];
        const firstAmount = new D(series[0]?.amount ?? '0');
        const lastAmount = new D(series.at(-1)?.amount ?? '0');
        const expenseGrowth = lastAmount.div(firstAmount);
        const revenueGrowth = new D(last.revenue).div(first.revenue);
        return [
          {
            key: `${expense.key}:${first.year}-${last.year}`,
            domain: 'FINANCIAL',
            title: `${expense.label} growing faster than revenue, ${span(years)}`,
            description:
              `${expense.label} grew from ${grouped(firstAmount)} (${percent(firstRatio)} of revenue) in ${first.year} to ${grouped(lastAmount)} (${percent(lastRatio)}) in ${last.year}, ` +
              `${expenseGrowth.toFixed(2)}× against revenue's ${revenueGrowth.toFixed(2)}×, and the ratio rose every year (${years.map((year, index) => `${year.year} ${percent(ratios[index] as Decimal)}`).join(', ')}). ` +
              `A single year shows ${percent(lastRatio)}, which reads as small on its own. From the imported P&L; price it as a haircut on the margin the scenarios assume.`,
            severity: lastRatio.gte(firstRatio.times(2)) ? 'HIGH' : 'MEDIUM',
            confidence: 'HIGH',
            direction: -1,
            pricedRisk: null,
            evidenceIds: cited(years, series.flatMap((ratio) => ratio?.evidenceIds ?? [])),
          },
        ];
      });
    },
  };

  return [trend, drift, outpacing];
}
