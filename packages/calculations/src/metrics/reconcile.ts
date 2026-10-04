import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { D, money, parseDecimal, RATIO_SCALE } from './decimal';
import type { AppliedRate } from './fx';
import { isActiveIn } from './ledger';
import type { MetricsWorkspace, SaasMetricsReport } from './metrics';
import { monthEnd } from './months';
import type { ExclusionReason, MoneyValue, SourceRef } from './types';

/** Differences within ±1% of the reported figure reconcile without review. */
export const DEFAULT_RECONCILIATION_TOLERANCE = '0.01';

/** Most citations a draft finding carries; the full input list stays on the reconciliation. */
export const MAX_FINDING_CITATIONS = 50;

/** A management-reported figure, e.g. one row of a KPI pack. */
export interface ReportedFigure {
  readonly ref: SourceRef;
  readonly period: string | null;
  readonly value: string | null;
  readonly currency: string | null;
}

export type ReconciliationStatus =
  | 'RECONCILED'
  | 'DIFFERENCE'
  | 'NO_REPORTED_FIGURE'
  | 'REPORTED_VALUE_MISSING'
  | 'REPORTED_VALUE_UNCONVERTIBLE';

/** Excluded billing activity in the as-of month, grouped by reason, that may explain a gap. */
export interface GapExplanation {
  readonly reason: ExclusionReason;
  readonly lines: number;
  /** Recurring lines are annualized (MRR × 12); one-time charges are shown as billed. */
  readonly basis: 'ANNUALIZED_MRR' | 'BILLED_AMOUNT';
  readonly amount: MoneyValue;
  /** Lines whose currency could not be converted; not included in `amount`. */
  readonly unconvertedLines: number;
  readonly refs: readonly SourceRef[];
}

