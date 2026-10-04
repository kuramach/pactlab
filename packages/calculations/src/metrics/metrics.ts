import type Decimal from 'decimal.js';
import { D, money, ratio, sum } from './decimal';
import { FxTable } from './fx';
import {
  buildRevenueLedger,
  LEDGER_INCLUSION_POLICY,
  snapshotMonth,
  type Contribution,
  type MonthSnapshot,
  type RevenueLedger,
} from './ledger';
import { addMonths, isMonth, monthRange } from './months';
import {
  METRICS_ENGINE_VERSION,
  type Exclusion,
  type FxRateInput,
  type MoneyValue,
  type RevenueLineInput,
  type SourceRef,
} from './types';

/** Monthly history kept for series, bridges and cohorts. */
export const MAX_HISTORY_MONTHS = 36;

export interface MetricsInput {
  readonly lines: readonly RevenueLineInput[];
  readonly fxRates: readonly FxRateInput[];
  readonly baseCurrency: string;
  /** `YYYY-MM`: metrics are measured at this month's end. */
  readonly asOfMonth: string;
}

export type MetricKey =
  | 'MRR'
  | 'ARR'
  | 'ACTIVE_CUSTOMERS'
  | 'ARPA'
  | 'NEW_MRR'
  | 'EXPANSION_MRR'
  | 'CONTRACTION_MRR'
  | 'CHURNED_MRR'
  | 'REACTIVATION_MRR'
  | 'NRR'
  | 'GRR'
  | 'LOGO_RETENTION'
  | 'TOP_CUSTOMER_SHARE'
  | 'TOP_5_CUSTOMER_SHARE'
  | 'TOP_10_CUSTOMER_SHARE';

/** A metric with everything needed to re-derive and explain it. */
export interface MetricResult {
  readonly key: MetricKey;
  readonly label: string;
  readonly unit: 'MONEY' | 'RATIO' | 'COUNT';
  /** Decimal string (money at currency scale, ratios at four places, counts as integers). */
  readonly value: string | null;
  readonly currency: string | null;
  readonly formula: string;
  readonly timeBasis: string;
  readonly inclusionPolicy: string;
  /** Evidence (invoice lines and FX fixings) the value was computed from. */
  readonly inputs: readonly SourceRef[];
  readonly unavailableReason: string | null;
}

export interface MrrBridge {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly opening: MoneyValue;
  readonly newMrr: MoneyValue;
  readonly expansion: MoneyValue;
  readonly contraction: MoneyValue;
  readonly churned: MoneyValue;
  readonly reactivation: MoneyValue;
  readonly closing: MoneyValue;
  readonly movements: readonly {
    customerId: string;
    customerName: string | null;
    kind: 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURN' | 'REACTIVATION';
    from: MoneyValue;
    to: MoneyValue;
  }[];
}

export interface CustomerArr {
  readonly customerId: string;
  readonly customerName: string | null;
  readonly mrr: MoneyValue;
  readonly arr: MoneyValue;
  readonly share: string | null;
  readonly contributions: readonly Contribution[];
}

export interface SaasMetricsReport {
  readonly engineVersion: string;
  readonly asOfMonth: string;
  readonly baseCurrency: string;
  readonly coverageStart: string | null;
  readonly inclusionPolicy: string;
  readonly metrics: readonly MetricResult[];
  readonly bridge: MrrBridge | null;
  readonly series: readonly {
    month: string;
    mrr: MoneyValue;
    arr: MoneyValue;
    activeCustomers: number;
  }[];
  /** As-of customers by ARR, largest first. */
  readonly customers: readonly CustomerArr[];
  /** Ledger exclusions plus as-of-month conversion failures. */
  readonly exclusions: readonly Exclusion[];
}

/** Prepared ledger, FX table and month-end snapshots shared by metrics, cohorts and reconciliation. */
export interface MetricsWorkspace {
  readonly input: MetricsInput;
  readonly ledger: RevenueLedger;
  readonly fx: FxTable;
  readonly fxIssues: readonly Exclusion[];
  readonly months: readonly string[];
  readonly snapshots: ReadonlyMap<string, MonthSnapshot>;
}

