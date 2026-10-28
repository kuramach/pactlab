import { z } from 'zod';
import { isoCurrencySchema } from './common';

export const BALANCE_SHEET_KINDS = ['CASH', 'DEBT', 'DEBT_LIKE'] as const;

/** Mirrors `BALANCE_SHEET_CATEGORIES` in `@pactlab/calculations` and the database CHECK. */
export const BALANCE_SHEET_CATEGORIES = {
  CASH: ['CASH'],
  DEBT: ['TERM_LOAN', 'REVOLVER', 'SHAREHOLDER_LOAN', 'CONVERTIBLE_NOTE', 'OTHER_DEBT'],
  DEBT_LIKE: ['DEFERRED_REVENUE', 'UNPAID_TAX', 'ACCRUED_BONUS', 'EARN_OUT', 'LEASE', 'CUSTOMER_PREPAYMENT', 'TRANSACTION_COSTS', 'OTHER_DEBT_LIKE'],
} as const;
const ALL_CATEGORIES = [...BALANCE_SHEET_CATEGORIES.CASH, ...BALANCE_SHEET_CATEGORIES.DEBT, ...BALANCE_SHEET_CATEGORIES.DEBT_LIKE] as const;

const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/** Money typed by people: thousands separators allowed; zero or more. */
const amount = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replaceAll(',', '') : value),
  z.string().regex(/^\d{1,18}(\.\d{1,4})?$/, 'An amount such as 120000 or 120,000'),
);

/** Where the figure comes from: a document page and the exact words on it. */
const source = {
  documentId: z.uuid(),
  pageNumber: z.coerce.number().int().min(1).max(100_000),
  quote: z.string().trim().min(12, 'Quote at least a few words from the page').max(600),
};

const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));

/** Loan terms, typed by people; debt items only. The rate is a percent ("7.5" = 7.5 % a year). */
export const loanTerms = {
  interestRatePercent: z.preprocess(blankToNull, z.string().trim().regex(/^\d{1,2}(\.\d{1,4})?$/, 'A yearly rate such as 7.5 (percent)').nullable().default(null)),
  rateType: z.preprocess(blankToNull, z.enum(['FIXED', 'FLOATING']).nullable().default(null)),
  rateReference: optionalText(120),
  maturityDate: z.preprocess(blankToNull, z.iso.date().nullable().default(null)),
  lender: optionalText(200),
  repayment: z.preprocess(blankToNull, z.enum(['AMORTIZING', 'BULLET', 'REVOLVING']).nullable().default(null)),
  covenantNote: optionalText(1000),
};
export const LOAN_TERM_FIELDS = Object.keys(loanTerms) as (keyof typeof loanTerms)[];
export const hasLoanTerms = (input: Partial<Record<keyof typeof loanTerms, unknown>>) => LOAN_TERM_FIELDS.some((field) => input[field] !== null && input[field] !== undefined);

const values = {
  category: z.enum(ALL_CATEGORIES),
  label: z.string().trim().min(1).max(200),
  amount,
  currency: isoCurrencySchema,
  asOf: z.iso.date(),
  ...source,
  note: z.preprocess(blankToNull, z.string().trim().max(1000).nullable().default(null)),
  ...loanTerms,
};

const categoryMatchesKind = (item: { kind: (typeof BALANCE_SHEET_KINDS)[number]; category: string }, ctx: z.RefinementCtx) => {
  if (!(BALANCE_SHEET_CATEGORIES[item.kind] as readonly string[]).includes(item.category)) {
    ctx.addIssue({ code: 'custom', path: ['category'], message: 'That category does not belong to this kind of item' });
  }
};

const termsOnlyOnDebt = (item: { kind: (typeof BALANCE_SHEET_KINDS)[number] } & Partial<Record<keyof typeof loanTerms, unknown>>, ctx: z.RefinementCtx) => {
  if (item.kind !== 'DEBT' && hasLoanTerms(item)) ctx.addIssue({ code: 'custom', path: ['interestRatePercent'], message: 'Loan terms apply to debt items only' });
};

export const balanceSheetItemInputSchema = z
  .strictObject({ kind: z.enum(BALANCE_SHEET_KINDS), ...values })
  .superRefine(categoryMatchesKind)
  .superRefine(termsOnlyOnDebt);
export type BalanceSheetItemInput = z.infer<typeof balanceSheetItemInputSchema>;

/** A revision keeps the kind; it needs the version it was based on and a reason. */
export const reviseBalanceSheetItemSchema = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3, 'Say why it changed').max(1000),
  ...values,
});
export type ReviseBalanceSheetItem = z.infer<typeof reviseBalanceSheetItemSchema>;

export const withdrawBalanceSheetItemSchema = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3, 'Say why it no longer applies').max(1000),
});
export type WithdrawBalanceSheetItem = z.infer<typeof withdrawBalanceSheetItemSchema>;

export const balanceSheetItemParamsSchema = z.strictObject({ dealId: z.uuid(), itemId: z.uuid() });

export interface BalanceSheetItemView {
  id: string;
  kind: (typeof BALANCE_SHEET_KINDS)[number];
  category: (typeof ALL_CATEGORIES)[number];
  label: string;
  amount: string;
  currency: string;
  asOf: string;
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string };
  /** False when the cited page changed or the document was purged. */
  citationValid: boolean;
  note: string | null;
  /** Debt items: loan terms as recorded (rate as a fraction, "0.075" = 7.5 %). */
  terms: {
    interestRate: string | null;
    rateType: 'FIXED' | 'FLOATING' | null;
    rateReference: string | null;
    maturityDate: string | null;
    lender: string | null;
    repayment: 'AMORTIZING' | 'BULLET' | 'REVOLVING' | null;
    covenantNote: string | null;
  };
  version: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  updatedBy: string;
  updatedByName: string | null;
  updatedAt: string;
  history: { version: number; amount: string; status: 'ACTIVE' | 'WITHDRAWN'; reason: string; changedByName: string | null; changedAt: string }[];
}

export interface BalanceSheetView {
  items: BalanceSheetItemView[];
  totals: { currency: string; cash: string; debt: string; debtLike: string } | null;
  canEdit: boolean;
  /** Documents that may be cited: not purged, and not people data. Files intake filed as balance sheets come first (T-098). */
  documents: { id: string; fileName: string; pageCount: number; category: string | null }[];
}

/** Read an uploaded balance sheet for proposals (T-094 B9). */
export const balanceSheetProposalParamsSchema = z.strictObject({ dealId: z.uuid(), documentId: z.uuid() });

/** A line a person may confirm into a balance-sheet item; nothing is recorded until they do. */
export interface BalanceSheetProposalView {
  kind: (typeof BALANCE_SHEET_KINDS)[number];
  category: (typeof ALL_CATEGORIES)[number];
  label: string;
  amount: string;
  currency: string | null;
  pageNumber: number;
  quote: string;
  lender: string | null;
}

export interface BalanceSheetProposalsView {
  documentId: string;
  /** The "as at" date the document states, if it states one. */
  asOf: string | null;
  proposals: BalanceSheetProposalView[];
  /** Lines already recorded as items, so they are not proposed twice. */
  alreadyRecorded: number;
}