export interface ArrReconciliation {
  /** Content hash of every input; any changed input yields a new id. */
  readonly reconciliationId: string;
  readonly engineVersion: string;
  readonly asOfMonth: string;
  readonly baseCurrency: string;
  readonly status: ReconciliationStatus;
  readonly tolerance: string;
  readonly reported: {
    readonly ref: SourceRef;
    readonly period: string | null;
    readonly original: MoneyValue | null;
    readonly value: MoneyValue | null;
    readonly fx: AppliedRate | null;
  } | null;
  readonly calculated: MoneyValue;
  /** calculated − reported, in the base currency. Negative means management reports more. */
  readonly delta: MoneyValue | null;
  readonly deltaRatio: string | null;
  readonly explanation: readonly GapExplanation[];
  readonly inputs: readonly SourceRef[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

function explain(ws: MetricsWorkspace): GapExplanation[] {
  const { asOfMonth, baseCurrency } = ws.input;
  const onDate = monthEnd(asOfMonth);
  const groups = new Map<
    ExclusionReason,
    { lines: number; amount: Decimal; unconverted: number; refs: SourceRef[] }
  >();
  const add = (reason: ExclusionReason, ref: SourceRef, amount: Decimal | null) => {
    const group = groups.get(reason) ?? { lines: 0, amount: new D(0), unconverted: 0, refs: [] };
    group.lines += 1;
    group.refs.push(ref);
    if (amount) group.amount = group.amount.plus(amount);
    else group.unconverted += 1;
    groups.set(reason, group);
  };
  for (const excluded of ws.ledger.exclusions) {
    if (!isActiveIn(excluded, asOfMonth) || !excluded.monthly || !excluded.currency) continue;
    const lookup = ws.fx.rate(excluded.currency, baseCurrency, onDate);
    const factor = excluded.reason === 'NON_RECURRING' ? 1 : 12;
    add(
      excluded.reason,
      excluded.ref,
      lookup.ok ? excluded.monthly.times(factor).times(lookup.rate.rate) : null,
    );
  }
  for (const failed of ws.snapshots.get(asOfMonth)?.exclusions ?? [])
    add(failed.reason, failed.ref, null);
  return [...groups.entries()]
    .map(([reason, group]) => ({
      reason,
      lines: group.lines,
      basis: reason === 'NON_RECURRING' ? ('BILLED_AMOUNT' as const) : ('ANNUALIZED_MRR' as const),
      amount: money(group.amount, baseCurrency),
      unconvertedLines: group.unconverted,
      refs: group.refs.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    }))
    .sort(
      (a, b) =>
        new D(b.amount.amount).comparedTo(a.amount.amount) || a.reason.localeCompare(b.reason),
    );
}

/**
 * Reconcile a management-reported ARR figure against ledger ARR at the
 * as-of month. Deterministic; the id changes whenever any input does, so an
 * approval recorded against one id is visibly stale after evidence changes.
 */
export function reconcileArr(
  ws: MetricsWorkspace,
  report: SaasMetricsReport,
  reported: ReportedFigure | null,
  tolerance: string = DEFAULT_RECONCILIATION_TOLERANCE,
): ArrReconciliation {
  const base = ws.input.baseCurrency;
  const arrMetric = report.metrics.find((metric) => metric.key === 'ARR');
  const calculated = new D(arrMetric?.value ?? '0');
  const inputs = arrMetric?.inputs ?? [];
  const toleranceValue = parseDecimal(tolerance);
  if (!toleranceValue || toleranceValue.isNegative())
    throw new Error('Tolerance must be a non-negative decimal string');

  let status: ReconciliationStatus;
  let reportedView: ArrReconciliation['reported'] = null;
  let delta: Decimal | null = null;
  let deltaRatio: string | null = null;
  if (!reported) status = 'NO_REPORTED_FIGURE';
  else {
    const value = parseDecimal(reported.value);
    const currency =
      reported.currency && /^[A-Z]{3}$/.test(reported.currency) ? reported.currency : null;
    const lookup = currency ? ws.fx.rate(currency, base, monthEnd(ws.input.asOfMonth)) : null;
    const converted = value && lookup?.ok ? value.times(lookup.rate.rate) : null;
    reportedView = {
      ref: reported.ref,
      period: reported.period,
      original: value && currency ? money(value, currency) : null,
      value: converted ? money(converted, base) : null,
      fx: lookup?.ok && currency !== base ? lookup.rate : null,
    };
    if (!value || !currency) status = 'REPORTED_VALUE_MISSING';
    else if (!converted) status = 'REPORTED_VALUE_UNCONVERTIBLE';
    else {
      const reportedRounded = new D(money(converted, base).amount);
      delta = calculated.minus(reportedRounded);
      deltaRatio = reportedRounded.isZero()
        ? null
        : delta.dividedBy(reportedRounded).toFixed(RATIO_SCALE, Decimal.ROUND_HALF_EVEN);
      const withinTolerance = delta
        .abs()
        .lessThanOrEqualTo(reportedRounded.abs().times(toleranceValue));
      status = withinTolerance ? 'RECONCILED' : 'DIFFERENCE';
    }
  }

  const explanation = explain(ws);
  const reconciliationId = createHash('sha256')
    .update(
      stableJson({
        engine: report.engineVersion,
        asOf: ws.input.asOfMonth,
        base,
        tolerance: toleranceValue.toFixed(),
        reported: reported
          ? {
              evidenceId: reported.ref.evidenceId,
              value: reported.value,
              currency: reported.currency,
            }
          : null,
        calculated: calculated.toFixed(),
        inputs: inputs.map((ref) => ref.evidenceId).sort(),
        excluded: explanation.flatMap((group) => group.refs.map((ref) => ref.evidenceId)).sort(),
      }),
      'utf8',
    )
    .digest('hex');

  return {
    reconciliationId,
    engineVersion: report.engineVersion,
    asOfMonth: ws.input.asOfMonth,
    baseCurrency: base,
    status,
    tolerance: toleranceValue.toFixed(),
    reported: reportedView,
    calculated: money(calculated, base),
    delta: delta ? money(delta, base) : null,
    deltaRatio,
    explanation,
    inputs,
  };
}

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** A draft finding proposed by deterministic code. It is never accepted without a human reviewer. */
export interface DraftFinding {
  readonly status: 'DRAFT';
  readonly kind: 'ARR_RECONCILIATION_DIFFERENCE';
  readonly domain: 'FINANCIAL';
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly summary: string;
  readonly reconciliationId: string;
  readonly asOfMonth: string;
  readonly generatedBy: string;
  readonly requiresHumanReview: true;
  readonly evidence: readonly {
    evidenceId: string;
    citationId: string;
    sourceRecordId: string;
    claim: string;
  }[];
  /** Cited records left off the finding to keep it reviewable; all remain on the reconciliation. */
  readonly omittedCitations: number;
}

const REASON_LABELS: Partial<Record<ExclusionReason, string>> = {
  INVOICE_VOID: 'void invoices',
  INVOICE_UNCOLLECTIBLE: 'uncollectible invoices',
  INVOICE_DRAFT: 'draft invoices',
  NON_RECURRING: 'one-time charges',
  DUPLICATE_LINE: 'duplicate lines',
  NO_FX_RATE: 'lines without an FX rate',
  STALE_FX_RATE: 'lines with a stale FX rate',
};

export function severityFor(deltaRatio: string): FindingSeverity {
  const size = new D(deltaRatio).abs();
  if (size.greaterThanOrEqualTo('0.5')) return 'CRITICAL';
  if (size.greaterThanOrEqualTo('0.2')) return 'HIGH';
  if (size.greaterThanOrEqualTo('0.05')) return 'MEDIUM';
  return 'LOW';
}

function percent(ratioValue: string): string {
  return `${new D(ratioValue).times(100).toFixed(2)}%`;
}

/**
 * Turn an out-of-tolerance reconciliation into a draft finding with exact
 * citations. Returns null when there is no difference or nothing citable.
 */
export function draftFindingFor(reconciliation: ArrReconciliation): DraftFinding | null {
  const { reported, delta, deltaRatio } = reconciliation;
  if (reconciliation.status !== 'DIFFERENCE' || !reported?.value || !delta || !deltaRatio)
    return null;
  if (!reported.ref.citationId) return null;
  const currency = reconciliation.baseCurrency;

  const evidence: DraftFinding['evidence'][number][] = [];
  const seen = new Set<string>();
  const cite = (ref: SourceRef, claim: string) => {
    if (!ref.citationId || seen.has(ref.evidenceId)) return;
    seen.add(ref.evidenceId);
    evidence.push({
      evidenceId: ref.evidenceId,
      citationId: ref.citationId,
      sourceRecordId: ref.sourceRecordId,
      claim,
    });
  };
  cite(
    reported.ref,
    `Management reported ARR of ${reported.original?.amount ?? reported.value.amount} ${reported.original?.currency ?? currency}${reported.period ? ` for ${reported.period}` : ''}`,
  );
  for (const group of reconciliation.explanation)
    for (const ref of group.refs)
      cite(
        ref,
        `Billing line excluded from ARR in ${reconciliation.asOfMonth}: ${REASON_LABELS[group.reason] ?? group.reason}`,
      );
  for (const ref of reconciliation.inputs)
    cite(ref, `Billing record included in calculated ARR for ${reconciliation.asOfMonth}`);

  const kept = evidence.slice(0, MAX_FINDING_CITATIONS);
  const explained = reconciliation.explanation
    .filter((group) => !new D(group.amount.amount).isZero())
    .map(
      (group) =>
        `${REASON_LABELS[group.reason] ?? group.reason} ${group.amount.amount} ${currency} (${group.basis === 'ANNUALIZED_MRR' ? 'annualized' : 'as billed'})`,
    );
  const direction = delta.amount.startsWith('-') ? 'exceeds' : 'is below';
  return {
    status: 'DRAFT',
    kind: 'ARR_RECONCILIATION_DIFFERENCE',
    domain: 'FINANCIAL',
    severity: severityFor(deltaRatio),
    title: `Reported ARR ${direction} billing-supported ARR by ${percent(new D(deltaRatio).abs().toFixed(RATIO_SCALE))}`,
    summary:
      `Management reported ARR of ${reported.value.amount} ${currency}${reported.period ? ` for ${reported.period}` : ''}; ` +
      `billing transactions support ${reconciliation.calculated.amount} ${currency} at the end of ${reconciliation.asOfMonth}, ` +
      `a difference of ${delta.amount} ${currency} (${percent(deltaRatio)}) against a tolerance of ${percent(reconciliation.tolerance)}.` +
      (explained.length > 0
        ? ` Excluded billing activity in the month: ${explained.join('; ')}.`
        : ''),
    reconciliationId: reconciliation.reconciliationId,
    asOfMonth: reconciliation.asOfMonth,
    generatedBy: reconciliation.engineVersion,
    requiresHumanReview: true,
    evidence: kept,
    omittedCitations: evidence.length - kept.length,
  };
}
