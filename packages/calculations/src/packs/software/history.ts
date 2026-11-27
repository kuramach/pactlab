import { D } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { INVOICE_LINE } from '../common';
import { driverTrendRule, packHistory, recentRunRule, type DriverSpec, type DriverYear, type PackHistorySpec } from '../history';
import type { PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE, pnlTrendRules } from '../pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';
import { monthlyRevenue, SOFTWARE_BASE_RULES } from './rules';

/**
 * Five years of history for software and SaaS (T-184b, ADR 0057): ARR at each December and the year's net and
 * gross revenue retention and logo churn, from the month-by-month recurring revenue the pack's rules read
 * (invoice lines spread over their service period). The SaaS engine keeps 36 months for its series and
 * cohorts, so the years are read here, deterministically and in decimals, alongside the imported P&L.
 * A year needs all twelve of its months billed; a rate also needs the December before.
 */
export const SOFTWARE_HISTORY_VERSION = 'software-history-1';

type Decimal = InstanceType<typeof D>;

interface SaasYear {
  readonly year: string;
  readonly arr: Decimal;
  readonly nrr: Decimal | null;
  readonly grr: Decimal | null;
  readonly logoChurn: Decimal | null;
  readonly evidenceIds: readonly string[];
}

/** ARR, retention and logo churn by calendar year. */
export function saasYears(evidence: readonly PackRuleEvidence[]): SaasYear[] {
  const revenue = monthlyRevenue(evidence);
  if (!revenue) return [];
  const billed = new Set(revenue.months);
  const whole = [...new Set(revenue.months.map((month) => month.slice(0, 4)))]
    .sort()
    .filter((year) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).every((month) => billed.has(month)));
  return whole.map((year) => {
    const december = revenue.at(`${year}-12`);
    const before = whole.includes(String(Number(year) - 1)) ? revenue.at(`${Number(year) - 1}-12`) : null;
    const rows = [...december.values()].flatMap((entry) => entry.rows);
    if (!before || before.size === 0) return { year, arr: revenue.total(`${year}-12`).times(12), nrr: null, grr: null, logoChurn: null, evidenceIds: rows.map((row) => row.id) };
    let opening = new D(0);
    let closing = new D(0);
    let kept = new D(0);
    let lost = 0;
    for (const [customer, entry] of before) {
      const now = december.get(customer)?.mrr ?? new D(0);
      opening = opening.plus(entry.mrr);
      closing = closing.plus(now);
      kept = kept.plus(D.min(now, entry.mrr));
      if (now.isZero()) lost += 1;
    }
    const cited = [...before.values(), ...december.values()].flatMap((entry) => entry.rows.slice(-1)).map((row) => row.id);
    return {
      year,
      arr: revenue.total(`${year}-12`).times(12),
      nrr: opening.isZero() ? null : closing.div(opening),
      grr: opening.isZero() ? null : kept.div(opening),
      logoChurn: new D(lost).div(before.size),
      evidenceIds: [...new Set(cited)],
    };
  });
}

const yearsOf = (pick: (year: SaasYear) => Decimal | null, scale: number) => (evidence: readonly PackRuleEvidence[]): DriverYear[] =>
  saasYears(evidence).flatMap((year) => {
    const value = pick(year);
    return value === null ? [] : [{ year: year.year, value: value.toFixed(scale), evidenceIds: year.evidenceIds.slice(0, MAX_CITED) }];
  });

const computed = (key: string, label: string, unit: DriverSpec['unit'], formula: string, compute: DriverSpec['compute']): DriverSpec => ({
  key,
  label,
  unit,
  evidenceType: INVOICE_LINE,
  mode: 'SUM',
  numerator: [],
  formula,
  ...(compute ? { compute } : {}),
});

export const SOFTWARE_DRIVERS = {
  arr: computed('arr', 'ARR (December)', 'MONEY', 'December’s recurring revenue × 12, invoice lines spread over their service period', yearsOf((year) => year.arr, 2)),
  nrr: computed('nrr', 'Net revenue retention', 'RATIO', 'December’s revenue from the customers billed the December before ÷ their revenue then', yearsOf((year) => year.nrr, 4)),
  grr: computed('grr', 'Gross revenue retention', 'RATIO', 'As net retention, each customer capped at its revenue the December before', yearsOf((year) => year.grr, 4)),
  logoChurn: computed('logo_churn', 'Logo churn', 'RATIO', 'Customers billed the December before and not this December ÷ the customers billed then', yearsOf((year) => year.logoChurn, 4)),
} as const;

/** A software business's key expenses for the multi-year P&L trend: hosting, R&D, sales and marketing. */
export const SOFTWARE_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'hosting', label: 'Hosting and infrastructure', pattern: /\b(?:hosting|infrastructure|cloud)\b/i },
  { key: 'rd', label: 'Research and development', pattern: /\bresearch and development\b|\bR&D\b|\bengineering\b/i },
  { key: 'sales', label: 'Sales and marketing', pattern: /\bsales\b|\bmarketing\b/i },
];

export const SOFTWARE_HISTORY: PackHistorySpec = {
  drivers: [SOFTWARE_DRIVERS.arr, SOFTWARE_DRIVERS.nrr, SOFTWARE_DRIVERS.grr, SOFTWARE_DRIVERS.logoChurn],
  keyExpenses: SOFTWARE_KEY_EXPENSES,
  driverImport: 'BILLING_INVOICE_LINE',
  driverLabel: 'Billing',
  driverWhat: 'billing history',
};

/** Net revenue retention falling every year by this much or more, first year to last (5 points). */
export const NRR_DECLINE_POINTS = '0.05';

export const SAAS_NRR_TREND = driverTrendRule(
  {
    id: 'saas-nrr-trend',
    driver: SOFTWARE_DRIVERS.nrr,
    adverse: 'DOWN',
    threshold: NRR_DECLINE_POINTS,
    domain: 'COMMERCIAL',
    advice: 'Each year the customers already on the books add less: expansion is slowing or churn is rising. Check the retention a KPI pack reports against these years before carrying it into the scenarios.',
  },
  SOFTWARE_HISTORY,
);

export const [SAAS_PNL_TREND, SAAS_PNL_MARGIN_DRIFT, SAAS_PNL_EXPENSE_OUTPACING] = pnlTrendRules('saas', SOFTWARE_KEY_EXPENSES) as [PackRule, PackRule, PackRule];

/** The recent run against the long run (T-185): quiet until ten years or more are read. */
export const SAAS_RECENT_RUN = recentRunRule('saas', SOFTWARE_HISTORY);

export const SOFTWARE_HISTORY_RULES: readonly PackRule[] = [SAAS_PNL_TREND, SAAS_PNL_MARGIN_DRIFT, SAAS_PNL_EXPENSE_OUTPACING, SAAS_NRR_TREND, SAAS_RECENT_RUN];

export const SOFTWARE_RULES: readonly PackRule[] = [...SOFTWARE_BASE_RULES, ...SOFTWARE_HISTORY_RULES];

/** The evidence the software history reads. */
export const SOFTWARE_HISTORY_EVIDENCE = [INVOICE_LINE, PNL_LINE] as const;

/** GET …/metrics/pack for a software pact: the SaaS engine's figures live on their own screen; this adds the years. */
export function softwareHistoryReport(input: PackMetricsInput, calculator: { readonly id: string; readonly version: string }): PackMetricsReport {
  return { calculator: calculator.id, version: calculator.version, currency: input.currency, metrics: [], history: packHistory(SOFTWARE_HISTORY, input.evidence, input).table };
}
