import Decimal from 'decimal.js';
import { D, money, RATIO_SCALE, sum } from '../metrics/decimal';
import type { MoneyValue } from '../metrics/types';
import { canonicalJson, sha256Hex } from './canonical';
import {
  VALUATION_ENGINE_VERSION,
  type AccretionDilutionResult,
  type AdjustmentType,
  type BridgeLine,
  type DcfAssumptions,
  type DcfYearResult,
  type LinkedAdjustment,
  type LboResult,
  type MethodAssumptions,
  type MethodResult,
  type PurchasePriceBridge,
  type SensitivityResult,
  type SensitivityVariable,
  type ValuationInputs,
  type ValuationResult,
} from './types';
import { validateInputs } from './validate';

const DISCOUNT_FACTOR_SCALE = 12;

/** Adjustments that lower the equity price; the others are held back from cash at close. */
const PRICE_REDUCING: ReadonlySet<AdjustmentType> = new Set(['PRICE_REDUCTION', 'REMEDIATION_COST']);

const ADJUSTMENT_LABELS: Readonly<Record<AdjustmentType, string>> = {
  PRICE_REDUCTION: 'Price reduction',
  REMEDIATION_COST: 'Remediation cost',
  ESCROW: 'Escrow holdback',
  INDEMNITY: 'Special indemnity holdback',
};

function ratio4(value: Decimal): string {
  return value.toFixed(RATIO_SCALE, Decimal.ROUND_HALF_EVEN);
}

/** The amount a scenario applies from a priced-risk range. */
export function adjustmentAmount(adjustment: LinkedAdjustment): Decimal {
  const low = new D(adjustment.low);
  const high = new D(adjustment.high);
  if (adjustment.point === 'LOW') return low;
  if (adjustment.point === 'HIGH') return high;
  return low.plus(high).dividedBy(2);
}

interface DcfComputation {
  readonly enterpriseValue: Decimal;
  readonly years: { revenue: Decimal; fcf: Decimal; factor: Decimal; pv: Decimal }[];
  readonly terminalValue: Decimal;
  readonly pvTerminal: Decimal;
}

/** End-of-year discounting; the terminal value sits at the end of the final year. */
function computeDcf(assumptions: DcfAssumptions): DcfComputation {
  const rate = new D(assumptions.discountRate);
  let revenue = new D(assumptions.baseRevenue);
  const years = assumptions.years.map((year, index) => {
    revenue = revenue.times(new D(1).plus(year.growth));
    const fcf = revenue.times(year.fcfMargin);
    const factor = new D(1).dividedBy(new D(1).plus(rate).pow(index + 1));
    return { revenue, fcf, factor, pv: fcf.times(factor) };
  });
  const last = years[years.length - 1];
  if (!last) throw new Error('DCF requires at least one projection year');
  const terminalValue =
    assumptions.terminal.kind === 'GORDON'
      ? last.fcf
          .times(new D(1).plus(assumptions.terminal.growth))
          .dividedBy(rate.minus(assumptions.terminal.growth))
      : last.revenue.times(assumptions.terminal.revenueMultiple);
  const pvTerminal = terminalValue.times(last.factor);
  return {
    enterpriseValue: sum(years.map((year) => year.pv)).plus(pvTerminal),
    years,
    terminalValue,
    pvTerminal,
  };
}

function enterpriseValueOf(assumptions: MethodAssumptions): Decimal {
  return assumptions.method === 'ARR_MULTIPLE'
    ? new D(assumptions.arr).times(assumptions.multiple)
    : computeDcf(assumptions).enterpriseValue;
}

function methodResult(assumptions: MethodAssumptions, currency: string): MethodResult {
  if (assumptions.method === 'ARR_MULTIPLE') {
    return {
      method: 'ARR_MULTIPLE',
      arr: money(new D(assumptions.arr), currency),
      multiple: assumptions.multiple,
    };
  }
  const dcf = computeDcf(assumptions);
  return {
    method: 'DCF',
    years: dcf.years.map(
      (year, index): DcfYearResult => ({
        year: index + 1,
        revenue: money(year.revenue, currency),
        freeCashFlow: money(year.fcf, currency),
        discountFactor: year.factor.toFixed(DISCOUNT_FACTOR_SCALE, Decimal.ROUND_HALF_EVEN),
        presentValue: money(year.pv, currency),
      }),
    ),
    terminalValue: money(dcf.terminalValue, currency),
    presentValueOfTerminal: money(dcf.pvTerminal, currency),
    presentValueOfCashFlows: money(sum(dcf.years.map((year) => year.pv)), currency),
  };
}

