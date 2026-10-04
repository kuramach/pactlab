import type Decimal from 'decimal.js';
import { D } from '../metrics/decimal';
import {
  ADJUSTMENT_POINTS,
  ADJUSTMENT_TYPES,
  SENSITIVITY_VARIABLES,
  VALUATION_TRANSACTION_TYPES,
  type SensitivityVariable,
  type ValuationInputs,
} from './types';

export class ValuationInputError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ValuationInputError';
  }
}

const DECIMAL_STRING = /^-?\d{1,18}(\.\d{1,12})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_DCF_YEARS = 10;
const MAX_SENSITIVITY_POINTS = 9;
const MAX_HOLD_YEARS = 15;

interface Bounds {
  readonly min?: string;
  readonly max?: string;
  /** Exclusive lower bound. */
  readonly above?: string;
}

/** Parse a bounded decimal string. Numbers, exponents and blanks are rejected. */
export function decimal(value: unknown, path: string, bounds: Bounds = {}): Decimal {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    throw new ValuationInputError(path, 'must be a decimal string, never a floating-point number');
  }
  const parsed = new D(value);
  if (bounds.min !== undefined && parsed.lessThan(bounds.min)) {
    throw new ValuationInputError(path, `must be at least ${bounds.min}`);
  }
  if (bounds.above !== undefined && parsed.lessThanOrEqualTo(bounds.above)) {
    throw new ValuationInputError(path, `must be greater than ${bounds.above}`);
  }
  if (bounds.max !== undefined && parsed.greaterThan(bounds.max)) {
    throw new ValuationInputError(path, `must be at most ${bounds.max}`);
  }
  return parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValuationInputError(path, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function sensitivityApplies(variable: SensitivityVariable, inputs: ValuationInputs): boolean {
  const assumptions = inputs.assumptions;
  if (assumptions.method === 'ARR_MULTIPLE') return variable === 'arr' || variable === 'multiple';
  if (variable === 'discountRate') return true;
  if (variable === 'terminalGrowth') return assumptions.terminal.kind === 'GORDON';
  if (variable === 'terminalMultiple') return assumptions.terminal.kind === 'EXIT_MULTIPLE';
  return false;
}

/**
 * Reject an input set the engines cannot value deterministically. Checks
 * are structural and arithmetic only; they never judge whether an
 * assumption is commercially reasonable.
 */
export function validateInputs(inputs: ValuationInputs): void {
  if (!CURRENCY.test(inputs.currency)) throw new ValuationInputError('currency', 'invalid code');
  oneOf(inputs.transactionType, VALUATION_TRANSACTION_TYPES, 'transactionType');

  const assumptions = inputs.assumptions;
  if (assumptions.method === 'ARR_MULTIPLE') {
    decimal(assumptions.arr, 'assumptions.arr', { min: '0' });
    decimal(assumptions.multiple, 'assumptions.multiple', { min: '0', max: '1000' });
  } else if (assumptions.method === 'DCF') {
    decimal(assumptions.baseRevenue, 'assumptions.baseRevenue', { min: '0' });
    if (assumptions.years.length < 1 || assumptions.years.length > MAX_DCF_YEARS) {
      throw new ValuationInputError('assumptions.years', `must have 1 to ${MAX_DCF_YEARS} years`);
    }
    assumptions.years.forEach((year, index) => {
      decimal(year.growth, `assumptions.years.${index}.growth`, { above: '-1', max: '10' });
      decimal(year.fcfMargin, `assumptions.years.${index}.fcfMargin`, { min: '-10', max: '1' });
    });
    const rate = decimal(assumptions.discountRate, 'assumptions.discountRate', {
      above: '0',
      max: '1',
    });
    if (assumptions.terminal.kind === 'GORDON') {
      const growth = decimal(assumptions.terminal.growth, 'assumptions.terminal.growth', {
        above: '-1',
      });
      if (growth.greaterThanOrEqualTo(rate)) {
        throw new ValuationInputError(
          'assumptions.terminal.growth',
          'must be below the discount rate',
        );
      }
    } else if (assumptions.terminal.kind === 'EXIT_MULTIPLE') {
      decimal(assumptions.terminal.revenueMultiple, 'assumptions.terminal.revenueMultiple', {
        min: '0',
        max: '1000',
      });
    } else {
      throw new ValuationInputError('assumptions.terminal.kind', 'unknown terminal method');
    }
  } else {
    throw new ValuationInputError('assumptions.method', 'unknown valuation method');
  }

  decimal(inputs.bridge.cash, 'bridge.cash', { min: '0' });
  decimal(inputs.bridge.debt, 'bridge.debt', { min: '0' });
  decimal(inputs.bridge.debtLikeItems, 'bridge.debtLikeItems', { min: '0' });
  decimal(inputs.bridge.workingCapitalAdjustment, 'bridge.workingCapitalAdjustment');

  const stockShare = decimal(inputs.stockConsiderationShare, 'stockConsiderationShare', {
    min: '0',
    max: '1',
  });

  const seen = new Set<string>();
  inputs.adjustments.forEach((adjustment, index) => {
    const path = `adjustments.${index}`;
    if (seen.has(adjustment.findingId)) {
      throw new ValuationInputError(`${path}.findingId`, 'a finding may be linked only once');
    }
    seen.add(adjustment.findingId);
    if (!Number.isSafeInteger(adjustment.findingVersion) || adjustment.findingVersion < 1) {
      throw new ValuationInputError(`${path}.findingVersion`, 'must be a positive integer');
    }
    oneOf(adjustment.type, ADJUSTMENT_TYPES, `${path}.type`);
    oneOf(adjustment.point, ADJUSTMENT_POINTS, `${path}.point`);
    if (adjustment.currency !== inputs.currency) {
      throw new ValuationInputError(
        `${path}.currency`,
        'must match the scenario currency; convert explicitly with a recorded FX rate',
      );
    }
    const low = decimal(adjustment.low, `${path}.low`, { min: '0' });
    const high = decimal(adjustment.high, `${path}.high`, { min: '0' });
    if (low.greaterThan(high)) throw new ValuationInputError(`${path}.low`, 'must not exceed high');
  });

  if (inputs.transactionType === 'TAKE_PRIVATE' && !inputs.lbo) {
    throw new ValuationInputError('lbo', 'take-private scenarios require LBO inputs');
  }
  if (inputs.lbo) {
    const lbo = inputs.lbo;
    decimal(lbo.entryEbitda, 'lbo.entryEbitda', { min: '0' });
    decimal(lbo.leverageMultiple, 'lbo.leverageMultiple', { min: '0', max: '20' });
    decimal(lbo.exitEbitda, 'lbo.exitEbitda', { min: '0' });
    decimal(lbo.exitMultiple, 'lbo.exitMultiple', { min: '0', max: '1000' });
    decimal(lbo.debtRepaid, 'lbo.debtRepaid', { min: '0' });
    if (!Number.isSafeInteger(lbo.holdYears) || lbo.holdYears < 1 || lbo.holdYears > MAX_HOLD_YEARS) {
      throw new ValuationInputError('lbo.holdYears', `must be 1 to ${MAX_HOLD_YEARS} whole years`);
    }
  }

  if (stockShare.greaterThan(0) && !inputs.accretionDilution) {
    throw new ValuationInputError(
      'accretionDilution',
      'stock consideration requires accretion/dilution inputs',
    );
  }
  if (inputs.accretionDilution) {
    const ad = inputs.accretionDilution;
    decimal(ad.acquirerNetIncome, 'accretionDilution.acquirerNetIncome');
    decimal(ad.acquirerShares, 'accretionDilution.acquirerShares', { above: '0' });
    decimal(ad.acquirerSharePrice, 'accretionDilution.acquirerSharePrice', { above: '0' });
    decimal(ad.targetNetIncome, 'accretionDilution.targetNetIncome');
    decimal(ad.pretaxSynergies, 'accretionDilution.pretaxSynergies');
    decimal(ad.taxRate, 'accretionDilution.taxRate', { min: '0', max: '1' });
    decimal(ad.cashInterestRate, 'accretionDilution.cashInterestRate', { min: '0', max: '1' });
    if (new D(ad.acquirerNetIncome).isZero()) {
      throw new ValuationInputError(
        'accretionDilution.acquirerNetIncome',
        'standalone EPS must be non-zero',
      );
    }
  }

  if (inputs.sensitivity) {
    for (const axis of ['rows', 'columns'] as const) {
      const spec = inputs.sensitivity[axis];
      const variable = oneOf(spec.variable, SENSITIVITY_VARIABLES, `sensitivity.${axis}.variable`);
      if (!sensitivityApplies(variable, inputs)) {
        throw new ValuationInputError(
          `sensitivity.${axis}.variable`,
          'does not apply to this method',
        );
      }
      if (spec.values.length < 1 || spec.values.length > MAX_SENSITIVITY_POINTS) {
        throw new ValuationInputError(
          `sensitivity.${axis}.values`,
          `must have 1 to ${MAX_SENSITIVITY_POINTS} values`,
        );
      }
      spec.values.forEach((value, index) =>
        decimal(value, `sensitivity.${axis}.values.${index}`, { min: '-1' }),
      );
    }
    if (inputs.sensitivity.rows.variable === inputs.sensitivity.columns.variable) {
      throw new ValuationInputError('sensitivity.columns.variable', 'must differ from rows');
    }
  }
}
