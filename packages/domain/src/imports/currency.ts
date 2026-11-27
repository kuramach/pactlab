import type { CsvTable } from '../evidence/csv';
import { isCurrencyCode } from '../money/currencies';
import type { ImportMapping } from './mapping';
import type { TargetDefinition } from './targets';

/**
 * The currency of an import (T-170, ADR 0056). A pact's amounts live in its own currency and nothing
 * is converted silently, so a file in another currency, or one that mixes currencies inside one
 * statement set, never imports. Pactlab reads what the file says (codes and symbols in its header
 * and first rows); the person declares the currency when the file does not say, and is asked when
 * what the file says and the pact disagree.
 */

/** Codes Pactlab recognises in a header or a cell: real ISO 4217 codes, never words like ARR or COGS. */
const KNOWN_CODES = new Set([
  'USD', 'GBP', 'EUR', 'JPY', 'INR', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'HUF', 'MXN', 'BRL', 'ZAR', 'AED', 'SAR', 'KRW', 'ILS', 'TRY', 'THB', 'IDR', 'MYR', 'PHP',
]);

/** Unambiguous symbols only. `$` alone is shared by many dollars and `¥` by JPY and CNY, so neither is read. */
const SYMBOLS: Readonly<Record<string, string>> = { '£': 'GBP', '€': 'EUR', '₹': 'INR', '￥': 'JPY', 'US$': 'USD', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD', 'HK$': 'HKD', 'S$': 'SGD', 'Rs.': 'INR' };

/** Rows read for clues beyond the header: a statement's title block and first lines. */
const SCAN_ROWS = 40;

/**
 * Currencies a file states in its header and first rows, in first-seen order. Cells in `skipColumns`
 * (line names, tenants, clients) are not read: "Loss on a USD loan" is a line, not the file's currency.
 */
export function detectFileCurrencies(table: CsvTable, skipColumns: readonly number[] = []): string[] {
  const found: string[] = [];
  const note = (code: string) => {
    if (!found.includes(code)) found.push(code);
  };
  const read = (cell: string) => {
    for (const match of cell.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)) {
      const code = match[1] as string;
      if (KNOWN_CODES.has(code)) note(code);
    }
    for (const [symbol, code] of Object.entries(SYMBOLS)) if (cell.includes(symbol)) note(code);
  };
  table.header.forEach(read);
  for (const row of table.rows.slice(0, SCAN_ROWS)) row.cells.forEach((cell, index) => (skipColumns.includes(index) ? null : read(cell)));
  return found;
}

export interface ImportCurrencyCheck {
  /** The pact's own currency: every amount is read in it. */
  readonly pact: string;
  /** What the person declared on the mapping, if anything. */
  readonly declared: string | null;
  /** What the file itself states. */
  readonly detected: readonly string[];
  /** The currency the amounts will be read in. */
  readonly readAs: string;
  /** What stops the import, in plain words. */
  readonly problems: readonly string[];
  /** Asked of the reviewer when the file and the pact disagree and nobody has declared a currency. */
  readonly question: string | null;
}

/**
 * The currency check for one upload. Targets whose rows carry their own currency column (billing)
 * are checked per row by the metrics engine with recorded FX rates; every other target is read in
 * the pact's currency and must be in it.
 */
export function importCurrencyCheck(definition: TargetDefinition, table: CsvTable, mapping: Pick<ImportMapping, 'currency' | 'fields'>, pactCurrency: string): ImportCurrencyCheck {
  const pact = pactCurrency.toUpperCase();
  const declared = mapping.currency ? mapping.currency.toUpperCase() : null;
  if (definition.fields.some((field) => field.kind === 'currency')) {
    return { pact, declared, detected: [], readAs: pact, problems: [], question: null };
  }
  const textColumns = definition.fields
    .filter((field) => field.kind !== 'money' && field.kind !== 'decimal')
    .map((field) => mapping.fields[field.name])
    .flatMap((source) => (source?.kind === 'column' ? [table.header.indexOf(source.column)] : []))
    .filter((index) => index >= 0);
  const detected = detectFileCurrencies(table, textColumns);
  const problems: string[] = [];
  let question: string | null = null;
  if (declared !== null && !isCurrencyCode(declared)) problems.push(`"${mapping.currency}" is not an ISO 4217 currency code`);
  if (detected.length > 1) {
    problems.push(
      `This file mixes amounts in ${detected.join(' and ')}. One ${definition.lineItems ? 'statement' : 'import'} must be in one currency, and Pactlab never converts: import each currency's figures as its own file, in ${pact}.`,
    );
  }
  const stated = declared ?? (detected.length === 1 ? (detected[0] as string) : null);
  if (stated !== null && stated !== pact && isCurrencyCode(stated)) {
    problems.push(
      `${declared ? 'You said these amounts are' : 'This file shows amounts'} in ${stated}, but this pact is in ${pact}. Pactlab never converts amounts: import the figures in ${pact}${declared ? '' : ', or say the file is in ' + pact + ' if the label is wrong'}.`,
    );
    if (!declared) question = `This file shows ${stated}; the pact is in ${pact}. What currency are these amounts in?`;
  }
  return { pact, declared, detected, readAs: stated && problems.length === 0 ? stated : pact, problems, question };
}
