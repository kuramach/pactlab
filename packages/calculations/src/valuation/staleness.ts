import type { LinkedAdjustment, LinkedBalanceSheetItem } from './types';

/** Current state of a linked finding, as read when a result is shown or submitted. */
export interface LinkedFindingState {
  readonly findingId: string;
  readonly version: number;
  readonly status: string;
  readonly pricedRisk: {
    readonly type: string;
    readonly currency: string;
    readonly low: string;
    readonly high: string;
  } | null;
}

export type StaleReason =
  | { readonly kind: 'ASSUMPTIONS_CHANGED' }
  | { readonly kind: 'FINDING_MISSING'; readonly findingId: string }
  | { readonly kind: 'FINDING_NOT_ACCEPTED'; readonly findingId: string }
  | { readonly kind: 'PRICED_RISK_REMOVED'; readonly findingId: string }
  | { readonly kind: 'FINDING_CHANGED'; readonly findingId: string }
  | { readonly kind: 'BALANCE_SHEET_ITEM_MISSING'; readonly itemId: string }
  | { readonly kind: 'BALANCE_SHEET_ITEM_CHANGED'; readonly itemId: string };

/** Current state of a linked balance-sheet item; withdrawn items no longer count. */
export interface LinkedItemState {
  readonly itemId: string;
  readonly version: number;
  readonly status: 'ACTIVE' | 'WITHDRAWN';
}

export interface StalenessInput {
  /** Assumption-set version the result was computed from. */
  readonly resultAssumptionVersion: number;
  readonly currentAssumptionVersion: number;
  /** Adjustments recorded in the result's input set. */
  readonly adjustments: readonly LinkedAdjustment[];
  /** Current state per linked finding id; `null` when it no longer resolves. */
  readonly current: ReadonlyMap<string, LinkedFindingState | null>;
  /** Balance-sheet items recorded in the result's input set. */
  readonly balanceSheetItems?: readonly LinkedBalanceSheetItem[];
  /** Current state per linked item id; `null` when it no longer resolves. */
  readonly currentItems?: ReadonlyMap<string, LinkedItemState | null>;
}

/**
 * Why a stored result no longer reflects its dependencies. Empty means
 * fresh. A result goes stale when its assumptions move on, or when any
 * linked accepted risk is changed, reopened, rejected or loses its price,
 * or when a linked balance-sheet item is revised or withdrawn.
 */
export function staleReasons(input: StalenessInput): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (input.resultAssumptionVersion !== input.currentAssumptionVersion) {
    reasons.push({ kind: 'ASSUMPTIONS_CHANGED' });
  }
  for (const adjustment of input.adjustments) {
    const findingId = adjustment.findingId;
    const state = input.current.get(findingId) ?? null;
    if (!state) reasons.push({ kind: 'FINDING_MISSING', findingId });
    else if (state.status !== 'ACCEPTED') reasons.push({ kind: 'FINDING_NOT_ACCEPTED', findingId });
    else if (!state.pricedRisk) reasons.push({ kind: 'PRICED_RISK_REMOVED', findingId });
    else if (
      state.version !== adjustment.findingVersion ||
      state.pricedRisk.type !== adjustment.type ||
      state.pricedRisk.currency !== adjustment.currency ||
      state.pricedRisk.low !== adjustment.low ||
      state.pricedRisk.high !== adjustment.high
    ) {
      reasons.push({ kind: 'FINDING_CHANGED', findingId });
    }
  }
  for (const item of input.balanceSheetItems ?? []) {
    const state = input.currentItems?.get(item.itemId) ?? null;
    if (!state || state.status !== 'ACTIVE') reasons.push({ kind: 'BALANCE_SHEET_ITEM_MISSING', itemId: item.itemId });
    else if (state.version !== item.itemVersion) reasons.push({ kind: 'BALANCE_SHEET_ITEM_CHANGED', itemId: item.itemId });
  }
  return reasons;
}
