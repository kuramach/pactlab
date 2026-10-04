import { PRICED_RISK_TYPES, type PricedRisk } from './types';

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;

export class FindingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindingValidationError';
  }
}

/** Integer value of a non-negative decimal string at scale 4. No floating point. */
function scaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

/**
 * Validate a proposed valuation adjustment: non-negative decimal strings,
 * explicit ISO currency, ordered range and a stated basis.
 */
export function validatePricedRisk(risk: PricedRisk): PricedRisk {
  if (!(PRICED_RISK_TYPES as readonly string[]).includes(risk.type))
    throw new FindingValidationError('Unknown priced-risk type');
  if (!CURRENCY.test(risk.currency)) throw new FindingValidationError('Invalid currency code');
  if (typeof risk.low !== 'string' || typeof risk.high !== 'string')
    throw new FindingValidationError('Amounts must be decimal strings');
  if (!DECIMAL.test(risk.low) || !DECIMAL.test(risk.high))
    throw new FindingValidationError('Amounts must be non-negative decimal strings');
  if (scaled(risk.low) > scaled(risk.high))
    throw new FindingValidationError('Priced-risk low must not exceed high');
  if (risk.basis.trim().length === 0) throw new FindingValidationError('Priced risk needs a basis');
  return risk;
}