function withOverride(
  assumptions: MethodAssumptions,
  variable: SensitivityVariable,
  value: string,
): MethodAssumptions {
  if (assumptions.method === 'ARR_MULTIPLE') {
    return variable === 'arr' ? { ...assumptions, arr: value } : { ...assumptions, multiple: value };
  }
  if (variable === 'discountRate') return { ...assumptions, discountRate: value };
  if (variable === 'terminalGrowth') {
    return { ...assumptions, terminal: { kind: 'GORDON', growth: value } };
  }
  return { ...assumptions, terminal: { kind: 'EXIT_MULTIPLE', revenueMultiple: value } };
}

function sensitivityGrid(inputs: ValuationInputs): SensitivityResult | null {
  const spec = inputs.sensitivity;
  if (!spec) return null;
  const cells = spec.rows.values.map((rowValue) =>
    spec.columns.values.map((columnValue): MoneyValue | null => {
      const varied = withOverride(
        withOverride(inputs.assumptions, spec.rows.variable, rowValue),
        spec.columns.variable,
        columnValue,
      );
      // A Gordon cell with growth at or above the discount rate has no finite value.
      if (
        varied.method === 'DCF' &&
        varied.terminal.kind === 'GORDON' &&
        new D(varied.terminal.growth).greaterThanOrEqualTo(varied.discountRate)
      ) {
        return null;
      }
      if (varied.method === 'DCF' && new D(varied.discountRate).lessThanOrEqualTo(0)) {
        return null;
      }
      return money(enterpriseValueOf(varied), inputs.currency);
    }),
  );
  return {
    rowVariable: spec.rows.variable,
    columnVariable: spec.columns.variable,
    rows: [...spec.rows.values],
    columns: [...spec.columns.values],
    cells,
  };
}

interface BridgeComputation {
  readonly bridge: PurchasePriceBridge;
  readonly equityPurchasePrice: Decimal;
  readonly priceReductions: Decimal;
}

function purchasePriceBridge(inputs: ValuationInputs, enterpriseValue: Decimal): BridgeComputation {
  const currency = inputs.currency;
  const line = (
    kind: BridgeLine['kind'],
    label: string,
    amount: Decimal,
    adjustment: LinkedAdjustment | null = null,
  ): BridgeLine => ({
    kind,
    label,
    amount: money(amount, currency),
    findingId: adjustment?.findingId ?? null,
    adjustmentType: adjustment?.type ?? null,
  });

  const cash = new D(inputs.bridge.cash);
  const debt = new D(inputs.bridge.debt);
  const debtLike = new D(inputs.bridge.debtLikeItems);
  const workingCapital = new D(inputs.bridge.workingCapitalAdjustment);
  const equityValue = enterpriseValue.plus(cash).minus(debt).minus(debtLike).plus(workingCapital);

  const lines: BridgeLine[] = [
    line('ENTERPRISE_VALUE', 'Enterprise value', enterpriseValue),
    line('CASH', 'Plus cash', cash),
    line('DEBT', 'Less debt', debt.negated()),
    line('DEBT_LIKE_ITEMS', 'Less debt-like items', debtLike.negated()),
    line('WORKING_CAPITAL', 'Working-capital adjustment', workingCapital),
    line('EQUITY_VALUE', 'Equity value', equityValue),
  ];

  // Stable order: by finding id, so link order never changes the bridge.
  const adjustments = [...inputs.adjustments].sort((a, b) =>
    a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0,
  );
  let priceReductions = new D(0);
  for (const adjustment of adjustments.filter((a) => PRICE_REDUCING.has(a.type))) {
    const amount = adjustmentAmount(adjustment);
    priceReductions = priceReductions.plus(amount);
    lines.push(
      line('FINDING_ADJUSTMENT', ADJUSTMENT_LABELS[adjustment.type], amount.negated(), adjustment),
    );
  }
  const equityPurchasePrice = equityValue.minus(priceReductions);
  lines.push(line('EQUITY_PURCHASE_PRICE', 'Equity purchase price', equityPurchasePrice));

  let holdbacks = new D(0);
  for (const adjustment of adjustments.filter((a) => !PRICE_REDUCING.has(a.type))) {
    const amount = adjustmentAmount(adjustment);
    holdbacks = holdbacks.plus(amount);
    lines.push(line('HOLDBACK', ADJUSTMENT_LABELS[adjustment.type], amount.negated(), adjustment));
  }
  const cashAtClose = equityPurchasePrice.minus(holdbacks);
  lines.push(line('CASH_AT_CLOSE', 'Cash at close', cashAtClose));

  return {
    bridge: {
      lines,
      enterpriseValue: money(enterpriseValue, currency),
      equityValue: money(equityValue, currency),
      equityPurchasePrice: money(equityPurchasePrice, currency),
      holdbacks: money(holdbacks, currency),
      cashAtClose: money(cashAtClose, currency),
    },
    equityPurchasePrice,
    priceReductions,
  };
}

