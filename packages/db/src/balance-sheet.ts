import type { Prisma, TransactionClient } from './client';

export type BalanceSheetKindValue = 'CASH' | 'DEBT' | 'DEBT_LIKE';

/** A citation the server verified against stored page text. */
export interface ItemCitation {
  documentId: string;
  pageNumber: number;
  quote: string;
  quoteHash: string;
  charStart: number;
  charEnd: number;
}

/** Loan terms recorded on a debt item (T-078). Decimal strings and ISO dates only. */
export interface LoanTerms {
  /** Fraction as a decimal string: "0.075" is 7.5 %. */
  interestRate: string | null;
  rateType: 'FIXED' | 'FLOATING' | null;
  rateReference: string | null;
  /** `YYYY-MM-DD`. */
  maturityDate: string | null;
  lender: string | null;
  repayment: 'AMORTIZING' | 'BULLET' | 'REVOLVING' | null;
  covenantNote: string | null;
}

export const NO_TERMS: LoanTerms = { interestRate: null, rateType: null, rateReference: null, maturityDate: null, lender: null, repayment: null, covenantNote: null };

export interface BalanceSheetItemValues {
  kind: BalanceSheetKindValue;
  category: string;
  label: string;
  /** Decimal string; never a JavaScript number. */
  amount: string;
  currency: string;
  /** `YYYY-MM-DD`. */
  asOf: string;
  citation: ItemCitation;
  note: string | null;
  /** Debt items only; all null otherwise. */
  terms: LoanTerms;
}

export interface BalanceSheetItemRecord extends BalanceSheetItemValues {
  id: string;
  dealId: string;
  version: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
}

export interface BalanceSheetItemVersionRecord extends BalanceSheetItemValues {
  itemId: string;
  version: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  reason: string;
  changedBy: string;
  changedAt: Date;
}

type DecimalLike = { toFixed(): string };
type TermColumns = {
  interestRate: DecimalLike | null;
  rateType: string | null;
  rateReference: string | null;
  maturityDate: Date | null;
  lender: string | null;
  repayment: string | null;
  covenantNote: string | null;
};
type Row = Omit<BalanceSheetItemRecord, 'amount' | 'asOf' | 'citation' | 'terms'> & { amount: DecimalLike; asOf: Date; citation: unknown } & TermColumns;
type VersionRow = Omit<BalanceSheetItemVersionRecord, 'amount' | 'asOf' | 'citation' | 'terms'> & { amount: DecimalLike; asOf: Date; citation: unknown } & TermColumns;

