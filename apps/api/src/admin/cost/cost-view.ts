import { D } from '@pactlab/calculations';
import type { HostingCostLine } from '@pactlab/db';

type Decimal = InstanceType<typeof D>;
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

export interface CostRow {
  readonly key: string;
  readonly label: string;
  /** A second line under the label (organization of a pact, auth method, …). */
  readonly detail?: string;
  readonly amount: string;
}

const sumBy = (lines: readonly HostingCostLine[], keyOf: (line: HostingCostLine) => string) => {
  const totals = new Map<string, Decimal>();
  for (const line of lines) totals.set(keyOf(line), (totals.get(keyOf(line)) ?? new D(0)).plus(line.amount));
  return totals;
};

const rowsOf = (totals: Map<string, Decimal>, label: (key: string) => string = (key) => key): CostRow[] =>
  [...totals.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([key, amount]) => ({ key, label: label(key), amount: money(amount) }));

/** Real spend as AWS bills it: by month (stacked by environment), by environment and by AWS product. */
export function actualSpend(lines: readonly HostingCostLine[]) {
  const months = [...new Set(lines.map((line) => line.periodStart.slice(0, 7)))].sort();
  const environments = [...new Set(lines.map((line) => line.environment))].sort();
  const byMonth = months.map((month) => {
    const inMonth = lines.filter((line) => line.periodStart.startsWith(month));
    const perEnvironment = sumBy(inMonth, (line) => line.environment);
    return {
      month,
      total: money([...perEnvironment.values()].reduce((sum, value) => sum.plus(value), new D(0))),
      byEnvironment: Object.fromEntries(environments.map((environment) => [environment, money(perEnvironment.get(environment) ?? new D(0))])),
      estimated: inMonth.some((line) => line.estimated),
    };
  });
  return {
    total: money(lines.reduce((sum, line) => sum.plus(line.amount), new D(0))),
    currency: lines[0]?.currency ?? 'USD',
    environments,
    byMonth,
    byEnvironment: rowsOf(sumBy(lines, (line) => line.environment)),
    byService: rowsOf(sumBy(lines, (line) => line.service)),
    /** Bedrock shows up as "Amazon Bedrock" and, for Claude, "Claude … (Amazon Bedrock Edition)". */
    bedrock: lines.filter((line) => /bedrock/i.test(line.service)),
  };
}

/** What AWS billed this environment minus what is metered: the shared infrastructure, never spread. */
export function unallocated(actualForEnvironment: string, metered: string): string {
  return money(new D(actualForEnvironment).minus(metered));
}
