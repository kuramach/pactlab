import { D, money, ratio, sum } from './decimal';
import { prepareWorkspace, type MetricsInput, type MetricsWorkspace } from './metrics';
import { METRICS_ENGINE_VERSION, type MoneyValue } from './types';

export interface CohortRow {
  /** `YYYY-MM` of the customers' first month with MRR. */
  readonly cohort: string;
  /**
   * True for the first covered month: those customers may have started
   * earlier than the ledger's history, so their true cohort is unknown.
   */
  readonly openingBalance: boolean;
  readonly customers: number;
  readonly startingMrr: MoneyValue;
  readonly cells: readonly {
    offset: number;
    month: string;
    mrr: MoneyValue;
    revenueRetention: string | null;
    logoRetention: string | null;
  }[];
}

export interface CohortReport {
  readonly engineVersion: string;
  readonly asOfMonth: string;
  readonly baseCurrency: string;
  readonly formula: string;
  readonly rows: readonly CohortRow[];
}

/** Revenue and logo retention by first-revenue month, measured at each month-end. */
export function computeCohorts(input: MetricsInput, workspace?: MetricsWorkspace): CohortReport {
  const ws = workspace ?? prepareWorkspace(input);
  const base = input.baseCurrency;
  const firstMonth = new Map<string, string>();
  for (const month of ws.months)
    for (const id of ws.snapshots.get(month)?.customers.keys() ?? [])
      if (!firstMonth.has(id)) firstMonth.set(id, month);

  const rows: CohortRow[] = [];
  for (const [index, cohort] of ws.months.entries()) {
    const members = [...firstMonth.entries()]
      .filter(([, month]) => month === cohort)
      .map(([id]) => id);
    if (members.length === 0) continue;
    const startSnapshot = ws.snapshots.get(cohort);
    const starting = sum(members.map((id) => startSnapshot?.customers.get(id)?.mrr ?? new D(0)));
    rows.push({
      cohort,
      openingBalance: index === 0,
      customers: members.length,
      startingMrr: money(starting, base),
      cells: ws.months.slice(index).map((month, offset) => {
        const snapshot = ws.snapshots.get(month);
        const values = members.map((id) => snapshot?.customers.get(id)?.mrr ?? new D(0));
        const total = sum(values);
        return {
          offset,
          month,
          mrr: money(total, base),
          revenueRetention: ratio(total, starting),
          logoRetention: ratio(
            new D(values.filter((value) => value.greaterThan(0)).length),
            new D(members.length),
          ),
        };
      }),
    });
  }
  return {
    engineVersion: METRICS_ENGINE_VERSION,
    asOfMonth: input.asOfMonth,
    baseCurrency: base,
    formula:
      'Cohort MRR at month-end ÷ cohort MRR in its first month; logos with MRR > 0 ÷ cohort logos',
    rows,
  };
}
