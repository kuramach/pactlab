import type { CompanyType } from '@pactlab/domain';
import type { TransactionClient } from './client';

export type ComparableKindValue = 'PRECEDENT_TRANSACTION' | 'PUBLIC_PEER' | 'OWN_DEAL';
export type ComparableOriginValue = 'OWN_DEAL' | 'ENTERED' | 'PROVIDER' | 'SYNTHETIC';
/** Same `company_type` enum as the seller's pack (ADR 0009). */
export type ComparableCompanyType = CompanyType;
export type MultipleVerdictValue = 'IN_RANGE' | 'HIGH' | 'LOW';

export interface ComparableInput {
  kind: ComparableKindValue;
  origin: ComparableOriginValue;
  name: string;
  targetName: string;
  acquirerName: string | null;
  /** `YYYY-MM-DD`. */
  announcedOn: string | null;
  companyType: ComparableCompanyType;
  region: string | null;
  /** Decimal strings; never JavaScript numbers. */
  enterpriseValue: string;
  arr: string;
  /** `REVENUE` when the disclosed figure is total revenue rather than ARR. Defaults to ARR. */
  arrBasis?: 'ARR' | 'REVENUE';
  currency: string;
  /** Fractions (`'0.25'` = 25%). */
  arrGrowth: string | null;
  nrr: string | null;
  grr: string | null;
  sourceCitation: string | null;
  sourceUrl: string | null;
  provider: string | null;
  providerVersion: string | null;
  sourceDealId: string | null;
}

export interface ComparableRecord extends ComparableInput {
  id: string;
  arrBasis: 'ARR' | 'REVENUE';
  status: 'ACTIVE' | 'RETIRED';
  recordedBy: string;
  recordedAt: Date;
  retiredBy: string | null;
  retiredAt: Date | null;
}

export interface MultipleJudgementRecord {
  id: string;
  dealId: string;
  verdict: MultipleVerdictValue;
  rationale: string;
  askingVersion: number | null;
  askingMultiple: string | null;
  benchmarkVersion: string;
  comparableSetHash: string;
  comparableCount: number;
  decidedBy: string;
  decidedAt: Date;
}

type DecimalLike = { toFixed(places?: number): string };
const fixed = (value: DecimalLike | null) => value?.toFixed() ?? null;
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

type ComparableRow = Omit<ComparableRecord, 'enterpriseValue' | 'arr' | 'arrGrowth' | 'nrr' | 'grr' | 'announcedOn'> & {
  organizationId: string;
  enterpriseValue: DecimalLike;
  arr: DecimalLike;
  arrGrowth: DecimalLike | null;
  nrr: DecimalLike | null;
  grr: DecimalLike | null;
  announcedOn: Date | null;
};

function toComparable({ organizationId: _org, ...row }: ComparableRow): ComparableRecord {
  return {
    ...row,
    announcedOn: day(row.announcedOn),
    enterpriseValue: row.enterpriseValue.toFixed(),
    arr: row.arr.toFixed(),
    arrGrowth: fixed(row.arrGrowth),
    nrr: fixed(row.nrr),
    grr: fixed(row.grr),
  };
}

type JudgementRow = Omit<MultipleJudgementRecord, 'askingMultiple'> & { organizationId: string; askingMultiple: DecimalLike | null };

function toJudgement({ organizationId: _org, ...row }: JudgementRow): MultipleJudgementRecord {
  return { ...row, askingMultiple: row.askingMultiple?.toFixed(2) ?? null };
}

/** Comparables, oldest first within the organization. RLS keeps them on the buy side. */
export const comparables = {
  async list(tx: TransactionClient, filter: { includeRetired?: boolean } = {}): Promise<ComparableRecord[]> {
    const rows = await tx.comparable.findMany({
      where: filter.includeRetired ? {} : { status: 'ACTIVE' },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return (rows as unknown as ComparableRow[]).map(toComparable);
  },

  async get(tx: TransactionClient, id: string): Promise<ComparableRecord | null> {
    const row = await tx.comparable.findFirst({ where: { id } });
    return row ? toComparable(row as unknown as ComparableRow) : null;
  },

  async forDeal(tx: TransactionClient, dealId: string): Promise<ComparableRecord | null> {
    const row = await tx.comparable.findFirst({ where: { sourceDealId: dealId } });
    return row ? toComparable(row as unknown as ComparableRow) : null;
  },

  async record(
    tx: TransactionClient,
    input: ComparableInput & { organizationId: string; recordedBy: string },
  ): Promise<ComparableRecord> {
    const row = await tx.comparable.create({
      data: {
        ...input,
        announcedOn: input.announcedOn ? new Date(`${input.announcedOn}T00:00:00Z`) : null,
      },
    });
    return toComparable(row as unknown as ComparableRow);
  },

  /** Retire an active comparable. Returns false when it was not active (or not visible). */
  async retire(tx: TransactionClient, id: string, retiredBy: string): Promise<boolean> {
    const { count } = await tx.comparable.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'RETIRED', retiredBy, retiredAt: new Date() },
    });
    return count === 1;
  },
};

/** The deal lead's judgements of the asking price, newest first. Buyer side only. */
export const multipleJudgements = {
  async history(tx: TransactionClient, dealId: string): Promise<MultipleJudgementRecord[]> {
    const rows = await tx.multipleJudgement.findMany({ where: { dealId }, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }] });
    return (rows as unknown as JudgementRow[]).map(toJudgement);
  },

  async record(
    tx: TransactionClient,
    input: Omit<MultipleJudgementRecord, 'id' | 'decidedAt'> & { organizationId: string },
  ): Promise<MultipleJudgementRecord> {
    const row = await tx.multipleJudgement.create({ data: input });
    return toJudgement(row as unknown as JudgementRow);
  },
};

export interface NegotiationAnchorRecord {
  id: string;
  dealId: string;
  comparableId: string;
  note: string | null;
  status: 'ACTIVE' | 'REMOVED';
  addedBy: string;
  addedAt: Date;
  removedBy: string | null;
  removedAt: Date | null;
}

const anchorSelect = {
  id: true,
  dealId: true,
  comparableId: true,
  note: true,
  status: true,
  addedBy: true,
  addedAt: true,
  removedBy: true,
  removedAt: true,
} as const;

/** Comparables the deal lead cites against the ask, oldest first. Buyer side only. */
export const negotiationAnchors = {
  async active(tx: TransactionClient, dealId: string): Promise<NegotiationAnchorRecord[]> {
    return tx.negotiationAnchor.findMany({
      where: { dealId, status: 'ACTIVE' },
      select: anchorSelect,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });
  },

  async add(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; comparableId: string; note: string | null; addedBy: string },
  ): Promise<NegotiationAnchorRecord> {
    return tx.negotiationAnchor.create({ data: input, select: anchorSelect });
  },

  /** Remove an active anchor. Returns false when it was not active (or not visible). */
  async remove(tx: TransactionClient, dealId: string, id: string, removedBy: string): Promise<boolean> {
    const { count } = await tx.negotiationAnchor.updateMany({
      where: { id, dealId, status: 'ACTIVE' },
      data: { status: 'REMOVED', removedBy, removedAt: new Date() },
    });
    return count === 1;
  },
};
