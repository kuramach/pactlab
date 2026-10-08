import { BILLING_INVOICE_LINE } from '@pactlab/domain';

/** Blank Pactlab standard billing template: one row per invoice line. */
export function GET(): Response {
  const header = BILLING_INVOICE_LINE.fields.map((field) => field.name).join(',');
  return new Response(`${header}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="pactlab-billing-template.csv"',
    },
  });
}
