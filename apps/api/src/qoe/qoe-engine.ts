import { comparePnlFigure, D, PNL_EBITDA_BASIS, pnlForPeriod, type PnlPeriod } from '@pactlab/calculations';
import {
  addBackCounts,
  QOE_COMPONENT_REGISTRY,
  type QoeAdjustmentCategory,
  type QoeInclusionDecision,
  type QoeRecurrence,
  type QoeVerificationStatus,
  type QoeWorkingCapitalComponent,
} from '@pactlab/domain';

/**
 * The quality-of-earnings arithmetic (T-135), deterministic and decimal-only: the same entries
 * always give the same schedule. Models never compute anything here; every figure out traces to
 * the cited entries in. Changing a rule is a new QOE_ENGINE_VERSION, never a silent edit.
 *
 * qoe-2 (T-149): reported revenue, cost of revenue, operating expenses and EBITDA per period come
 * from the imported P&L where it covers the period, each citing its source rows. A cited filed
 * figure that agrees (within one unit) is shown beside it; one that disagrees is a conflict, and
 * adjusted EBITDA waits for a person to settle it — neither figure is picked silently.
 */
export const QOE_ENGINE_VERSION = 'qoe-2';

/** How many of the latest month-ends the peg averages, and the fewest it needs. */
export const PEG_TRAILING_PERIODS = 12;
export const PEG_MINIMUM_PERIODS = 3;

export interface Cited {
  entryKey: string;
  version: number;
  citation: { documentId: string; pageNumber: number; quote: string };
}

export interface ReportedEbitdaInput extends Cited {
  period: string;
  label: string;
  amount: string;
  currency: string;
}
export interface AdjustmentInput extends Cited {
  period: string;
  category: QoeAdjustmentCategory;
  label: string;
  /** Signed: positive raises EBITDA, negative lowers it. */
  amount: string;
  currency: string;
  rationale: string | null;
  findingId: string | null;
}
export interface AddBackInput extends Cited {
  period: string;
  category: QoeAdjustmentCategory;
  label: string;
  claimed: string;
  currency: string;
  sellerRationale: string | null;
  status: QoeVerificationStatus;
  verified: string | null;
  verificationCitation: Cited['citation'] | null;
  recurrence: QoeRecurrence;
  inclusion: QoeInclusionDecision | null;
  decisionReason: string | null;
  findingId: string | null;
}
export interface WorkingCapitalInput extends Cited {
  periodEnd: string;
  component: QoeWorkingCapitalComponent;
  label: string;
  amount: string;
  currency: string;
}

const money = (value: InstanceType<typeof D>) => value.toFixed(2);

export interface AddBackLine extends AddBackInput {
  counts: boolean;
  /** The figure adjusted EBITDA carries for this add-back: zero when it does not count. */
  counted: string;
  /** Why it counts or not, in words the schedule and report print. */
  treatment: string;
}

/** Where a period's reported EBITDA comes from. */
export type ReportedSource = 'IMPORTED_PNL' | 'FILED_STATEMENT' | 'BOTH';

/** An imported P&L and a cited filed statement stating different EBITDA for the same period. */
export interface PnlConflict {
  period: string;
  imported: string;
  filed: string;
  /** Imported less filed. */
  difference: string;
  filedEntry: Cited;
}

export interface PeriodSchedule {
  period: string;
  currency: string;
  /** The imported P&L for this period, with every row it adds up (null when no import covers it). */
  pnl: PnlPeriod | null;
  /** The cited filed figure (a REPORTED_EBITDA entry), shown even when the import supplies the figure. */
  reported: ReportedEbitdaInput | null;
  /** The EBITDA the schedule starts from and where it comes from; null when there is none or the sources disagree. */
  reportedEbitda: { amount: string; source: ReportedSource } | null;
  conflict: PnlConflict | null;
  adjustments: AdjustmentInput[];
  addBacks: AddBackLine[];
  totals: { adjustments: string; addBacksCounted: string; addBacksClaimed: string; addBacksExcluded: string };
  /** Reported + adjustments + counted add-backs. Null without a reported figure, or while the sources disagree. */
  adjustedEbitda: string | null;
  /** What the seller's own claim adds up to: reported + every add-back at its claimed amount. Never merged with the above. */
  sellerAdjustedEbitda: string | null;
  flags: string[];
}

