import type { ExpectedInputId } from '../intake/checklist';
import { formatScaled, parseAmount } from './decimal';

/**
 * Hand-sourced entries (T-178, Kumar 2026-11-26): when the data exists but no file does, the seller
 * enters it in a structured form and Rinse generates the file. The integrity rule: a hand-sourced entry
 * closes the completeness gap but is never documentary evidence. At injection it lands in the pact as a
 * seller claim, labelled hand-sourced wherever it is used.
 */
export const HAND_ENTRY_VERSION = 'hand-entry-1';

export type HandFieldKind = 'TEXT' | 'DATE' | 'AMOUNT' | 'COUNT' | 'PERCENT';

export interface HandField {
  readonly key: string;
  readonly label: string;
  readonly kind: HandFieldKind;
  readonly required: boolean;
}

export interface HandEntryForm {
  readonly id: HandEntryFormId;
  readonly label: string;
  /** The expected inputs a saved entry closes. */
  readonly covers: readonly ExpectedInputId[];
  /** The fields one row carries; a form with `rows` takes one or more rows. */
  readonly fields: readonly HandField[];
  readonly rows: boolean;
}

export const HAND_ENTRY_FORM_IDS = ['VACANCY_SCHEDULE', 'KEY_LEASE_TERMS', 'DEBT_SCHEDULE', 'ATTESTED_NOTE'] as const;
export type HandEntryFormId = (typeof HAND_ENTRY_FORM_IDS)[number];

const field = (key: string, label: string, kind: HandFieldKind, required = true): HandField => ({ key, label, kind, required });

export const HAND_ENTRY_FORMS: Readonly<Record<HandEntryFormId, HandEntryForm>> = {
  VACANCY_SCHEDULE: {
    id: 'VACANCY_SCHEDULE',
    label: 'Vacancy and occupancy schedule',
    covers: ['MULTIFAMILY_OCCUPANCY'],
    rows: true,
    fields: [field('period', 'Period (YYYY-MM)', 'TEXT'), field('unitType', 'Unit type', 'TEXT'), field('units', 'Units', 'COUNT'), field('occupiedUnits', 'Occupied units', 'COUNT'), field('averageRent', 'Average in-place rent', 'AMOUNT', false)],
  },
  KEY_LEASE_TERMS: {
    id: 'KEY_LEASE_TERMS',
    label: 'Key lease terms',
    covers: ['LEASE'],
    rows: false,
    fields: [field('premises', 'Premises', 'TEXT'), field('landlord', 'Landlord', 'TEXT'), field('tenant', 'Tenant', 'TEXT'), field('startsOn', 'Term starts', 'DATE'), field('endsOn', 'Term ends', 'DATE'), field('annualRent', 'Annual rent', 'AMOUNT'), field('renewalOption', 'Renewal option', 'TEXT', false), field('assignment', 'Assignment or change of control', 'TEXT', false)],
  },
  DEBT_SCHEDULE: {
    id: 'DEBT_SCHEDULE',
    label: 'Debt schedule',
    covers: ['LOAN_AGREEMENT'],
    rows: true,
    fields: [field('lender', 'Lender', 'TEXT'), field('facility', 'Facility', 'TEXT'), field('principal', 'Outstanding principal', 'AMOUNT'), field('rate', 'Interest rate (%)', 'PERCENT'), field('maturesOn', 'Matures', 'DATE')],
  },
  ATTESTED_NOTE: {
    id: 'ATTESTED_NOTE',
    label: 'Attested note',
    covers: [],
    rows: false,
    fields: [field('subject', 'What this note covers', 'TEXT'), field('statement', 'Statement', 'TEXT')],
  },
} satisfies Record<HandEntryFormId, HandEntryForm>;

/** The forms that can close a given expected input; the attested note always can. */
export function formsFor(input: ExpectedInputId): HandEntryForm[] {
  return HAND_ENTRY_FORM_IDS.map((id) => HAND_ENTRY_FORMS[id]).filter((form) => form.id === 'ATTESTED_NOTE' || form.covers.includes(input));
}

