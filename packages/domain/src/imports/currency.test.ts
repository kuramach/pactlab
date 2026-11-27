import { describe, expect, it } from 'vitest';
import { parseCsv } from '../evidence/csv';
import { detectFileCurrencies, importCurrencyCheck } from './currency';
import { applyMapping, type ImportMapping } from './mapping';
import { FINANCIAL_PNL, BILLING_INVOICE_LINE, MULTIFAMILY_RENT_ROLL } from './targets';

const pnl = (csv: string, extra: Partial<ImportMapping> = {}): ImportMapping => ({
  target: 'FINANCIAL_PNL',
  fields: { account: { kind: 'column', column: 'account' }, month: { kind: 'column', column: 'month' }, amount: { kind: 'column', column: parseCsv(csv).header[2] ?? 'amount' } },
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
  lineKinds: { Revenue: 'REVENUE', 'FX loss on USD loan': 'OTHER_EXPENSE' },
  ...extra,
});

describe('import currency (T-170)', () => {
  it('reads codes and unambiguous symbols, never words or a bare $', () => {
    expect(detectFileCurrencies(parseCsv('line,FY2024 (EUR),FY2025 (EUR)\nRevenue,1,2\n'))).toEqual(['EUR']);
    expect(detectFileCurrencies(parseCsv('line,amount\nARR,£100\nCOGS,€5\n'))).toEqual(['GBP', 'EUR']);
    expect(detectFileCurrencies(parseCsv('line,amount\nRevenue,$100\nEBITDA,₹5\n'))).toEqual(['INR']);
    expect(detectFileCurrencies(parseCsv('line,amount\nRevenue,100\n'))).toEqual([]);
  });

  it('accepts a file in the pact currency, stated or not', () => {
    const csv = 'account,month,amount (JPY)\nRevenue,2025,1000000\n';
    expect(importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv), 'JPY')).toMatchObject({ readAs: 'JPY', problems: [], question: null });
    const plain = 'account,month,amount\nRevenue,2025,1000000\n';
    expect(importCurrencyCheck(FINANCIAL_PNL, parseCsv(plain), pnl(plain), 'EUR')).toMatchObject({ readAs: 'EUR', problems: [], detected: [] });
  });

  it('flags a mismatch with the pact and asks the reviewer', () => {
    const csv = 'account,month,amount (EUR)\nRevenue,2025,1000000\n';
    const check = importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv), 'USD');
    expect(check.problems).toEqual([
      'This file shows amounts in EUR, but this pact is in USD. Pactlab never converts amounts: import the figures in USD, or say the file is in USD if the label is wrong.',
    ]);
    expect(check.question).toBe('This file shows EUR; the pact is in USD. What currency are these amounts in?');
  });

  it('refuses a declared currency other than the pact’s', () => {
    const csv = 'account,month,amount\nRevenue,2025,1000000\n';
    const check = importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv, { currency: 'GBP' }), 'EUR');
    expect(check.problems[0]).toMatch(/^You said these amounts are in GBP, but this pact is in EUR/);
    expect(check.question).toBeNull();
  });

  it('lets a person settle a wrong label by declaring the pact’s currency', () => {
    const csv = 'account,month,amount (EUR)\nRevenue,2025,1000000\n';
    expect(importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv, { currency: 'USD' }), 'USD').problems).toEqual([]);
  });

  it('refuses a statement set that mixes currencies, with a clear reviewer message', () => {
    const csv = 'account,month,amount\nRevenue,2024,£1000\nRevenue,2025,€1200\n';
    const check = importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv, { currency: 'GBP' }), 'GBP');
    expect(check.problems).toEqual([
      'This file mixes amounts in GBP and EUR. One statement must be in one currency, and Pactlab never converts: import each currency’s figures as its own file, in GBP.'.replace('’', "'"),
    ]);
  });

  it('does not read a line name as the file’s currency', () => {
    const csv = 'account,month,amount (EUR)\nRevenue,2025,1000\nFX loss on USD loan,2025,10\n';
    expect(importCurrencyCheck(FINANCIAL_PNL, parseCsv(csv), pnl(csv), 'EUR')).toMatchObject({ detected: ['EUR'], problems: [] });
  });

  it('checks pack extracts the same way', () => {
    const csv = 'unit,monthly_rent_gbp\n101,1200\n';
    const mapping = { fields: {} } as Pick<ImportMapping, 'fields' | 'currency'>;
    expect(importCurrencyCheck(MULTIFAMILY_RENT_ROLL, parseCsv(csv.replace('_gbp', ' (GBP)')), mapping, 'USD').problems).toHaveLength(1);
  });

  it('leaves billing to its per-row currency column and recorded FX rates', () => {
    const csv = 'invoice,amount,currency\n1,100,EUR\n2,100,GBP\n';
    expect(importCurrencyCheck(BILLING_INVOICE_LINE, parseCsv(csv), { fields: {} }, 'USD').problems).toEqual([]);
  });

  it('stamps a declared currency on statement lines, and reads minor units with it', () => {
    const csv = 'account,month,amount\nRevenue,2025,150000\n';
    const result = applyMapping(parseCsv(csv), pnl(csv, { currency: 'JPY', amountUnit: 'MINOR' }), 'pnl.csv');
    expect(result.rows[0]?.canonical).toMatchObject({ amount: '150000', currency: 'JPY', line_kind: 'REVENUE' });
    const undeclared = applyMapping(parseCsv(csv), pnl(csv), 'pnl.csv');
    expect(undeclared.rows[0]?.canonical).not.toHaveProperty('currency');
  });
});