function treatment(line: AddBackInput): { counts: boolean; counted: string; treatment: string } {
  const decided = addBackCounts(line.status, line.inclusion);
  if (!decided.counts) {
    return {
      counts: false,
      counted: '0.00',
      treatment: line.inclusion === 'EXCLUDE' ? 'Excluded by reviewer' : 'Excluded: unverified (default)',
    };
  }
  const amount = decided.basis === 'VERIFIED' ? new D(line.verified ?? '0') : new D(line.claimed);
  const why = line.status === 'UNVERIFIED' ? 'Included by reviewer decision (unverified)' : line.status === 'PARTIALLY_VERIFIED' ? 'Counted at the verified amount' : 'Counted: verified';
  return { counts: true, counted: money(amount), treatment: why };
}

export function adjustedEbitdaSchedule(input: { reported: ReportedEbitdaInput[]; adjustments: AdjustmentInput[]; addBacks: AddBackInput[]; pnl?: readonly PnlPeriod[]; currency?: string }): PeriodSchedule[] {
  const imported = input.pnl ?? [];
  const written = [...new Set([...input.reported, ...input.adjustments, ...input.addBacks].map((row) => row.period))];
  const matched = new Map(written.map((period) => [period, pnlForPeriod(imported, period)]));
  const covered = new Set([...matched.values()].flatMap((pnl) => (pnl && !pnl.rolledUpFrom ? [pnl.period] : [])));
  // Imported periods no entry names are scheduled too: the statement is read in full, per period.
  for (const pnl of imported) if (!covered.has(pnl.period) && !matched.has(pnl.period)) matched.set(pnl.period, pnl);
  const periods = [...matched.keys()].sort();
  return periods.map((period) => {
    const pnl = matched.get(period) ?? null;
    const reported = input.reported.filter((row) => row.period === period).at(-1) ?? null;
    const adjustments = input.adjustments.filter((row) => row.period === period);
    const addBacks = input.addBacks.filter((row) => row.period === period).map((row) => ({ ...row, ...treatment(row) }));
    const currency = reported?.currency ?? adjustments[0]?.currency ?? addBacks[0]?.currency ?? input.currency ?? '';
    const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new D(0));
    const adjustmentsTotal = sum(adjustments.map((row) => row.amount));
    const counted = sum(addBacks.map((row) => row.counted));
    const claimed = sum(addBacks.map((row) => row.claimed));
    const flags: string[] = [];

    let reportedEbitda: PeriodSchedule['reportedEbitda'] = null;
    let conflict: PnlConflict | null = null;
    if (pnl && reported) {
      const compared = comparePnlFigure(pnl.ebitda, reported.amount);
      if (compared.agrees) reportedEbitda = { amount: pnl.ebitda, source: 'BOTH' };
      else {
        conflict = { period, imported: pnl.ebitda, filed: money(new D(reported.amount)), difference: compared.difference, filedEntry: { entryKey: reported.entryKey, version: reported.version, citation: reported.citation } };
        flags.push(`The imported P&L (${pnl.ebitda}) and the filed statement (${money(new D(reported.amount))}) disagree by ${compared.difference}: a finding to review. Adjusted EBITDA waits until one is corrected or withdrawn.`);
      }
    } else if (pnl) reportedEbitda = { amount: pnl.ebitda, source: 'IMPORTED_PNL' };
    else if (reported) reportedEbitda = { amount: money(new D(reported.amount)), source: 'FILED_STATEMENT' };
    if (!pnl && !reported) flags.push('No reported EBITDA for this period (no imported P&L covers it and none is cited): adjusted EBITDA is not computed.');
    if (pnl?.rolledUpFrom) flags.push(`Read from the imported P&L's twelve months ${pnl.rolledUpFrom[0]} to ${pnl.rolledUpFrom.at(-1)}.`);
    if (pnl && reportedEbitda) flags.push(`Imported EBITDA: ${PNL_EBITDA_BASIS}`);
    const unverified = addBacks.filter((row) => row.status === 'UNVERIFIED');
    if (unverified.length) flags.push(`${unverified.length} unverified add-back${unverified.length === 1 ? '' : 's'}: ${unverified.filter((row) => row.counts).length} included by reviewer decision, ${unverified.filter((row) => !row.counts).length} excluded.`);
    const base = reportedEbitda ? new D(reportedEbitda.amount) : null;
    return {
      period,
      currency,
      pnl,
      reported,
      reportedEbitda,
      conflict,
      adjustments,
      addBacks,
      totals: { adjustments: money(adjustmentsTotal), addBacksCounted: money(counted), addBacksClaimed: money(claimed), addBacksExcluded: money(claimed.minus(counted)) },
      adjustedEbitda: base ? money(base.plus(adjustmentsTotal).plus(counted)) : null,
      sellerAdjustedEbitda: base ? money(base.plus(claimed)) : null,
      flags,
    };
  });
}