export function prepareWorkspace(input: MetricsInput): MetricsWorkspace {
  if (!isMonth(input.asOfMonth)) throw new Error('asOfMonth must be YYYY-MM');
  if (!/^[A-Z]{3}$/.test(input.baseCurrency)) throw new Error('baseCurrency must be ISO 4217');
  const ledger = buildRevenueLedger(input.lines);
  const { table: fx, issues: fxIssues } = FxTable.fromRates(input.fxRates);
  const earliest = addMonths(input.asOfMonth, -(MAX_HISTORY_MONTHS - 1));
  const first = ledger.firstMonth && ledger.firstMonth > earliest ? ledger.firstMonth : earliest;
  const months =
    ledger.firstMonth && first <= input.asOfMonth ? monthRange(first, input.asOfMonth) : [];
  const snapshots = new Map<string, MonthSnapshot>();
  for (const month of months)
    snapshots.set(month, snapshotMonth(ledger, month, input.baseCurrency, fx));
  return { input, ledger, fx, fxIssues, months, snapshots };
}

function refsOf(
  snapshots: readonly (MonthSnapshot | undefined)[],
  customerIds?: ReadonlySet<string>,
): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const customer of snapshot.customers.values()) {
      if (customerIds && !customerIds.has(customer.customerId)) continue;
      for (const contribution of customer.contributions) {
        refs.set(contribution.ref.evidenceId, contribution.ref);
        for (const ref of contribution.fx?.refs ?? []) refs.set(ref.evidenceId, ref);
      }
    }
  }
  return [...refs.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

const MONTH_END =
  'Month-end snapshot: a line counts when its service period contains the last day of the month.';

function bridgeFor(ws: MetricsWorkspace, month: string): MrrBridge | null {
  const current = ws.snapshots.get(month);
  const previous = ws.snapshots.get(addMonths(month, -1));
  if (!current || !previous) return null;
  const base = ws.input.baseCurrency;
  const earlier = ws.months.filter((m) => m < previous.month);
  const totals = {
    NEW: new D(0),
    EXPANSION: new D(0),
    CONTRACTION: new D(0),
    CHURN: new D(0),
    REACTIVATION: new D(0),
  };
  const movements: MrrBridge['movements'][number][] = [];
  const ids = new Set([...previous.customers.keys(), ...current.customers.keys()]);
  for (const id of [...ids].sort()) {
    const before = previous.customers.get(id)?.mrr ?? new D(0);
    const after = current.customers.get(id)?.mrr ?? new D(0);
    if (before.equals(after)) continue;
    let kind: keyof typeof totals;
    if (before.isZero()) {
      kind = earlier.some((m) => ws.snapshots.get(m)?.customers.has(id)) ? 'REACTIVATION' : 'NEW';
    } else if (after.isZero()) kind = 'CHURN';
    else kind = after.greaterThan(before) ? 'EXPANSION' : 'CONTRACTION';
    totals[kind] = totals[kind].plus(after.minus(before).abs());
    movements.push({
      customerId: id,
      customerName: (current.customers.get(id) ?? previous.customers.get(id))?.customerName ?? null,
      kind,
      from: money(before, base),
      to: money(after, base),
    });
  }
  return {
    fromMonth: previous.month,
    toMonth: month,
    opening: money(previous.total, base),
    newMrr: money(totals.NEW, base),
    expansion: money(totals.EXPANSION, base),
    contraction: money(totals.CONTRACTION, base),
    churned: money(totals.CHURN, base),
    reactivation: money(totals.REACTIVATION, base),
    closing: money(current.total, base),
    movements,
  };
}

/** Compute the SaaS metric set at the as-of month. Pure and deterministic. */
export function computeSaasMetrics(
  input: MetricsInput,
  workspace?: MetricsWorkspace,
): SaasMetricsReport {
  const ws = workspace ?? prepareWorkspace(input);
  const base = input.baseCurrency;
  const asOf = input.asOfMonth;
  const current = ws.snapshots.get(asOf);
  const yearAgo = ws.snapshots.get(addMonths(asOf, -12));
  const noHistory = `Ledger has no included revenue at the end of ${asOf}`;
  const metrics: MetricResult[] = [];
  const add = (
    metric: Omit<MetricResult, 'inclusionPolicy' | 'currency' | 'unavailableReason'> &
      Partial<MetricResult>,
  ) =>
    metrics.push({
      inclusionPolicy: LEDGER_INCLUSION_POLICY,
      currency: null,
      unavailableReason: null,
      ...metric,
    });
  const moneyValue = (value: Decimal | null) => (value ? money(value, base).amount : null);

  const mrr = current?.total ?? null;
  const currentRefs = refsOf([current]);
  add({
    key: 'MRR',
    label: 'MRR',
    unit: 'MONEY',
    currency: base,
    value: moneyValue(mrr),
    formula:
      'Σ monthly-normalized recurring line amounts, converted to the deal base currency at the month-end fixing',
    timeBasis: MONTH_END,
    inputs: currentRefs,
    unavailableReason: mrr ? null : noHistory,
  });
  add({
    key: 'ARR',
    label: 'ARR',
    unit: 'MONEY',
    currency: base,
    value: moneyValue(mrr ? mrr.times(12) : null),
    formula: 'MRR × 12',
    timeBasis: MONTH_END,
    inputs: currentRefs,
    unavailableReason: mrr ? null : noHistory,
  });
  const active = current?.customers.size ?? 0;
  add({
    key: 'ACTIVE_CUSTOMERS',
    label: 'Active customers',
    unit: 'COUNT',
    value: current ? String(active) : null,
    formula: 'Count of customers with MRR > 0',
    timeBasis: MONTH_END,
    inputs: currentRefs,
    unavailableReason: current ? null : noHistory,
  });
  add({
    key: 'ARPA',
    label: 'ARPA',
    unit: 'MONEY',
    currency: base,
    value: mrr && active > 0 ? moneyValue(mrr.dividedBy(active)) : null,
    formula: 'MRR ÷ active customers',
    timeBasis: MONTH_END,
    inputs: currentRefs,
    unavailableReason: mrr && active > 0 ? null : noHistory,
  });

  const bridge = bridgeFor(ws, asOf);
  const bridgeRefs = refsOf([current, ws.snapshots.get(addMonths(asOf, -1))]);
  const bridgeReason = bridge
    ? null
    : `Needs ledger coverage for ${addMonths(asOf, -1)} and ${asOf}`;
  for (const [key, label, field, formula] of [
    ['NEW_MRR', 'New MRR', 'newMrr', 'MRR from customers with no MRR in any earlier covered month'],
    [
      'EXPANSION_MRR',
      'Expansion MRR',
      'expansion',
      'Σ increases for customers active in both months',
    ],
    [
      'CONTRACTION_MRR',
      'Contraction MRR',
      'contraction',
      'Σ decreases for customers active in both months',
    ],
    [
      'CHURNED_MRR',
      'Churned MRR',
      'churned',
      'Prior-month MRR of customers with no MRR this month',
    ],
    [
      'REACTIVATION_MRR',
      'Reactivation MRR',
      'reactivation',
      'MRR from customers returning after at least one month without MRR',
    ],
  ] as const) {
    add({
      key,
      label,
      unit: 'MONEY',
      currency: base,
      value: bridge ? bridge[field].amount : null,
      formula: `${formula}. Converted at each month-end fixing, so FX movement appears as expansion or contraction.`,
      timeBasis: `Month-over-month: ${addMonths(asOf, -1)} → ${asOf}`,
      inputs: bridgeRefs,
      unavailableReason: bridgeReason,
    });
  }

  const retentionReason =
    yearAgo && current
      ? null
      : `Needs ledger coverage for ${addMonths(asOf, -12)} (12 months before ${asOf})`;
  const cohort = new Set(yearAgo?.customers.keys() ?? []);
  const start = sum([...(yearAgo?.customers.values() ?? [])].map((c) => c.mrr));
  const now = [...cohort].map((id) => current?.customers.get(id)?.mrr ?? new D(0));
  const startById = [...cohort].map((id) => yearAgo?.customers.get(id)?.mrr ?? new D(0));
  const retentionRefs = refsOf([yearAgo, current], cohort);
  const retention = (value: string | null) => (retentionReason ? null : value);
  const yoy = `Trailing twelve months: customers with MRR at the end of ${addMonths(asOf, -12)}, measured at the end of ${asOf}`;
  add({
    key: 'NRR',
    label: 'Net revenue retention',
    unit: 'RATIO',
    value: retention(ratio(sum(now), start)),
    formula: 'Σ current MRR of the year-ago customer set ÷ Σ their year-ago MRR',
    timeBasis: yoy,
    inputs: retentionRefs,
    unavailableReason: retentionReason,
  });
  add({
    key: 'GRR',
    label: 'Gross revenue retention',
    unit: 'RATIO',
    value: retention(
      ratio(sum(now.map((value, i) => D.min(value, startById[i] ?? new D(0)))), start),
    ),
    formula: 'Σ min(current MRR, year-ago MRR) of the year-ago customer set ÷ Σ their year-ago MRR',
    timeBasis: yoy,
    inputs: retentionRefs,
    unavailableReason: retentionReason,
  });
  add({
    key: 'LOGO_RETENTION',
    label: 'Logo retention',
    unit: 'RATIO',
    value: retention(
      ratio(new D(now.filter((value) => value.greaterThan(0)).length), new D(cohort.size)),
    ),
    formula: 'Year-ago customers still with MRR > 0 ÷ year-ago customers',
    timeBasis: yoy,
    inputs: retentionRefs,
    unavailableReason: retentionReason,
  });

  const ranked = [...(current?.customers.values() ?? [])].sort(
    (a, b) => b.mrr.comparedTo(a.mrr) || a.customerId.localeCompare(b.customerId),
  );
  const customers: CustomerArr[] = ranked.map((customer) => ({
    customerId: customer.customerId,
    customerName: customer.customerName,
    mrr: money(customer.mrr, base),
    arr: money(customer.mrr.times(12), base),
    share: mrr ? ratio(customer.mrr, mrr) : null,
    contributions: customer.contributions,
  }));
  for (const [key, label, top] of [
    ['TOP_CUSTOMER_SHARE', 'Largest customer share of ARR', 1],
    ['TOP_5_CUSTOMER_SHARE', 'Top 5 customers share of ARR', 5],
    ['TOP_10_CUSTOMER_SHARE', 'Top 10 customers share of ARR', 10],
  ] as const) {
    const topIds = new Set(ranked.slice(0, top).map((c) => c.customerId));
    add({
      key,
      label,
      unit: 'RATIO',
      value: mrr ? ratio(sum(ranked.slice(0, top).map((c) => c.mrr)), mrr) : null,
      formula: `Σ ARR of the ${top === 1 ? 'largest customer' : `${top} largest customers`} ÷ total ARR`,
      timeBasis: MONTH_END,
      inputs: refsOf([current], topIds),
      unavailableReason: mrr ? null : noHistory,
    });
  }

  return {
    engineVersion: METRICS_ENGINE_VERSION,
    asOfMonth: asOf,
    baseCurrency: base,
    coverageStart: ws.months[0] ?? null,
    inclusionPolicy: LEDGER_INCLUSION_POLICY,
    metrics,
    bridge,
    series: ws.months.map((month) => {
      const snapshot = ws.snapshots.get(month);
      const total = snapshot?.total ?? new D(0);
      return {
        month,
        mrr: money(total, base),
        arr: money(total.times(12), base),
        activeCustomers: snapshot?.customers.size ?? 0,
      };
    }),
    customers,
    exclusions: [
      ...ws.ledger.exclusions.map(
        ({ currency: _c, monthly: _m, firstMonth: _f, lastMonth: _l, ...exclusion }) => exclusion,
      ),
      ...ws.fxIssues,
      ...(current?.exclusions ?? []),
    ],
  };
}
