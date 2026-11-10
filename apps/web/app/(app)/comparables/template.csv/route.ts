import { comparableTemplateCsv } from '@pactlab/contracts';

/** The batch template (T-111): one column per field of the single-entry form, with an example row. */
export function GET(): Response {
  return new Response(comparableTemplateCsv(), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="pactlab-comparables-template.csv"' },
  });
}
