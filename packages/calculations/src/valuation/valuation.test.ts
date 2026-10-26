import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  effectiveBridgeAssumptions,
  freeze,
  runValuation,
  staleReasons,
  valuationInputHash,
  ValuationInputError,
  verifyFrozen,
  type LinkedAdjustment,
  type LinkedBalanceSheetItem,
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

describe('evidence-backed balance-sheet items', () => {
  const base: ValuationInputs = {
    currency: 'USD',
    transactionType: 'PRIVATE_ACQUIRER',
    assumptions: { method: 'ARR_MULTIPLE', arr: '268000', multiple: '4' },
    bridge: { cash: '0', debt: '10000', debtLikeItems: '0', workingCapitalAdjustment: '-20000' },
    stockConsiderationShare: '0',
    adjustments: [],
    lbo: null,
    accretionDilution: null,
    sensitivity: null,
  };
  const item = (itemId: string, kind: LinkedBalanceSheetItem['kind'], category: LinkedBalanceSheetItem['category'], amount: string): LinkedBalanceSheetItem => ({
    itemId,
    itemVersion: 1,
    kind,
    category,
    label: `${category} (synthetic)`,
    currency: 'USD',
    amount,
  });
  const items = [
    item('0190f000-0000-7000-8000-0000000000c1', 'CASH', 'CASH', '90000'),
    item('0190f000-0000-7000-8000-0000000000d1', 'DEBT', 'TERM_LOAN', '120000'),
    item('0190f000-0000-7000-8000-0000000000e1', 'DEBT_LIKE', 'DEFERRED_REVENUE', '22000'),
    item('0190f000-0000-7000-8000-0000000000e2', 'DEBT_LIKE', 'ACCRUED_BONUS', '13000'),
  ];

  it('adds each cited item to the bridge next to the entered amounts', () => {
    const result = runValuation({ ...base, balanceSheetItems: items });
    expect(result.engineVersion).toBe('valuation-2');
    // 1,072,000 + 90,000 − (10,000 + 120,000) − 35,000 − 20,000
    expect(result.bridge.equityValue.amount).toBe('977000.00');
    expect(result.bridge.lines.slice(0, 9).map((line) => [line.kind, line.amount.amount, line.balanceSheetItemId ?? null])).toEqual([
      ['ENTERPRISE_VALUE', '1072000.00', null],
      ['CASH', '0.00', null],
      ['CASH_ITEM', '90000.00', items[0]!.itemId],
      ['DEBT', '-10000.00', null],
      ['DEBT_ITEM', '-120000.00', items[1]!.itemId],
      ['DEBT_LIKE_ITEMS', '0.00', null],
      ['DEBT_LIKE_ITEM', '-22000.00', items[2]!.itemId],
      ['DEBT_LIKE_ITEM', '-13000.00', items[3]!.itemId],
      ['WORKING_CAPITAL', '-20000.00', null],
    ]);
    expect(effectiveBridgeAssumptions({ bridge: base.bridge, balanceSheetItems: items })).toEqual({
      cash: '90000',
      debt: '130000',
      debtLikeItems: '35000',
      workingCapitalAdjustment: '-20000',
    });
  });

  it('keeps results without items as before', () => {
    const result = runValuation(base);
    expect(result.bridge.lines.some((line) => 'balanceSheetItemId' in line)).toBe(false);
    expect(result.bridge.equityValue.amount).toBe('1042000.00');
  });

  it('refuses mismatched categories, currencies, negative amounts and duplicate links', () => {
    const bad = (override: Partial<LinkedBalanceSheetItem>) => () => runValuation({ ...base, balanceSheetItems: [{ ...items[1]!, ...override }] });
    expect(bad({ category: 'DEFERRED_REVENUE' })).toThrow(ValuationInputError);
    expect(bad({ currency: 'EUR' })).toThrow(ValuationInputError);
    expect(bad({ amount: '-1' })).toThrow(ValuationInputError);
    expect(() => runValuation({ ...base, balanceSheetItems: [items[1]!, items[1]!] })).toThrow(ValuationInputError);
  });

  it('goes stale when a linked item is revised or withdrawn', () => {
    const state = (version: number, status: 'ACTIVE' | 'WITHDRAWN' = 'ACTIVE') => ({ itemId: items[1]!.itemId, version, status });
    const check = (current: ReturnType<typeof state> | null) =>
      staleReasons({
        resultAssumptionVersion: 1,
        currentAssumptionVersion: 1,
        adjustments: [],
        current: new Map(),
        balanceSheetItems: [items[1]!],
        currentItems: new Map([[items[1]!.itemId, current]]),
      });
    expect(check(state(1))).toEqual([]);
    expect(check(state(2))).toEqual([{ kind: 'BALANCE_SHEET_ITEM_CHANGED', itemId: items[1]!.itemId }]);
    expect(check(state(1, 'WITHDRAWN'))).toEqual([{ kind: 'BALANCE_SHEET_ITEM_MISSING', itemId: items[1]!.itemId }]);
    expect(check(null)).toEqual([{ kind: 'BALANCE_SHEET_ITEM_MISSING', itemId: items[1]!.itemId }]);
  });
});

