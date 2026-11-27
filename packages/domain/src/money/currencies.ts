/**
 * ISO 4217 currencies (T-170, ADR 0056). A pact's amounts live in its own currency; this is the one
 * table of minor units that storage, calculation rounding and display all read.
 */

/** The launch set: formatted and tested end to end. The ISO schema stays open to other codes. */
export const LAUNCH_CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'INR'] as const;
export type LaunchCurrency = (typeof LAUNCH_CURRENCIES)[number];

/** The locales of the target markets (US, UK, Germany, France, Japan, India). */
export const LAUNCH_LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'en-IN'] as const;
export type LaunchLocale = (typeof LAUNCH_LOCALES)[number];

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** ISO 4217 minor-unit exponents that differ from 2 (JPY has none: the classic bug). */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0,
  VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value);
}

/** Digits after the decimal point in the currency's minor unit; 2 unless ISO 4217 says otherwise. */
export function currencyMinorUnits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

/** How many decimals a decimal string carries beyond what its currency allows (0 when it fits). */
export function excessMinorDigits(amount: string, currency: string): number {
  const fraction = /\.(\d+)$/.exec(amount.trim())?.[1]?.replace(/0+$/, '') ?? '';
  return Math.max(0, fraction.length - currencyMinorUnits(currency));
}
