import { IMPORT_TARGET_DEFINITIONS } from '../imports/targets';
import type { ImportTarget } from '../imports/targets';
import type { PackDefinition } from '../packs/registry';

/**
 * Document intake (T-098, ADR 0016). Every file that arrives — uploaded one
 * by one, unpacked from a zip, or read from a connected data room — is read
 * by the AI and filed under one category. The category decides where the
 * file goes next. A person is asked only when the AI is unsure.
 */

/** What happens to a file once its category is settled. */
export type IntakeRoute =
  /** Structured rows: the pack's import mapping for this target (ADR 0010). */
  | { readonly kind: 'IMPORT'; readonly target: ImportTarget }
  /** The T-094 B9 balance-sheet reader: debt and cash lines, confirmed before the bridge. */
  | { readonly kind: 'BALANCE_SHEET' }
  /** Contract extraction into DRAFT findings for review. */
  | { readonly kind: 'EXTRACT' }
  /** Kept and listed under its category; nothing is extracted from it yet. */
  | { readonly kind: 'FILE' };

/** Categories for documents that are not one of the import targets. */
export const DOCUMENT_CATEGORIES = [
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'CASH_FLOW_STATEMENT',
  'CUSTOMER_CONTRACT',
  'SUPPLIER_CONTRACT',
  'LEASE',
  'LOAN_AGREEMENT',
  'CORPORATE_RECORD',
  'POLICY',
  'PEOPLE_RECORD',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** A file's category: a document category or one of the import targets. */
export type IntakeCategory = DocumentCategory | ImportTarget;

export interface CategoryDefinition {
  readonly id: IntakeCategory;
  readonly label: string;
  /** What the AI is told the category means. */
  readonly description: string;
  readonly route: IntakeRoute;
  /**
   * Named people data (rule 7). A file filed here is excluded from any
   * further AI processing, whatever its upload classification said.
   */
  readonly people: boolean;
}

const DOCUMENT_DEFINITIONS: Readonly<Record<DocumentCategory, CategoryDefinition>> = {
  BALANCE_SHEET: {
    id: 'BALANCE_SHEET',
    label: 'Balance sheet',
    description: 'Statement of financial position: assets, liabilities and equity at a date, including debt and cash.',
    route: { kind: 'BALANCE_SHEET' },
    people: false,
  },
  INCOME_STATEMENT: {
    id: 'INCOME_STATEMENT',
    label: 'Income statement (P&L)',
    description: 'Profit and loss, income statement or management accounts: revenue, costs and profit over a period.',
    route: { kind: 'FILE' },
    people: false,
  },
  CASH_FLOW_STATEMENT: {
    id: 'CASH_FLOW_STATEMENT',
    label: 'Cash flow statement',
    description: 'Cash flows from operating, investing and financing activities over a period.',
    route: { kind: 'FILE' },
    people: false,
  },
  CUSTOMER_CONTRACT: {
    id: 'CUSTOMER_CONTRACT',
    label: 'Customer contract',
    description: 'An agreement under which a customer buys from the company: MSA, subscription, order form, SOW, statement of work.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  SUPPLIER_CONTRACT: {
    id: 'SUPPLIER_CONTRACT',
    label: 'Supplier contract',
    description: 'An agreement under which the company buys from a supplier, vendor, reseller or partner.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  LEASE: {
    id: 'LEASE',
    label: 'Lease',
    description: 'A real-estate or equipment lease, as landlord or tenant, or a lease abstract.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  LOAN_AGREEMENT: {
    id: 'LOAN_AGREEMENT',
    label: 'Loan agreement',
    description: 'Credit facility, loan, note or security agreement, including covenants.',
    route: { kind: 'EXTRACT' },
    people: false,
  },
  CORPORATE_RECORD: {
    id: 'CORPORATE_RECORD',
    label: 'Corporate record',
    description: 'Certificate of incorporation, bylaws, board minutes, resolutions, shareholder agreements.',
    route: { kind: 'FILE' },
    people: false,
  },
  POLICY: {
    id: 'POLICY',
    label: 'Policy',
    description: 'Internal policy or procedure: security, privacy, compliance, insurance certificates.',
    route: { kind: 'FILE' },
    people: false,
  },
  PEOPLE_RECORD: {
    id: 'PEOPLE_RECORD',
    label: 'People record',
    description: 'Named people data: org chart, employee list, payroll, employment or compensation agreements.',
    route: { kind: 'FILE' },
    people: true,
  },
  OTHER: {
    id: 'OTHER',
    label: 'Other',
    description: 'None of the other categories.',
    route: { kind: 'FILE' },
    people: false,
  },
};

const IMPORT_DESCRIPTIONS: Partial<Record<ImportTarget, string>> = {
  BILLING_INVOICE_LINE: 'A billing or invoicing export: one row per invoice line with customer, amount and dates.',
  MULTIFAMILY_RENT_ROLL: 'Residential rent roll: one row per unit with tenant, rent and lease dates.',
  CRE_RENT_ROLL: 'Commercial rent roll: one row per tenant or suite with area, rent and lease expiry.',
  MULTIFAMILY_T12: 'Trailing-twelve-month operating statement for a residential property, month by month.',
};

function importDefinition(target: ImportTarget): CategoryDefinition {
  const definition = IMPORT_TARGET_DEFINITIONS[target];
  return {
    id: target,
    label: definition.label,
    description:
      IMPORT_DESCRIPTIONS[target] ??
      `A ${definition.label.toLowerCase()} export (spreadsheet or CSV) with columns such as ${definition.fields
        .slice(0, 4)
        .map((field) => field.label)
        .join(', ')}.`,
    route: { kind: 'IMPORT', target },
    // Import targets carry their own people-data handling (aggregate or pseudonymous rows).
    people: false,
  };
}

export function categoryDefinition(id: IntakeCategory): CategoryDefinition {
  return (DOCUMENT_DEFINITIONS as Record<string, CategoryDefinition>)[id] ?? importDefinition(id as ImportTarget);
}

/** The categories offered for a pact: the document categories plus the pack's import targets. */
export function categoriesForPack(pack: PackDefinition): readonly CategoryDefinition[] {
  return [
    ...pack.importTargets.map(importDefinition),
    ...DOCUMENT_CATEGORIES.map((id) => DOCUMENT_DEFINITIONS[id]),
  ];
}

export function isIntakeCategory(pack: PackDefinition, value: string): value is IntakeCategory {
  return categoriesForPack(pack).some((category) => category.id === value);
}
