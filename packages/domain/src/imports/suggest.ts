import type { CsvTable } from '../evidence/csv';
import type { FieldSource } from './mapping';
import type { TargetDefinition } from './targets';
import { DATE_FORMATS, parseDateValue, type DateFormat } from './transforms';

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Generic names seen across billing exports; a suggestion only — the user confirms every field. */
const GENERIC_ALIASES: Readonly<Record<string, readonly string[]>> = {
  line_id: ['lineid', 'lineitemid', 'id'],
  invoice_id: ['invoiceid', 'invoice', 'invoicenumber', 'documentnumber', 'billingdocument'],
  customer_id: ['customerid', 'customer', 'accountid', 'customernumber', 'soldtoparty'],
  customer_name: ['customername', 'accountname', 'name'],
  subscription_id: ['subscriptionid', 'subscription', 'contractid', 'contract'],
  price_id: ['priceid', 'productid', 'planid', 'item', 'material'],
  currency: ['currency', 'currencycode', 'documentcurrency'],
  amount: ['amount', 'netamount', 'lineamount', 'netvalue'],
  interval: ['interval', 'billinginterval', 'billingperiod', 'billingfrequency'],
  interval_count: ['intervalcount'],
  period_start: ['periodstart', 'servicestart', 'servicestartdate', 'startdate'],
  period_end: ['periodend', 'serviceend', 'serviceenddate', 'enddate'],
  invoice_status: ['invoicestatus', 'status'],
  created: ['created', 'invoicedate', 'date', 'billingdate', 'documentdate'],
};

/**
 * Suggest a source column for each field: template aliases first (verified
 * for that system), then generic names. Each column is used at most once.
 */
export function suggestFields(
  definition: TargetDefinition,
  header: readonly string[],
  templateAliases: Readonly<Partial<Record<string, readonly string[]>>> = {},
): Record<string, FieldSource> {
  const byNormalized = new Map(header.map((column) => [normalize(column), column]));
  const used = new Set<string>();
  const fields: Record<string, FieldSource> = {};
  for (const field of definition.fields) {
    const candidates = [...(templateAliases[field.name] ?? []), field.name, ...(GENERIC_ALIASES[field.name] ?? [])];
    const column = candidates.map((name) => byNormalized.get(normalize(name))).find((found) => found && !used.has(found));
    if (column) used.add(column);
    fields[field.name] = column ? { kind: 'column', column } : { kind: 'none' };
  }
  return fields;
}

/** The first date format that reads every sampled non-empty value, or null. */
export function detectDateFormat(table: CsvTable, column: string, sample = 50): DateFormat | null {
  const index = table.header.indexOf(column);
  if (index < 0) return null;
  const values = table.rows
    .slice(0, sample)
    .map((row) => (row.cells[index] ?? '').trim())
    .filter(Boolean);
  if (values.length === 0) return null;
  return DATE_FORMATS.find((format) => values.every((value) => parseDateValue(value, format) !== null)) ?? null;
}
