import type { BalanceSheetCategory, BalanceSheetKind } from './types';

/**
 * Proposes debt, cash and debt-like items from a balance sheet's page text
 * (T-094 B9). Deterministic: one labelled amount per line, classified by
 * the words in its label. Assets that are not cash (receivables, loans the
 * company has made) and contra lines (allowances) are never proposed.
 * Proposals are only suggestions — a person confirms each one before it is
 * recorded, and only recorded items reach the valuation bridge.
 */
export interface BalanceSheetProposal {
  kind: BalanceSheetKind;
  category: BalanceSheetCategory;
  label: string;
  /** Plain decimal string, no separators. */
  amount: string;
  /** ISO currency when the line names one. */
  currency: string | null;
  pageNumber: number;
  /** The whole line, quoted exactly as it appears on the page. */
  quote: string;
  lender: string | null;
}

const RULES: readonly { test: RegExp; kind: BalanceSheetKind; category: BalanceSheetCategory }[] = [
  { test: /\bcash\b/i, kind: 'CASH', category: 'CASH' },
  { test: /\bconvertible\b/i, kind: 'DEBT', category: 'CONVERTIBLE_NOTE' },
  { test: /\bshareholder (loan|note)/i, kind: 'DEBT', category: 'SHAREHOLDER_LOAN' },
  { test: /\b(revolv\w*|credit facility|overdraft)\b/i, kind: 'DEBT', category: 'REVOLVER' },
  { test: /\bterm loan\b/i, kind: 'DEBT', category: 'TERM_LOAN' },
  { test: /\b(loans?|borrowings?|debt|notes payable|bonds?)\b/i, kind: 'DEBT', category: 'OTHER_DEBT' },
  { test: /\bdeferred revenue|unearned revenue|contract liabilit/i, kind: 'DEBT_LIKE', category: 'DEFERRED_REVENUE' },
  { test: /\b(income )?tax(es)? (payable|owed|due)|unpaid tax/i, kind: 'DEBT_LIKE', category: 'UNPAID_TAX' },
  { test: /\bbonus/i, kind: 'DEBT_LIKE', category: 'ACCRUED_BONUS' },
  { test: /\bearn-?out\b/i, kind: 'DEBT_LIKE', category: 'EARN_OUT' },
  { test: /\blease liabilit/i, kind: 'DEBT_LIKE', category: 'LEASE' },
  { test: /\bcustomer (prepayments?|deposits?|advances?)\b/i, kind: 'DEBT_LIKE', category: 'CUSTOMER_PREPAYMENT' },
  { test: /\btransaction (costs?|fees?)\b/i, kind: 'DEBT_LIKE', category: 'TRANSACTION_COSTS' },
];

/** Lines that look like the above but are assets or contra accounts. */
const NOT_A_LIABILITY = /\b(receivables?|allowance|provision for (credit|loan) loss|prepaid expenses?)\b/i;

/** "Label: USD 1,234,567.00" or "Label ...... 1,234,567" (amount at the end). */
const LINE = /^\s*(?<label>[A-Za-z][^:\n]{2,160}?)\s*(?::|\.{2,}|\s{2,}|\t)\s*(?<currency>[A-Z]{3})?\s*(?<amount>\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|\d+(?:\.\d{1,4})?)\b(?<rest>.*)$/;

export function proposeBalanceSheetItems(pages: readonly { pageNumber: number; text: string }[]): BalanceSheetProposal[] {
  const proposals: BalanceSheetProposal[] = [];
  for (const page of pages) {
    for (const raw of page.text.split('\n')) {
      const line = raw.trim();
      if (line.length < 12) continue;
      const match = LINE.exec(line);
      if (!match?.groups) continue;
      const label = (match.groups['label'] ?? '').trim();
      if (NOT_A_LIABILITY.test(label)) continue;
      const rule = RULES.find((entry) => entry.test.test(label));
      if (!rule) continue;
      const amount = (match.groups['amount'] ?? '').replaceAll(',', '');
      if (!/[1-9]/.test(amount)) continue;
      proposals.push({
        kind: rule.kind,
        category: rule.category,
        label: label.replace(/,\s*outstanding principal$/i, ''),
        amount,
        currency: match.groups['currency'] ?? null,
        pageNumber: page.pageNumber,
        quote: line,
        lender: rule.kind === 'DEBT' ? (/\b(?:with|from)\s+([A-Z][\w&.' -]{2,80}?)(?:,|$)/.exec(label)?.[1]?.trim() ?? null) : null,
      });
    }
  }
  return proposals;
}

/** The "as at" date a balance sheet states on its first page, if any (e.g. "at 30 September 2026"). */
export function balanceSheetDate(text: string): string | null {
  const match = /\b(?:at|as of|as at)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i.exec(text);
  if (!match) return null;
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf((match[2] ?? '').toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}