describe('NOI ÷ capitalization rate (T-059)', () => {
  const base = {
    currency: 'USD',
    transactionType: 'PRIVATE_ACQUIRER' as const,
    assumptions: { method: 'NOI_CAP_RATE' as const, noi: '1170711.00', capRate: '0.055' },
    bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
    adjustments: [],
    balanceSheetItems: [],
    sensitivity: null,
    lbo: null,
    accretionDilution: null,
    stockConsiderationShare: '0',
  };

  it('values the property at NOI over the cap rate, exactly', () => {
    const result = runValuation(base as unknown as Parameters<typeof runValuation>[0]);
    expect(result.method).toEqual({ method: 'NOI_CAP_RATE', noi: { amount: '1170711.00', currency: 'USD' }, capRate: '0.055' });
    expect(result.enterpriseValue.amount).toBe('21285654.55');
  });

  it('refuses a cap rate of zero or above 100%, and leaves a zero-rate sensitivity cell empty', () => {
    for (const capRate of ['0', '1.5', '-0.01']) {
      expect(() => runValuation({ ...base, assumptions: { ...base.assumptions, capRate } } as unknown as Parameters<typeof runValuation>[0])).toThrow(ValuationInputError);
    }
    const grid = runValuation({
      ...base,
      sensitivity: { rows: { variable: 'capRate', values: ['0.05', '0.06'] }, columns: { variable: 'noi', values: ['1000000', '1200000'] } },
    } as unknown as Parameters<typeof runValuation>[0]).sensitivity;
    expect(grid?.cells).toEqual([
      [{ amount: '20000000.00', currency: 'USD' }, { amount: '24000000.00', currency: 'USD' }],
      [{ amount: '16666666.67', currency: 'USD' }, { amount: '20000000.00', currency: 'USD' }],
    ]);
    expect(() =>
      runValuation({ ...base, sensitivity: { rows: { variable: 'arr', values: ['1'] }, columns: { variable: 'noi', values: ['1'] } } } as unknown as Parameters<typeof runValuation>[0]),
    ).toThrow(ValuationInputError);
  });
});

describe('payer-mix-adjusted EBITDA (T-069)', () => {
  const base = {
    currency: 'USD',
    transactionType: 'PRIVATE_ACQUIRER' as const,
    assumptions: {
      method: 'PAYER_MIX_EBITDA' as const,
      ebitda: '6000000.00',
      netRevenue: '40000000.00',
      multiple: '9',
      payers: [
        { payer: 'Government programme A', share: '0.567', rateChange: '-0.02' },
        { payer: 'Commercial plan Keystone', share: '0.18', rateChange: '0.03' },
      ],
    },
    bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
    adjustments: [],
    balanceSheetItems: [],
    sensitivity: null,
    lbo: null,
    accretionDilution: null,
    stockConsiderationShare: '0',
  };
  const run = (inputs: unknown) => runValuation(inputs as Parameters<typeof runValuation>[0]);

  it('moves each payer’s rate change on its share of net revenue straight to EBITDA, exactly', () => {
    const result = run(base);
    // 40m × 0.567 × −0.02 = −453,600; 40m × 0.18 × 0.03 = +216,000 → 5,762,400 × 9.
    expect(result.method).toEqual({
      method: 'PAYER_MIX_EBITDA',
      reportedEbitda: { amount: '6000000.00', currency: 'USD' },
      adjustedEbitda: { amount: '5762400.00', currency: 'USD' },
      multiple: '9',
      payers: [
        { payer: 'Government programme A', share: '0.567', rateChange: '-0.02', ebitdaEffect: { amount: '-453600.00', currency: 'USD' } },
        { payer: 'Commercial plan Keystone', share: '0.18', rateChange: '0.03', ebitdaEffect: { amount: '216000.00', currency: 'USD' } },
      ],
    });
    expect(result.enterpriseValue.amount).toBe('51861600.00');
    // With no payers it is a plain EBITDA multiple.
    expect(run({ ...base, assumptions: { ...base.assumptions, payers: [] } }).enterpriseValue.amount).toBe('54000000.00');
  });

  it('refuses shares above 100% in total, rate changes beyond ±100% and unnamed payers; sensitivity runs on EBITDA and the multiple', () => {
    const payers = (list: unknown[]) => ({ ...base, assumptions: { ...base.assumptions, payers: list } });
    expect(() => run(payers([{ payer: 'A', share: '0.7', rateChange: '0' }, { payer: 'B', share: '0.4', rateChange: '0' }]))).toThrow(ValuationInputError);
    expect(() => run(payers([{ payer: 'A', share: '0.5', rateChange: '-1.5' }]))).toThrow(ValuationInputError);
    expect(() => run(payers([{ payer: ' ', share: '0.5', rateChange: '0' }]))).toThrow(ValuationInputError);
    const grid = run({ ...payers([]), sensitivity: { rows: { variable: 'ebitda', values: ['5000000', '6000000'] }, columns: { variable: 'multiple', values: ['8', '10'] } } }).sensitivity;
    expect(grid?.cells).toEqual([
      [{ amount: '40000000.00', currency: 'USD' }, { amount: '50000000.00', currency: 'USD' }],
      [{ amount: '48000000.00', currency: 'USD' }, { amount: '60000000.00', currency: 'USD' }],
    ]);
    expect(() => run({ ...base, sensitivity: { rows: { variable: 'capRate', values: ['0.05'] }, columns: { variable: 'multiple', values: ['8'] } } })).toThrow(ValuationInputError);
  });
});
