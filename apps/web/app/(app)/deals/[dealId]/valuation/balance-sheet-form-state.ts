/** What the balance-sheet item form shows after a refused save: the typed values and one clear error. */
export interface ItemFormState {
  readonly values: Readonly<Record<string, string>> | null;
  readonly error: { readonly field: string | null; readonly message: string } | null;
}

export const EMPTY_ITEM_FORM: ItemFormState = { values: null, error: null };

/** Field-level messages for schema refusals (the first failing field). */
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  kind: 'Choose whether this is cash, debt or debt-like.',
  category: 'That category does not belong to the kind of item — pick one listed under it.',
  label: 'Give the item a short label, e.g. “Term loan — Lakeside Bank”.',
  amount: 'Enter the amount as a number, e.g. 450000 or 450,000.00.',
  currency: 'Enter a three-letter currency code, e.g. USD.',
  asOf: 'Enter the balance-sheet date the figure is from.',
  documentId: 'Choose the document the figure comes from.',
  pageNumber: 'Enter the page number (1 or more).',
  quote: 'Quote at least 12 characters, exactly as they appear on the page — use “Show page text” to pick them.',
  note: 'Keep the note under 1,000 characters.',
  reason: 'Say why it changed, in a few words.',
  expectedVersion: 'The item changed while you were editing — reload the page and try again.',
};

/** API refusal codes (the citation check and business rules). */
const CODE_MESSAGES: Readonly<Record<string, { field: string | null; message: string }>> = {
  QUOTE_NOT_FOUND: { field: 'quote', message: 'Those exact words are not on that page. Use “Show page text” and pick the line, or check the page number.' },
  QUOTE_TOO_SHORT: { field: 'quote', message: 'Quote at least a few words (12 characters or more) so the citation is unambiguous.' },
  INJECTION_SPAN: { field: 'quote', message: 'That passage looks like instructions embedded in the document and cannot be cited. Quote the figure itself.' },
  UNKNOWN_SOURCE: { field: 'documentId', message: 'That document page is not available. Choose another document or page.' },
  PAGE_UNAVAILABLE: { field: 'pageNumber', message: 'That page is not available (no readable text, purged, or beyond the last page).' },
  PEOPLE_DATA: { field: 'documentId', message: 'That document holds people data and cannot be cited for balance-sheet items.' },
  CATEGORY_KIND: { field: 'category', message: 'That category does not belong to the kind of item.' },
};

const RESULT_MESSAGES: Readonly<Record<string, string>> = {
  forbidden: 'Your role cannot record balance-sheet items on this deal.',
  conflict: 'The item changed or was withdrawn in the meantime — reload the page.',
  'signed-out': 'Your session ended. Sign in again; your entry is kept below.',
};

export function itemError(values: Record<string, string>, refusal: { field?: string; result?: string; code?: string }): ItemFormState {
  if (refusal.field) return { values, error: { field: refusal.field, message: FIELD_MESSAGES[refusal.field] ?? 'Check the highlighted field.' } };
  if (refusal.code && CODE_MESSAGES[refusal.code]) return { values, error: CODE_MESSAGES[refusal.code] ?? null };
  return { values, error: { field: null, message: RESULT_MESSAGES[refusal.result ?? ''] ?? 'The item could not be saved. Nothing was recorded — try again.' } };
}

/** "450,000" or "1 234 567.50" → "450000" / "1234567.50"; anything else is passed through for the schema to judge. */
export function normalizeAmount(raw: string): string {
  const trimmed = raw.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) return trimmed.replaceAll(',', '');
  if (/^-?\d{1,3}( \d{3})+(\.\d+)?$/.test(trimmed)) return trimmed.replaceAll(' ', '');
  return trimmed;
}

export const KIND_LABELS = { CASH: 'Cash', DEBT: 'Debt', DEBT_LIKE: 'Debt-like' } as const;

export const CATEGORY_LABELS: Record<string, string> = {
  CASH: 'Cash',
  TERM_LOAN: 'Term loan',
  REVOLVER: 'Revolving credit',
  SHAREHOLDER_LOAN: 'Shareholder loan',
  CONVERTIBLE_NOTE: 'Convertible note',
  OTHER_DEBT: 'Other debt',
  DEFERRED_REVENUE: 'Deferred revenue',
  UNPAID_TAX: 'Unpaid tax',
  ACCRUED_BONUS: 'Accrued bonuses',
  EARN_OUT: 'Earn-out from past acquisitions',
  LEASE: 'Leases',
  CUSTOMER_PREPAYMENT: 'Customer prepayments',
  TRANSACTION_COSTS: 'Seller’s transaction costs',
  OTHER_DEBT_LIKE: 'Other debt-like item',
};
