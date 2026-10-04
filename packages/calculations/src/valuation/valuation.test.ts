import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  freeze,
  runValuation,
  staleReasons,
  valuationInputHash,
  ValuationInputError,
  verifyFrozen,
  type LinkedAdjustment,
  type LinkedFindingState,
  type MethodAssumptions,
  type ValuationInputs,
} from '.';

const FINDING_A = '0190f000-0000-7000-8000-00000000000a';
const FINDING_B = '0190f000-0000-7000-8000-00000000000b';
const FINDING_C = '0190f000-0000-7000-8000-00000000000c';

const zeroBridge = { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' };

function arrInputs(overrides: Partial<ValuationInputs> = {}): ValuationInputs {
  return {
    currency: 'USD',
    transactionType: 'PRIVATE_ACQUIRER',
    assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6.5' },
    bridge: zeroBridge,
    stockConsiderationShare: '0',
    adjustments: [],
    lbo: null,
    accretionDilution: null,
    sensitivity: null,
    ...overrides,
  };
}

const adjustments: LinkedAdjustment[] = [
  {
    findingId: FINDING_B,
    findingVersion: 3,
    type: 'PRICE_REDUCTION',
    currency: 'USD',
    low: '1000000',
    high: '3000000',
    point: 'MID',
    basis: 'Overstated ARR',
  },
  {
    findingId: FINDING_A,
    findingVersion: 4,
    type: 'ESCROW',
    currency: 'USD',
    low: '500000',
    high: '500000',
    point: 'HIGH',
    basis: 'Licence exposure',
  },
  {
    findingId: FINDING_C,
    findingVersion: 3,
    type: 'REMEDIATION_COST',
    currency: 'USD',
    low: '40000',
    high: '120000.00',
    point: 'LOW',
    basis: 'Rewrite estimate',
  },
];

describe('ARR-multiple engine and purchase-price bridge', () => {
  it('values ARR × multiple and bridges to cash at close with finding-linked lines', () => {
    const result = runValuation(
      arrInputs({
        bridge: {
          cash: '2000000',
          debt: '5000000',
          debtLikeItems: '500000',
          workingCapitalAdjustment: '-250000',
        },
        adjustments,
      }),
    );
    expect(result.enterpriseValue).toEqual({ amount: '65000000.00', currency: 'USD' });
    expect(result.bridge.equityValue.amount).toBe('61250000.00');
    expect(result.bridge.equityPurchasePrice.amount).toBe('59210000.00');
    expect(result.bridge.holdbacks.amount).toBe('500000.00');
    expect(result.bridge.cashAtClose.amount).toBe('58710000.00');
    expect(
      result.bridge.lines.map((line) => [line.kind, line.amount.amount, line.findingId]),
    ).toEqual([
      ['ENTERPRISE_VALUE', '65000000.00', null],
      ['CASH', '2000000.00', null],
      ['DEBT', '-5000000.00', null],
      ['DEBT_LIKE_ITEMS', '-500000.00', null],
      ['WORKING_CAPITAL', '-250000.00', null],
      ['EQUITY_VALUE', '61250000.00', null],
      ['FINDING_ADJUSTMENT', '-2000000.00', FINDING_B],
      ['FINDING_ADJUSTMENT', '-40000.00', FINDING_C],
      ['EQUITY_PURCHASE_PRICE', '59210000.00', null],
      ['HOLDBACK', '-500000.00', FINDING_A],
      ['CASH_AT_CLOSE', '58710000.00', null],
    ]);
  });

  it('is deterministic: same inputs give the same hash and result', () => {
    const inputs = arrInputs({ adjustments });
    expect(runValuation(inputs)).toEqual(runValuation(structuredClone(inputs)));
    expect(valuationInputHash(inputs)).toMatch(/^[0-9a-f]{64}$/);
    expect(valuationInputHash(arrInputs({ adjustments: [adjustments[0]!] }))).not.toBe(
      valuationInputHash(inputs),
    );
  });

  it('builds a sensitivity grid of enterprise values', () => {
    const result = runValuation(
      arrInputs({
        sensitivity: {
          rows: { variable: 'arr', values: ['8000000', '10000000'] },
          columns: { variable: 'multiple', values: ['5', '6.5'] },
        },
      }),
    );
    expect(result.sensitivity?.cells.map((row) => row.map((cell) => cell?.amount))).toEqual([
      ['40000000.00', '52000000.00'],
      ['50000000.00', '65000000.00'],
    ]);
  });
});

describe('DCF engine', () => {
  const dcf = (assumptions: MethodAssumptions) => arrInputs({ assumptions });

  it('discounts projected free cash flow plus a Gordon terminal value', () => {
    const result = runValuation(
      dcf({
        method: 'DCF',
        baseRevenue: '100000000',
        years: [
          { growth: '0.1', fcfMargin: '0.2' },
          { growth: '0.1', fcfMargin: '0.2' },
        ],
        discountRate: '0.1',
        terminal: { kind: 'GORDON', growth: '0.02' },
      }),
    );
    expect(result.enterpriseValue.amount).toBe('295000000.00');
    if (result.method.method !== 'DCF') throw new Error('expected DCF');
    expect(result.method.years.map((y) => [y.revenue.amount, y.presentValue.amount])).toEqual([
      ['110000000.00', '20000000.00'],
      ['121000000.00', '20000000.00'],
    ]);
    expect(result.method.years[0]!.discountFactor).toBe('0.909090909091');
    expect(result.method.terminalValue.amount).toBe('308550000.00');
    expect(result.method.presentValueOfTerminal.amount).toBe('255000000.00');
  });

  it('supports an exit-multiple terminal value and blanks infinite sensitivity cells', () => {
    const result = runValuation(
      dcf({
        method: 'DCF',
        baseRevenue: '100000000',
        years: [
          { growth: '0.1', fcfMargin: '0.2' },
          { growth: '0.1', fcfMargin: '0.2' },
        ],
        discountRate: '0.1',
        terminal: { kind: 'EXIT_MULTIPLE', revenueMultiple: '5' },
      }),
    );
    expect(result.enterpriseValue.amount).toBe('540000000.00');

    const withGrid = runValuation({
      ...arrInputs(),
      assumptions: {
        method: 'DCF',
        baseRevenue: '100000000',
        years: [{ growth: '0.1', fcfMargin: '0.2' }],
        discountRate: '0.1',
        terminal: { kind: 'GORDON', growth: '0.02' },
      },
      sensitivity: {
        rows: { variable: 'discountRate', values: ['0.03', '0.1'] },
        columns: { variable: 'terminalGrowth', values: ['0.02', '0.05'] },
      },
    });
    expect(withGrid.sensitivity?.cells[0]).toEqual([
      expect.objectContaining({ currency: 'USD' }),
      null,
    ]);
  });
});

describe('transaction-type engines', () => {
  it('computes LBO returns for take-privates and requires LBO inputs', () => {
    expect(() => runValuation(arrInputs({ transactionType: 'TAKE_PRIVATE' }))).toThrow(
      ValuationInputError,
    );
    const result = runValuation(
      arrInputs({
        transactionType: 'TAKE_PRIVATE',
        lbo: {
          entryEbitda: '5000000',
          leverageMultiple: '5',
          exitEbitda: '10000000',
          exitMultiple: '12',
          holdYears: 5,
          debtRepaid: '5000000',
        },
      }),
    );
    expect(result.lbo).toMatchObject({
      entryDebt: { amount: '25000000.00' },
      entryEquity: { amount: '40000000.00' },
      exitEquity: { amount: '100000000.00' },
      moic: '2.5000',
      irr: '0.2011',
    });
  });

  it('computes accretion/dilution for stock consideration and requires its inputs', () => {
    expect(() => runValuation(arrInputs({ stockConsiderationShare: '0.5' }))).toThrow(
      /accretion\/dilution/,
    );
    const result = runValuation(
      arrInputs({
        transactionType: 'PUBLIC_ACQUIRER',
        stockConsiderationShare: '0.5',
        accretionDilution: {
          acquirerNetIncome: '50000000',
          acquirerShares: '100000000',
          acquirerSharePrice: '50',
          targetNetIncome: '2000000',
          pretaxSynergies: '1000000',
          taxRate: '0.25',
          cashInterestRate: '0.04',
        },
      }),
    );
    expect(result.accretionDilution).toEqual({
      stockConsideration: { amount: '32500000.00', currency: 'USD' },
      cashConsideration: { amount: '32500000.00', currency: 'USD' },
      newSharesIssued: '650000.0000',
      standaloneEps: '0.5000',
      proFormaEps: '0.5144',
      accretion: '0.0288',
      accretive: true,
    });
  });
});

describe('input validation', () => {
  it('rejects floating-point numbers, currency mismatches and impossible terminals', () => {
    expect(() =>
      runValuation(
        arrInputs({
          assumptions: { method: 'ARR_MULTIPLE', arr: 1.5 as unknown as string, multiple: '6' },
        }),
      ),
    ).toThrow(/decimal string/);
    expect(() =>
      runValuation(arrInputs({ adjustments: [{ ...adjustments[0]!, currency: 'EUR' }] })),
    ).toThrow(/scenario currency/);
    expect(() =>
      runValuation(arrInputs({ adjustments: [adjustments[0]!, adjustments[0]!] })),
    ).toThrow(/linked only once/);
    expect(() =>
      runValuation(
        arrInputs({
          assumptions: {
            method: 'DCF',
            baseRevenue: '1',
            years: [{ growth: '0', fcfMargin: '0.1' }],
            discountRate: '0.05',
            terminal: { kind: 'GORDON', growth: '0.05' },
          },
        }),
      ),
    ).toThrow(/below the discount rate/);
  });
});

describe('stale propagation', () => {
  const accepted = (adjustment: LinkedAdjustment): LinkedFindingState => ({
    findingId: adjustment.findingId,
    version: adjustment.findingVersion,
    status: 'ACCEPTED',
    pricedRisk: {
      type: adjustment.type,
      currency: adjustment.currency,
      low: adjustment.low,
      high: adjustment.high,
    },
  });
  const current = (): Map<string, LinkedFindingState | null> =>
    new Map(adjustments.map((a) => [a.findingId, accepted(a)]));
  const base = { resultAssumptionVersion: 2, currentAssumptionVersion: 2, adjustments };

  it('is fresh while assumptions and every linked accepted risk are unchanged', () => {
    expect(staleReasons({ ...base, current: current() })).toEqual([]);
  });

  it('goes stale when a linked accepted risk changes, is reopened or vanishes', () => {
    const changed = current();
    changed.set(FINDING_B, {
      ...accepted(adjustments[0]!),
      version: 4,
      pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '1500000', high: '3000000' },
    });
    changed.set(FINDING_A, { ...accepted(adjustments[1]!), status: 'IN_REVIEW' });
    changed.set(FINDING_C, null);
    expect(staleReasons({ ...base, current: changed })).toEqual([
      { kind: 'FINDING_CHANGED', findingId: FINDING_B },
      { kind: 'FINDING_NOT_ACCEPTED', findingId: FINDING_A },
      { kind: 'FINDING_MISSING', findingId: FINDING_C },
    ]);
    expect(
      staleReasons({ ...base, currentAssumptionVersion: 3, current: current() }),
    ).toEqual([{ kind: 'ASSUMPTIONS_CHANGED' }]);
  });
});

describe('frozen submissions', () => {
  it('serialises canonically and verifies byte-for-byte', () => {
    const result = runValuation(arrInputs({ adjustments }));
    const first = freeze({ result, scenario: { name: 'Base', version: 1 } });
    const second = freeze(JSON.parse(first.canonical));
    expect(second.canonical).toBe(first.canonical);
    expect(second.digest).toBe(first.digest);
    expect(verifyFrozen(first)).toBe(true);
    expect(verifyFrozen({ ...first, canonical: `${first.canonical} ` })).toBe(false);
    expect(canonicalJson({ b: 1, a: ['x', null] })).toBe('{"a":["x",null],"b":1}');
    expect(() => canonicalJson({ price: 1.5 })).toThrow(/decimal strings/);
  });
});