export type HandRow = Readonly<Record<string, string>>;

export interface HandFieldProblem {
  readonly row: number;
  readonly field: string;
  readonly problem: 'REQUIRED' | 'NOT_A_DATE' | 'NOT_AN_AMOUNT' | 'NOT_A_COUNT' | 'NOT_A_PERCENT' | 'TOO_LONG' | 'UNKNOWN_FIELD' | 'NO_ROWS';
}

const MAX_FIELD_CHARS = 500;
const MAX_ROWS = 500;

/** Check entered values against the form; values are kept as the person typed them, normalised only for numbers. */
export function validateHandEntry(formId: HandEntryFormId, rows: readonly HandRow[]): { readonly rows: HandRow[]; readonly problems: HandFieldProblem[] } {
  const form = HAND_ENTRY_FORMS[formId];
  const problems: HandFieldProblem[] = [];
  if (rows.length === 0 || rows.length > MAX_ROWS || (!form.rows && rows.length > 1)) problems.push({ row: 0, field: '', problem: 'NO_ROWS' });
  const keys = new Set(form.fields.map((entry) => entry.key));
  const clean = rows.map((row, index) => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(row)) if (!keys.has(key)) problems.push({ row: index + 1, field: key, problem: 'UNKNOWN_FIELD' });
    for (const entry of form.fields) {
      const value = (row[entry.key] ?? '').trim();
      if (!value) {
        if (entry.required) problems.push({ row: index + 1, field: entry.key, problem: 'REQUIRED' });
        continue;
      }
      if (value.length > MAX_FIELD_CHARS) problems.push({ row: index + 1, field: entry.key, problem: 'TOO_LONG' });
      if (entry.kind === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) problems.push({ row: index + 1, field: entry.key, problem: 'NOT_A_DATE' });
      if (entry.kind === 'AMOUNT' || entry.kind === 'PERCENT') {
        const amount = parseAmount(value);
        if (amount === null) problems.push({ row: index + 1, field: entry.key, problem: entry.kind === 'AMOUNT' ? 'NOT_AN_AMOUNT' : 'NOT_A_PERCENT' });
        else {
          out[entry.key] = formatScaled(amount);
          continue;
        }
      }
      if (entry.kind === 'COUNT' && !/^\d+$/.test(value.replace(/,/g, ''))) problems.push({ row: index + 1, field: entry.key, problem: 'NOT_A_COUNT' });
      out[entry.key] = entry.kind === 'COUNT' ? value.replace(/,/g, '') : value;
    }
    return out;
  });
  return { rows: clean, problems };
}

export interface Enterer {
  readonly userId: string;
  readonly name: string;
  readonly organization: string;
}

/** The stamp every generated hand-sourced document carries, on every page. */
export function handSourcedStamp(enterer: Enterer, enteredAt: string): string {
  return `Hand-sourced — entered by ${enterer.name}, ${enterer.organization} on ${enteredAt.slice(0, 10)}`;
}

/**
 * The canonical document generated from an entry: its stamp, a title, then one "Label: value" line per
 * field (one block per row). The same lines are drawn into the PDF, so the deterministic reader reads the
 * generated file back to exactly the values entered.
 */
export function renderHandEntry(formId: HandEntryFormId, rows: readonly HandRow[], enterer: Enterer, enteredAt: string, currency: string): string[] {
  const form = HAND_ENTRY_FORMS[formId];
  const lines = [handSourcedStamp(enterer, enteredAt), form.label, 'This document was generated by Pactlab Rinse from values entered by hand. It is a seller claim, not documentary evidence.', ''];
  rows.forEach((row, index) => {
    if (form.rows) lines.push(`Row ${index + 1}`);
    for (const entry of form.fields) {
      const value = row[entry.key];
      if (value === undefined) continue;
      lines.push(`${entry.label}: ${entry.kind === 'AMOUNT' ? `${currency} ${value}` : entry.kind === 'PERCENT' ? `${value}%` : value}`);
    }
    lines.push('');
  });
  return lines;
}
