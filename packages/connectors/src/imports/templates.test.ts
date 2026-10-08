import { applyMapping, BILLING_INVOICE_LINE, BILLING_SYSTEMS, parseCsv, suggestFields } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { INVOICE_LINE_COLUMNS } from '../stripe/invoice-line';
import { BILLING_TEMPLATES, standardTemplateCsv } from './templates';

describe('billing templates', () => {
  it('covers every billing system and only claims verification with a source', () => {
    expect(Object.keys(BILLING_TEMPLATES).sort()).toEqual([...BILLING_SYSTEMS].sort());
    for (const template of Object.values(BILLING_TEMPLATES)) {
      expect(template.verified).toBe(template.verifiedFrom.length > 0);
      if (!template.verified) expect(template.aliases).toEqual({});
    }
  });

  it('keeps the standard template identical to the invoice-line columns the engine reads', () => {
    expect(BILLING_INVOICE_LINE.fields.map((field) => field.name)).toEqual([...INVOICE_LINE_COLUMNS]);
    expect(standardTemplateCsv().trim().split(',')).toEqual([...INVOICE_LINE_COLUMNS]);
  });

  it('maps a Stripe invoice_line_items export with minor-unit amounts', () => {
    const csv = `id,invoice_id,customer_id,currency,amount,period_start,period_end,status,created
il_1,in_1,cus_1,usd,340000,2025-07-01,2025-08-01,paid,2025-07-01
`;
    const table = parseCsv(csv);
    const template = BILLING_TEMPLATES.stripe;
    const result = applyMapping(
      table,
      {
        target: 'BILLING_INVOICE_LINE',
        fields: { ...suggestFields(BILLING_INVOICE_LINE, table.header, template.aliases), interval: { kind: 'constant', value: 'month' } },
        dateFormat: template.defaults.dateFormat ?? 'YYYY-MM-DD',
        numberFormat: template.defaults.numberFormat ?? 'DOT_DECIMAL',
        amountUnit: template.defaults.amountUnit ?? 'MAJOR',
        negateAmounts: false,
      },
      'uploads/x/stripe.csv',
    );
    expect(result.issues).toEqual([]);
    expect(result.rows[0]!.canonical).toMatchObject({
      line_id: 'il_1',
      customer_id: 'cus_1',
      currency: 'USD',
      amount: '3400',
      invoice_status: 'paid',
      created: '2025-07-01',
    });
  });
});