export interface WorkingCapitalPeriod {
  periodEnd: string;
  currentAssets: string;
  currentLiabilities: string;
  netWorkingCapital: string;
  lines: WorkingCapitalInput[];
}

export interface WorkingCapitalAnalysis {
  currency: string;
  periods: WorkingCapitalPeriod[];
  average: string | null;
  low: { periodEnd: string; amount: string } | null;
  high: { periodEnd: string; amount: string } | null;
  /** Components ordered by how far they swing across the periods: the drivers of movement. */
  drivers: { component: QoeWorkingCapitalComponent; label: string; side: 'ASSET' | 'LIABILITY'; low: string; high: string; range: string; firstToLast: string }[];
  peg: { amount: string; derivation: string; periods: string[] } | null;
  pegUnavailable: string | null;
}

/**
 * Normalized net working capital per balance-sheet date (current assets less current
 * liabilities; cash and debt are never components), its average and seasonal range, the
 * components driving movement, and a proposed peg: the average of the latest
 * PEG_TRAILING_PERIODS dates, with the derivation spelled out.
 */
export function workingCapitalAnalysis(lines: WorkingCapitalInput[]): WorkingCapitalAnalysis {
  const currency = lines[0]?.currency ?? '';
  const dates = [...new Set(lines.map((line) => line.periodEnd))].sort();
  const periods = dates.map((periodEnd) => {
    const own = lines.filter((line) => line.periodEnd === periodEnd);
    const side = (which: 'ASSET' | 'LIABILITY') => own.filter((line) => QOE_COMPONENT_REGISTRY[line.component].side === which).reduce((total, line) => total.plus(line.amount), new D(0));
    const assets = side('ASSET');
    const liabilities = side('LIABILITY');
    return { periodEnd, currentAssets: money(assets), currentLiabilities: money(liabilities), netWorkingCapital: money(assets.minus(liabilities)), lines: own };
  });
  const nwc = periods.map((period) => ({ periodEnd: period.periodEnd, value: new D(period.netWorkingCapital) }));
  const average = nwc.length ? money(nwc.reduce((total, entry) => total.plus(entry.value), new D(0)).dividedBy(nwc.length)) : null;
  const byValue = [...nwc].sort((x, y) => x.value.cmp(y.value) || x.periodEnd.localeCompare(y.periodEnd));
  const lowest = byValue[0];
  const highest = byValue.at(-1);
  const low = lowest ? { periodEnd: lowest.periodEnd, amount: money(lowest.value) } : null;
  const high = highest ? { periodEnd: highest.periodEnd, amount: money(highest.value) } : null;

  const components = [...new Set(lines.map((line) => line.component))];
  const drivers = components
    .map((component) => {
      // A component missing at a date counts as zero there, so its swing is visible.
      const values = dates.map((periodEnd) => lines.filter((line) => line.periodEnd === periodEnd && line.component === component).reduce((total, line) => total.plus(line.amount), new D(0)));
      const sorted = [...values].sort((x, y) => x.cmp(y));
      const first = values[0] ?? new D(0);
      const last = values.at(-1) ?? new D(0);
      const lowValue = sorted[0] ?? new D(0);
      const highValue = sorted.at(-1) ?? new D(0);
      return { component, label: QOE_COMPONENT_REGISTRY[component].label, side: QOE_COMPONENT_REGISTRY[component].side, low: money(lowValue), high: money(highValue), range: money(highValue.minus(lowValue)), firstToLast: money(last.minus(first)) };
    })
    .sort((x, y) => new D(y.range).cmp(x.range) || x.component.localeCompare(y.component));

  const trailing = nwc.slice(-PEG_TRAILING_PERIODS);
  let peg: WorkingCapitalAnalysis['peg'] = null;
  let pegUnavailable: string | null = null;
  if (trailing.length < PEG_MINIMUM_PERIODS) {
    pegUnavailable = `A peg needs at least ${PEG_MINIMUM_PERIODS} balance-sheet dates; ${trailing.length} recorded.`;
  } else {
    const total = trailing.reduce((sum, entry) => sum.plus(entry.value), new D(0));
    const amount = money(total.dividedBy(trailing.length));
    const first = trailing[0]?.periodEnd ?? '';
    const last = trailing.at(-1)?.periodEnd ?? '';
    peg = {
      amount,
      periods: trailing.map((entry) => entry.periodEnd),
      derivation: `Average net working capital over ${trailing.length} balance-sheet dates, ${first} to ${last}: ${currency} ${money(total)} ÷ ${trailing.length} = ${currency} ${amount}. Net working capital = current assets less current liabilities, excluding cash and debt.`,
    };
  }
  return { currency, periods, average, low, high, drivers, peg, pegUnavailable };
}