const day = (value: Date) => value.toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00Z`);

function termsOf(row: TermColumns): LoanTerms {
  return {
    interestRate: row.interestRate?.toFixed() ?? null,
    rateType: (row.rateType as LoanTerms['rateType']) ?? null,
    rateReference: row.rateReference,
    maturityDate: row.maturityDate ? day(row.maturityDate) : null,
    lender: row.lender,
    repayment: (row.repayment as LoanTerms['repayment']) ?? null,
    covenantNote: row.covenantNote,
  };
}

function withoutTermColumns<T extends TermColumns>(row: T): Omit<T, keyof TermColumns> {
  const { interestRate: _r, rateType: _t, rateReference: _f, maturityDate: _m, lender: _l, repayment: _p, covenantNote: _c, ...rest } = row;
  return rest;
}

/** Term columns to write: a debt item's terms, nulls for anything else. */
function termColumns(kind: BalanceSheetKindValue, terms: LoanTerms) {
  const value = kind === 'DEBT' ? terms : NO_TERMS;
  return { ...value, maturityDate: value.maturityDate ? date(value.maturityDate) : null };
}

function toRecord(row: Row): BalanceSheetItemRecord {
  return { ...withoutTermColumns(row), amount: row.amount.toFixed(), asOf: day(row.asOf), citation: row.citation as ItemCitation, terms: termsOf(row) };
}

function toVersion(row: VersionRow): BalanceSheetItemVersionRecord {
  return { ...withoutTermColumns(row), amount: row.amount.toFixed(), asOf: day(row.asOf), citation: row.citation as ItemCitation, terms: termsOf(row) };
}

const termSelect = { interestRate: true, rateType: true, rateReference: true, maturityDate: true, lender: true, repayment: true, covenantNote: true } as const;

const select = {
  id: true,
  dealId: true,
  kind: true,
  category: true,
  label: true,
  amount: true,
  currency: true,
  asOf: true,
  citation: true,
  note: true,
  ...termSelect,
  version: true,
  status: true,
  createdBy: true,
  createdAt: true,
  updatedBy: true,
  updatedAt: true,
} as const;

const versionSelect = {
  itemId: true,
  version: true,
  kind: true,
  category: true,
  label: true,
  amount: true,
  currency: true,
  asOf: true,
  citation: true,
  note: true,
  ...termSelect,
  status: true,
  reason: true,
  changedBy: true,
  changedAt: true,
} as const;

async function recordVersion(
  tx: TransactionClient,
  item: BalanceSheetItemRecord & { organizationId: string },
  reason: string,
  changedBy: string,
) {
  await tx.balanceSheetItemVersion.create({
    data: {
      organizationId: item.organizationId,
      dealId: item.dealId,
      itemId: item.id,
      version: item.version,
      kind: item.kind,
      category: item.category,
      label: item.label,
      amount: item.amount,
      currency: item.currency,
      asOf: date(item.asOf),
      citation: item.citation as unknown as Prisma.InputJsonValue,
      note: item.note,
      ...termColumns(item.kind, item.terms),
      status: item.status,
      reason,
      changedBy,
    },
  });
}

/**
 * Cash, debt and debt-like items for a deal. Each change bumps the version
 * and appends to the history in the same transaction; nothing is deleted.
 * RLS keeps them on the buyer side.
 */
export const balanceSheetItems = {
  async list(tx: TransactionClient, dealId: string, filter: { includeWithdrawn?: boolean } = {}): Promise<BalanceSheetItemRecord[]> {
    const rows = await tx.balanceSheetItem.findMany({
      where: { dealId, ...(filter.includeWithdrawn ? {} : { status: 'ACTIVE' }) },
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return (rows as unknown as Row[]).map(toRecord);
  },

  async get(tx: TransactionClient, dealId: string, id: string): Promise<BalanceSheetItemRecord | null> {
    const row = await tx.balanceSheetItem.findFirst({ where: { id, dealId }, select });
    return row ? toRecord(row as unknown as Row) : null;
  },

  async history(tx: TransactionClient, dealId: string): Promise<BalanceSheetItemVersionRecord[]> {
    const rows = await tx.balanceSheetItemVersion.findMany({
      where: { dealId },
      select: versionSelect,
      orderBy: [{ itemId: 'asc' }, { version: 'desc' }],
    });
    return (rows as unknown as VersionRow[]).map(toVersion);
  },

  async create(
    tx: TransactionClient,
    input: BalanceSheetItemValues & { organizationId: string; dealId: string; createdBy: string; reason: string },
  ): Promise<BalanceSheetItemRecord> {
    const row = await tx.balanceSheetItem.create({
      data: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        kind: input.kind,
        category: input.category,
        label: input.label,
        amount: input.amount,
        currency: input.currency,
        asOf: date(input.asOf),
        citation: input.citation as unknown as Prisma.InputJsonValue,
        note: input.note,
        ...termColumns(input.kind, input.terms),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
      select,
    });
    const record = toRecord(row as unknown as Row);
    await recordVersion(tx, { ...record, organizationId: input.organizationId }, input.reason, input.createdBy);
    return record;
  },

  /**
   * Revise an active item at `expectedVersion`; null when it changed in the
   * meantime, was withdrawn, or is not visible.
   */
  async revise(
    tx: TransactionClient,
    input: Omit<BalanceSheetItemValues, 'kind'> & {
      /** The item's kind decides whether terms are kept. */
      kind: BalanceSheetKindValue;
      organizationId: string;
      dealId: string;
      id: string;
      expectedVersion: number;
      updatedBy: string;
      reason: string;
    },
  ): Promise<BalanceSheetItemRecord | null> {
    const { count } = await tx.balanceSheetItem.updateMany({
      where: { id: input.id, dealId: input.dealId, version: input.expectedVersion, status: 'ACTIVE' },
      data: {
        category: input.category,
        label: input.label,
        amount: input.amount,
        currency: input.currency,
        asOf: date(input.asOf),
        citation: input.citation as unknown as Prisma.InputJsonValue,
        note: input.note,
        ...termColumns(input.kind, input.terms),
        version: input.expectedVersion + 1,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    });
    if (count !== 1) return null;
    const record = (await balanceSheetItems.get(tx, input.dealId, input.id)) as BalanceSheetItemRecord;
    await recordVersion(tx, { ...record, organizationId: input.organizationId }, input.reason, input.updatedBy);
    return record;
  },

  async withdraw(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; id: string; expectedVersion: number; updatedBy: string; reason: string },
  ): Promise<BalanceSheetItemRecord | null> {
    const { count } = await tx.balanceSheetItem.updateMany({
      where: { id: input.id, dealId: input.dealId, version: input.expectedVersion, status: 'ACTIVE' },
      data: { status: 'WITHDRAWN', version: input.expectedVersion + 1, updatedBy: input.updatedBy, updatedAt: new Date() },
    });
    if (count !== 1) return null;
    const record = (await balanceSheetItems.get(tx, input.dealId, input.id)) as BalanceSheetItemRecord;
    await recordVersion(tx, { ...record, organizationId: input.organizationId }, input.reason, input.updatedBy);
    return record;
  },
};