/**
 * Sponsor returns with a single exit distribution: entry at the adjusted
 * enterprise value, acquisition debt sized off entry EBITDA, exit at a
 * multiple of exit EBITDA. IRR is MOIC^(1/years) - 1.
 */
function lboReturns(inputs: ValuationInputs, entryEnterpriseValue: Decimal): LboResult | null {
  const lbo = inputs.lbo;
  if (!lbo) return null;
  const currency = inputs.currency;
  const entryDebt = new D(lbo.entryEbitda).times(lbo.leverageMultiple);
  const entryEquity = entryEnterpriseValue.minus(entryDebt);
  const exitEnterpriseValue = new D(lbo.exitEbitda).times(lbo.exitMultiple);
  const exitDebt = Decimal.max(entryDebt.minus(lbo.debtRepaid), 0);
  const exitEquity = exitEnterpriseValue.minus(exitDebt);
  const moic = entryEquity.greaterThan(0) ? exitEquity.dividedBy(entryEquity) : null;
  const irr =
    moic && moic.greaterThan(0) ? moic.pow(new D(1).dividedBy(lbo.holdYears)).minus(1) : null;
  return {
    entryEnterpriseValue: money(entryEnterpriseValue, currency),
    entryDebt: money(entryDebt, currency),
    entryEquity: money(entryEquity, currency),
    exitEnterpriseValue: money(exitEnterpriseValue, currency),
    exitDebt: money(exitDebt, currency),
    exitEquity: money(exitEquity, currency),
    moic: moic ? ratio4(moic) : null,
    irr: irr ? ratio4(irr) : null,
  };
}

/** Acquirer EPS effect of paying part of the equity price in newly issued stock. */
function accretionDilution(
  inputs: ValuationInputs,
  equityPurchasePrice: Decimal,
): AccretionDilutionResult | null {
  const ad = inputs.accretionDilution;
  if (!ad) return null;
  const currency = inputs.currency;
  const stock = equityPurchasePrice.times(inputs.stockConsiderationShare);
  const cash = equityPurchasePrice.minus(stock);
  const afterTax = new D(1).minus(ad.taxRate);
  const newShares = stock.dividedBy(ad.acquirerSharePrice);
  const proFormaIncome = new D(ad.acquirerNetIncome)
    .plus(ad.targetNetIncome)
    .plus(new D(ad.pretaxSynergies).times(afterTax))
    .minus(cash.times(ad.cashInterestRate).times(afterTax));
  const standaloneEps = new D(ad.acquirerNetIncome).dividedBy(ad.acquirerShares);
  const proFormaEps = proFormaIncome.dividedBy(new D(ad.acquirerShares).plus(newShares));
  const accretion = proFormaEps.dividedBy(standaloneEps).minus(1);
  // A negative standalone EPS flips the sign of "better".
  const accretive = standaloneEps.isNegative()
    ? proFormaEps.greaterThan(standaloneEps)
    : accretion.greaterThan(0);
  return {
    stockConsideration: money(stock, currency),
    cashConsideration: money(cash, currency),
    newSharesIssued: ratio4(newShares),
    standaloneEps: ratio4(standaloneEps),
    proFormaEps: ratio4(proFormaEps),
    accretion: ratio4(accretion),
    accretive,
  };
}

/** SHA-256 of the canonical input set. */
export function valuationInputHash(inputs: ValuationInputs): string {
  return sha256Hex(canonicalJson({ engine: VALUATION_ENGINE_VERSION, inputs }));
}

/**
 * Run one scenario. Pure and deterministic: the result depends only on the
 * input set and the engine version, and every number is decimal math rounded
 * once, at output, to the currency's minor unit.
 */
export function runValuation(inputs: ValuationInputs): ValuationResult {
  validateInputs(inputs);
  const enterpriseValue = enterpriseValueOf(inputs.assumptions);
  const { bridge, equityPurchasePrice, priceReductions } = purchasePriceBridge(
    inputs,
    enterpriseValue,
  );
  return {
    engineVersion: VALUATION_ENGINE_VERSION,
    inputHash: valuationInputHash(inputs),
    currency: inputs.currency,
    method: methodResult(inputs.assumptions, inputs.currency),
    enterpriseValue: money(enterpriseValue, inputs.currency),
    bridge,
    sensitivity: sensitivityGrid(inputs),
    lbo: lboReturns(inputs, enterpriseValue.minus(priceReductions)),
    accretionDilution: accretionDilution(inputs, equityPurchasePrice),
  };
}
