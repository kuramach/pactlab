import { D } from '@pactlab/calculations';
import type { AiUsageRow, CostRate, HostingCostLine, StorageUsageRow } from '@pactlab/db';

type Decimal = InstanceType<typeof D>;
const BYTES_PER_GB = new D(1024).pow(3);
/** S3 bills GB-months; a byte held for 30 days is one byte-month here (labelled an estimate). */
const DAYS_PER_MONTH = new D(30);
const MILLION = new D(1_000_000);
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

export interface CostRow {
  readonly key: string;
  readonly label: string;
  /** A second line under the label (organization of a pact, auth method, …). */
  readonly detail?: string;
  readonly amount: string;
}

/** The rate for a kind and key in force on a day (the latest that started on or before it), or null. */
export function rateOn(rates: readonly CostRate[], kind: CostRate['kind'], key: string, day: string): CostRate | null {
  let found: CostRate | null = null;
  for (const rate of rates) {
    if (rate.kind !== kind || rate.key !== key || rate.effectiveFrom > day) continue;
    if (!found || rate.effectiveFrom > found.effectiveFrom) found = rate;
  }
  return found;
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

interface Bucket {
  label: string;
  detail?: string;
  ai: Decimal;
  storage: Decimal;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  gbMonths: Decimal;
}

/**
 * Metered, estimated cost from this environment's own records: AI tokens × the model's rate on
 * the run's day, and document storage × the GB-month rate in force at the end of the period.
 * Anything without a rate is counted (tokens, GB) and named in `missingRates`, never priced.
 */
export function meteredCost(input: { ai: readonly AiUsageRow[]; storage: readonly StorageUsageRow[]; rates: readonly CostRate[]; periodEnd: string }) {
  const missing = new Set<string>();
  const buckets = { organization: new Map<string, Bucket>(), pact: new Map<string, Bucket>(), person: new Map<string, Bucket>(), authMethod: new Map<string, Bucket>(), model: new Map<string, Bucket>() };
  const bucket = (map: Map<string, Bucket>, key: string, label: string, detail?: string) => {
    let found = map.get(key);
    if (!found) {
      found = { label, ...(detail ? { detail } : {}), ai: new D(0), storage: new D(0), runs: 0, inputTokens: 0, outputTokens: 0, gbMonths: new D(0) };
      map.set(key, found);
    }
    return found;
  };
  const targets = (row: AiUsageRow | StorageUsageRow) => [
    bucket(buckets.organization, row.organizationId, row.organizationName, authLabel(row.authMethod)),
    bucket(buckets.pact, row.dealId, row.dealName, row.organizationName),
    bucket(buckets.person, row.userId ?? 'unknown', row.userEmail ?? (row.userId ? 'A removed user' : 'Before per-person tracking'), row.organizationName),
    bucket(buckets.authMethod, row.authMethod, authLabel(row.authMethod)),
  ];

  let aiTotal = new D(0);
  for (const row of input.ai) {
    const inRate = rateOn(input.rates, 'BEDROCK_INPUT_PER_MTOK', row.modelId, row.day);
    const outRate = rateOn(input.rates, 'BEDROCK_OUTPUT_PER_MTOK', row.modelId, row.day);
    if (!inRate) missing.add(`BEDROCK_INPUT_PER_MTOK ${row.modelId}`);
    if (!outRate) missing.add(`BEDROCK_OUTPUT_PER_MTOK ${row.modelId}`);
    const cost = (inRate ? new D(row.inputTokens).div(MILLION).times(inRate.unitPrice) : new D(0)).plus(outRate ? new D(row.outputTokens).div(MILLION).times(outRate.unitPrice) : new D(0));
    aiTotal = aiTotal.plus(cost);
    for (const target of [...targets(row), bucket(buckets.model, row.modelId, row.modelId)]) {
      target.ai = target.ai.plus(cost);
      target.runs += row.runs;
      target.inputTokens += row.inputTokens;
      target.outputTokens += row.outputTokens;
    }
  }

  const storageRate = rateOn(input.rates, 'S3_STORAGE_GB_MONTH', 'standard', input.periodEnd);
  if (input.storage.length > 0 && !storageRate) missing.add('S3_STORAGE_GB_MONTH standard');
  let storageTotal = new D(0);
  for (const row of input.storage) {
    const gbMonths = new D(row.byteDays).div(BYTES_PER_GB).div(DAYS_PER_MONTH);
    const cost = storageRate ? gbMonths.times(storageRate.unitPrice) : new D(0);
    storageTotal = storageTotal.plus(cost);
    for (const target of targets(row)) {
      target.storage = target.storage.plus(cost);
      target.gbMonths = target.gbMonths.plus(gbMonths);
    }
  }

  const view = (map: Map<string, Bucket>) =>
    [...map.entries()]
      .map(([key, entry]) => ({ key, entry, total: entry.ai.plus(entry.storage) }))
      .sort((a, b) => b.total.comparedTo(a.total) || b.entry.inputTokens + b.entry.outputTokens - (a.entry.inputTokens + a.entry.outputTokens))
      .map(({ key, entry, total }) => ({
        key,
        label: entry.label,
        ...(entry.detail ? { detail: entry.detail } : {}),
        ai: money(entry.ai),
        storage: money(entry.storage),
        total: money(total),
        runs: entry.runs,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        gbMonths: entry.gbMonths.toDecimalPlaces(4).toString(),
      }));

  return {
    total: money(aiTotal.plus(storageTotal)),
    ai: money(aiTotal),
    storage: money(storageTotal),
    byOrganization: view(buckets.organization),
    byAuthMethod: view(buckets.authMethod),
    byPact: view(buckets.pact),
    byPerson: view(buckets.person),
    byModel: view(buckets.model),
    missingRates: [...missing].sort(),
  };
}

function authLabel(method: string): string {
  return method === 'AUTH0' ? 'Company SSO' : method === 'EMAIL_CODE' ? 'Email code' : method;
}

/** What AWS billed this environment minus what is metered: the shared infrastructure, never spread. */
export function unallocated(actualForEnvironment: string, metered: string): string {
  return money(new D(actualForEnvironment).minus(metered));
}
