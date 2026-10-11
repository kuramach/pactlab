import { D, money, parseDecimal, ratio } from '../metrics/decimal';
import type { MoneyValue } from '../metrics/types';
import type { AskingBasis, AskingVerdict } from './asking';
import { evToArrMultiple, type ComparableInput } from './benchmark';
import type { BridgeAssumptions } from './types';

/** Bumped whenever a counter-price rule, flag threshold or rounding rule changes. */
export const ANCHORS_VERSION = 'anchors-1';

/** An anchor this far from the target on ARR growth is easy for a seller to dismiss. */
export const GROWTH_GAP_LIMIT = '0.15';
/** …and this far on net revenue retention. */
export const RETENTION_GAP_LIMIT = '0.10';
/** Older deals reflect a different market. */
export const ANCHOR_MAX_AGE_YEARS = 3;

export type AnchorFlag =
  | 'GROWTH_GAP'
  | 'RETENTION_GAP'
  | 'DIFFERENT_COMPANY_TYPE'
  | 'OLDER_THAN_3_YEARS'
  | 'REVENUE_NOT_ARR'
  | 'NO_PUBLIC_SOURCE'
  | 'SYNTHETIC'
  | 'SUPPORTS_ASK'
  | 'CURRENCY';

export interface AnchorInput extends ComparableInput {
  readonly companyType: string;
  readonly announcedOn: string | null;
  readonly currency: string;
  readonly arrBasis: 'ARR' | 'REVENUE';
  readonly sourceUrl: string | null;
}

export interface AnchorTarget {
  readonly arr: MoneyValue;
  readonly companyType: string | null;
  readonly arrGrowth: string | null;
  readonly nrr: string | null;
}

export interface AnchorCounter {
  readonly version: typeof ANCHORS_VERSION;
  /** EV ÷ ARR of the anchor, two decimal places. */
  readonly multiple: string;
  /** Target ARR × the anchor's multiple. */
  readonly impliedEnterpriseValue: MoneyValue;
  /** The counter-price on the asking price's basis (equity asks use the scenario bridge). */
  readonly counterPrice: MoneyValue;
  /** Counter-price minus the ask: negative when the anchor argues for a lower price. */
  readonly gap: MoneyValue;
  /** Gap over the ask, four decimal places. */
  readonly gapRatio: string;
  readonly verdict: AskingVerdict;
  /** Reasons a seller could dismiss this anchor, or why it does not help the buyer. */
  readonly flags: readonly AnchorFlag[];
}

const yearsBefore = (today: string, years: number) => `${Number(today.slice(0, 4)) - years}${today.slice(4, 10)}`;

/**
 * What the target would be worth at a comparable's multiple, against the
 * seller's ask, with the reasons a seller could push back on the comparison.
 * Deterministic and decimal-only; null when the currencies differ or the
 * price cannot be formed.
 */
export function anchorCounterPrice(input: {
  readonly anchor: AnchorInput;
  readonly target: AnchorTarget;
  readonly asking: { readonly amount: string; readonly currency: string; readonly basis: AskingBasis };
  readonly bridge: BridgeAssumptions | null;
  /** `YYYY-MM-DD`. */
  readonly today: string;
}): AnchorCounter | { readonly version: typeof ANCHORS_VERSION; readonly unavailable: 'CURRENCY' | 'NO_BRIDGE' | 'INVALID' } {
  const { anchor, target, asking } = input;
  const multiple = evToArrMultiple({ amount: anchor.enterpriseValue, currency: anchor.currency }, { amount: anchor.arr, currency: anchor.currency });
  const arr = parseDecimal(target.arr.amount);
  const ask = parseDecimal(asking.amount);
  if (!multiple || !arr || !ask || !ask.greaterThan(0)) return { version: ANCHORS_VERSION, unavailable: 'INVALID' };
  if (target.arr.currency !== asking.currency) return { version: ANCHORS_VERSION, unavailable: 'CURRENCY' };
  if (asking.basis === 'EQUITY_VALUE' && !input.bridge) return { version: ANCHORS_VERSION, unavailable: 'NO_BRIDGE' };

  // The anchor's own multiple at full precision; the displayed one is rounded.
  const exact = new D(anchor.enterpriseValue).dividedBy(anchor.arr);
  const ev = arr.times(exact);
  let counter = ev;
  if (asking.basis === 'EQUITY_VALUE' && input.bridge) {
    const part = (value: string) => parseDecimal(value) ?? new D(0);
    counter = ev
      .minus(part(input.bridge.debt))
      .minus(part(input.bridge.debtLikeItems))
      .plus(part(input.bridge.cash))
      .plus(part(input.bridge.workingCapitalAdjustment));
  }
  const gap = counter.minus(ask);
  const flags: AnchorFlag[] = [];
  const growth = parseDecimal(anchor.arrGrowth);
  const targetGrowth = parseDecimal(target.arrGrowth);
  if (growth && targetGrowth && growth.minus(targetGrowth).abs().greaterThan(GROWTH_GAP_LIMIT)) flags.push('GROWTH_GAP');
  const nrr = parseDecimal(anchor.nrr);
  const targetNrr = parseDecimal(target.nrr);
  if (nrr && targetNrr && nrr.minus(targetNrr).abs().greaterThan(RETENTION_GAP_LIMIT)) flags.push('RETENTION_GAP');
  if (target.companyType && anchor.companyType !== target.companyType) flags.push('DIFFERENT_COMPANY_TYPE');
  if (anchor.announcedOn && anchor.announcedOn < yearsBefore(input.today, ANCHOR_MAX_AGE_YEARS)) flags.push('OLDER_THAN_3_YEARS');
  if (anchor.arrBasis === 'REVENUE') flags.push('REVENUE_NOT_ARR');
  if (!anchor.sourceUrl) flags.push('NO_PUBLIC_SOURCE');
  if (anchor.origin === 'SYNTHETIC') flags.push('SYNTHETIC');
  if (anchor.currency !== target.arr.currency) flags.push('CURRENCY');
  if (gap.greaterThanOrEqualTo(0)) flags.push('SUPPORTS_ASK');

  const order = gap.comparedTo(0);
  return {
    version: ANCHORS_VERSION,
    multiple,
    impliedEnterpriseValue: money(ev, target.arr.currency),
    counterPrice: money(counter, asking.currency),
    gap: money(gap, asking.currency),
    gapRatio: ratio(gap, ask) ?? '0.0000',
    verdict: order < 0 ? 'BELOW' : order > 0 ? 'ABOVE' : 'AT',
    flags,
  };
}
