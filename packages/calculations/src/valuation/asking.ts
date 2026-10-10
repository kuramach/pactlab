import { D, ratio } from '../metrics/decimal';
import type { MoneyValue } from '../metrics/types';
import { Money } from '../money';
import type { ValuationResult } from './types';

export const ASKING_COMPARISON_VERSION = 'asking-1';

export const ASKING_BASES = ['ENTERPRISE_VALUE', 'EQUITY_VALUE'] as const;
export type AskingBasis = (typeof ASKING_BASES)[number];

export interface AskingPriceInput {
  readonly amount: string;
  readonly currency: string;
  readonly basis: AskingBasis;
}

export type AskingVerdict = 'BELOW' | 'AT' | 'ABOVE';

export interface AskingSide {
  /** Sextant's value on the asking price's basis. */
  readonly value: MoneyValue;
  /** Value minus asking price: negative when Sextant values the target below the ask. */
  readonly gap: MoneyValue;
  /** Gap over asking price, four decimal places (`-0.1250` = 12.5% below). */
  readonly gapRatio: string;
  readonly verdict: AskingVerdict;
}

export type AskingComparison =
  | {
      readonly comparable: true;
      readonly version: typeof ASKING_COMPARISON_VERSION;
      readonly basis: AskingBasis;
      readonly asking: MoneyValue;
      /** On the basis before accepted risks are priced in. */
      readonly beforeRisks: AskingSide;
      /** After the accepted findings linked to the scenario. */
      readonly afterRisks: AskingSide;
      /** Accepted-finding price reductions: they separate "before" from "after". */
      readonly riskAdjustments: readonly { readonly findingId: string; readonly label: string; readonly amount: MoneyValue }[];
      /** Escrows and other holdbacks: they keep the price but hold back cash at close. */
      readonly holdbacks: readonly { readonly findingId: string; readonly label: string; readonly amount: MoneyValue }[];
    }
  | { readonly comparable: false; readonly reason: 'CURRENCY' };

const entry = (line: ValuationResult['bridge']['lines'][number]) => ({
  findingId: line.findingId as string,
  label: line.label,
  amount: line.amount,
});

function side(value: Money, asking: Money): AskingSide {
  const gap = value.subtract(asking);
  const order = gap.compare(Money.zero(gap.currency));
  return {
    value: value.toJSON(),
    gap: gap.toJSON(),
    gapRatio: ratio(new D(gap.toDecimalString()), new D(asking.toDecimalString())) ?? '0.0000',
    verdict: order < 0 ? 'BELOW' : order > 0 ? 'ABOVE' : 'AT',
  };
}

/**
 * Test the seller's asking price against a valuation result, on the basis
 * the price was quoted: enterprise value, or equity value. "After risks"
 * applies the accepted-finding adjustments from the purchase-price bridge.
 * Deterministic and decimal-only; different currencies are not compared.
 */
export function compareToAsking(result: ValuationResult, input: AskingPriceInput): AskingComparison {
  if (input.currency !== result.currency) return { comparable: false, reason: 'CURRENCY' };
  const asking = Money.of(input.amount, input.currency);
  const findingLines = result.bridge.lines.filter((line) => line.kind === 'FINDING_ADJUSTMENT' && line.findingId !== null);
  const risk = findingLines.reduce((sum, line) => sum.add(Money.of(line.amount.amount, line.amount.currency)), Money.zero(result.currency));

  const [before, after] =
    input.basis === 'ENTERPRISE_VALUE'
      ? [Money.of(result.enterpriseValue.amount, result.currency), Money.of(result.enterpriseValue.amount, result.currency).add(risk)]
      : [Money.of(result.bridge.equityValue.amount, result.currency), Money.of(result.bridge.equityPurchasePrice.amount, result.currency)];

  return {
    comparable: true,
    version: ASKING_COMPARISON_VERSION,
    basis: input.basis,
    asking: asking.toJSON(),
    beforeRisks: side(before, asking),
    afterRisks: side(after, asking),
    riskAdjustments: findingLines.map(entry),
    holdbacks: result.bridge.lines.filter((line) => line.kind === 'HOLDBACK' && line.findingId !== null).map(entry),
  };
}
