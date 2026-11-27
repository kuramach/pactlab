import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runValuation, type LinkedAdjustment, type ValuationInputs, type ValuationResult } from '.';
import { currencyScale } from '../money';

/**
 * T-170 contract: a bridge in JPY, INR and EUR, each recomputed exactly. Every amount carries its
 * currency's minor unit (JPY none) and the bridge foots line by line, as shown.
 */

const FINDING_A = '0190f000-0000-7000-8000-00000000000a';
const FINDING_B = '0190f000-0000-7000-8000-00000000000b';

const adjustment = (currency: string, findingId: string, type: LinkedAdjustment['type'], low: string, high: string): LinkedAdjustment => ({
  findingId,
  findingVersion: 1,
  type,
  currency,
  low,
  high,
  point: 'MID',
  basis: 'Synthetic',
});

function inputs(currency: string, overrides: Partial<ValuationInputs>): ValuationInputs {
  return {
    currency,
    transactionType: 'PRIVATE_ACQUIRER',
    assumptions: { method: 'ARR_MULTIPLE', arr: '0', multiple: '1' },
    bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
    stockConsiderationShare: '0',
    adjustments: [],
    lbo: null,
    accretionDilution: null,
    sensitivity: null,
    ...overrides,
  };
}

const amount = (line: { amount: { amount: string } }) => new Decimal(line.amount.amount);

/** Recompute the bridge from its own lines and check every total, and every scale. */
function expectFoots(result: ValuationResult): void {
  const scale = currencyScale(result.currency);
  const all = [
    ...result.bridge.lines.map((line) => line.amount),
    result.enterpriseValue,
    result.bridge.equityValue,
    result.bridge.equityPurchasePrice,
    result.bridge.holdbacks,
    result.bridge.cashAtClose,
  ];
  for (const money of all) {
    expect(money.currency).toBe(result.currency);
    expect(/\.(\d+)$/.exec(money.amount)?.[1]?.length ?? 0).toBe(scale);
  }
  const lines = result.bridge.lines;
  const until = (kind: string) => lines.slice(0, lines.findIndex((line) => line.kind === kind));
  const total = (subset: typeof lines) => subset.reduce((sum, line) => sum.plus(amount(line)), new Decimal(0));
  const equity = lines.find((line) => line.kind === 'EQUITY_VALUE')!;
  const price = lines.find((line) => line.kind === 'EQUITY_PURCHASE_PRICE')!;
  const close = lines.find((line) => line.kind === 'CASH_AT_CLOSE')!;
  expect(total(until('EQUITY_VALUE')).equals(amount(equity))).toBe(true);
  expect(amount(equity).plus(total(lines.filter((line) => line.kind === 'FINDING_ADJUSTMENT'))).equals(amount(price))).toBe(true);
  expect(amount(price).plus(total(lines.filter((line) => line.kind === 'HOLDBACK'))).equals(amount(close))).toBe(true);
  expect(amount(price).toFixed(scale)).toBe(result.bridge.equityPurchasePrice.amount);
  expect(amount(close).toFixed(scale)).toBe(result.bridge.cashAtClose.amount);
}

describe('valuation bridges in the launch currencies', () => {
  it('JPY: whole yen everywhere, footing exactly where independent rounding would not', () => {
    // EV = ¥123,456,789 × 6.55 = ¥808,641,967.95; the midpoint of ¥1,000,001–2,000,000 is ¥1,500,000.5.
    const result = runValuation(
      inputs('JPY', {
        assumptions: { method: 'ARR_MULTIPLE', arr: '123456789', multiple: '6.55' },
        bridge: { cash: '250000000', debt: '400000000', debtLikeItems: '12500000', workingCapitalAdjustment: '-3000000' },
        adjustments: [
          adjustment('JPY', FINDING_A, 'PRICE_REDUCTION', '1000001', '2000000'),
          adjustment('JPY', FINDING_B, 'ESCROW', '30000000', '50000001'),
        ],
      }),
    );
    expect(result.enterpriseValue).toEqual({ amount: '808641968', currency: 'JPY' });
    expect(result.bridge.equityValue.amount).toBe('643141968');
    expect(result.bridge.lines.find((line) => line.findingId === FINDING_A)?.amount.amount).toBe('-1500000');
    expect(result.bridge.equityPurchasePrice.amount).toBe('641641968');
    expect(result.bridge.holdbacks.amount).toBe('40000000');
    expect(result.bridge.cashAtClose.amount).toBe('601641968');
    expectFoots(result);
  });

  it('INR: paise, through a DCF', () => {
    const result = runValuation(
      inputs('INR', {
        assumptions: {
          method: 'DCF',
          baseRevenue: '875000000.00',
          years: [
            { growth: '0.18', fcfMargin: '0.21' },
            { growth: '0.16', fcfMargin: '0.22' },
            { growth: '0.14', fcfMargin: '0.23' },
          ],
          discountRate: '0.135',
          terminal: { kind: 'GORDON', growth: '0.05' },
        },
        bridge: { cash: '120000000.55', debt: '310000000.10', debtLikeItems: '0', workingCapitalAdjustment: '15000000' },
        adjustments: [adjustment('INR', FINDING_A, 'REMEDIATION_COST', '2500000.25', '7500000.50')],
      }),
    );
    expect(result.currency).toBe('INR');
    expectFoots(result);
  });

  it('EUR: cents, with an ARR multiple and both kinds of adjustment', () => {
    const result = runValuation(
      inputs('EUR', {
        assumptions: { method: 'ARR_MULTIPLE', arr: '18333333.33', multiple: '5.25' },
        bridge: { cash: '4100000', debt: '9000000', debtLikeItems: '750000.005', workingCapitalAdjustment: '0' },
        adjustments: [
          adjustment('EUR', FINDING_A, 'PRICE_REDUCTION', '1000000.01', '2000000'),
          adjustment('EUR', FINDING_B, 'INDEMNITY', '333333.33', '666666.67'),
        ],
      }),
    );
    // 18,333,333.33 × 5.25 = 96,249,999.9825 → EUR 96,249,999.98.
    expect(result.enterpriseValue).toEqual({ amount: '96249999.98', currency: 'EUR' });
    expect(result.bridge.lines.find((line) => line.kind === 'DEBT_LIKE_ITEMS')?.amount.amount).toBe('-750000.00');
    expect(result.bridge.equityPurchasePrice.amount).toBe('89099999.98');
    expect(result.bridge.cashAtClose.amount).toBe('88599999.98');
    expectFoots(result);
  });

  it('never converts: an adjustment in another currency is refused', () => {
    expect(() =>
      runValuation(
        inputs('JPY', {
          assumptions: { method: 'ARR_MULTIPLE', arr: '100000000', multiple: '5' },
          adjustments: [adjustment('USD', FINDING_A, 'PRICE_REDUCTION', '1000', '2000')],
        }),
      ),
    ).toThrow(/convert explicitly/);
  });
});
