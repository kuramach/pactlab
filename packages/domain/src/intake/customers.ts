/**
 * Customer contract gaps (T-098): which of the largest customers by billed
 * revenue have no contract filed. Revenue is summed exactly (scaled
 * integers, never floating point) from the billing evidence; contracts are
 * matched by the counterparty name intake read from each one.
 */
export const TOP_CUSTOMERS = 10;

const SCALE = 4;
const LEGAL_SUFFIXES = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|b\.?v|s\.?a|ag|pty|lp|llp)\b\.?/g;

/** "Northgate Logistics, LLC (synthetic)" and "Northgate Logistics" are the same customer. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A decimal string as an integer scaled by 10^4; null when it is not a plain decimal. */
export function scaledAmount(value: string): bigint | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const scaled = BigInt(match[2] ?? '0') * 10n ** BigInt(SCALE) + BigInt(fraction);
  return match[1] ? -scaled : scaled;
}

export interface BilledLine {
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly amount: string;
}

export interface CustomerGap {
  /** How many top customers were checked (fewer when billing has fewer customers). */
  readonly checked: number;
  /** Top customers with no contract filed, largest first. */
  readonly missing: readonly string[];
}

/** The top customers by billed revenue that have no contract with a matching counterparty. */
export function customerContractGaps(lines: readonly BilledLine[], counterparties: readonly string[], top = TOP_CUSTOMERS): CustomerGap {
  const totals = new Map<string, { name: string; total: bigint }>();
  for (const line of lines) {
    const key = line.customerId ?? line.customerName;
    const amount = scaledAmount(line.amount);
    if (!key || amount === null) continue;
    const entry = totals.get(key) ?? { name: line.customerName ?? key, total: 0n };
    entry.total += amount;
    if (line.customerName) entry.name = line.customerName;
    totals.set(key, entry);
  }
  const ranked = [...totals.values()]
    .filter((entry) => entry.total > 0n)
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : a.name.localeCompare(b.name)))
    .slice(0, top);
  const contracted = counterparties.map(normalizeCompanyName).filter((name) => name.length > 0);
  const covered = (name: string) => {
    const wanted = normalizeCompanyName(name);
    return wanted.length > 0 && contracted.some((have) => have === wanted || have.includes(wanted) || wanted.includes(have));
  };
  return { checked: ranked.length, missing: ranked.filter((entry) => !covered(entry.name)).map((entry) => entry.name) };
}
