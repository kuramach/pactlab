import { objectKeyBelongsTo } from '@pactlab/domain';
import type { TransactionClient } from './client';
import { afterCursor, toPage, type PageRequest, type PageResult } from './pagination';

export interface DealRecord {
  id: string;
  organizationId: string;
  name: string;
  targetName: string;
  transactionType: 'PUBLIC_ACQUIRER' | 'PRIVATE_ACQUIRER' | 'TAKE_PRIVATE';
  stage: string;
  status: string;
  baseCurrency: string;
  /** BUYER: buyer-led diligence. SELLER: the seller runs a bid process (T-097). */
  initiatedBy: string;
  /** T-174b: the pact's working language (`en | de | fr | ja`); null follows the organization. */
  workingLanguage: string | null;
  createdAt: Date;
}

const dealSelect = {
  id: true,
  initiatedBy: true,
  organizationId: true,
  name: true,
  targetName: true,
  transactionType: true,
  stage: true,
  status: true,
  baseCurrency: true,
  workingLanguage: true,
  createdAt: true,
} as const;

/** All repository functions take a tenant-scoped transaction from `withTenant`. */
export const deals = {
  /**
   * The caller's pacts, newest first, a page at a time (T-126), optionally searched by name or target
   * and narrowed to stages. A deleted deal is unreachable anyway (every membership is revoked); never list it.
   */
  async page(tx: TransactionClient, filter: { query?: string | undefined; stages?: readonly string[] | undefined }, request: PageRequest): Promise<PageResult<DealRecord>> {
    const query = filter.query?.trim();
    const matching = {
      status: { not: 'DELETED' as const },
      ...(filter.stages ? { stage: { in: [...filter.stages] as never[] } } : {}),
      ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { targetName: { contains: query, mode: 'insensitive' as const } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.deal.findMany({ where: { AND: [matching, afterCursor('createdAt', request.cursor, { asDate: true })] }, select: dealSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: request.limit + 1 }),
      tx.deal.count({ where: matching }),
    ]);
    return toPage(rows, request, total, (row) => row.createdAt, (row) => row);
  },

  /** Every pact, newest first, read a page at a time: for whole-portfolio work (the executive report), never a screen. */
  async all(tx: TransactionClient): Promise<DealRecord[]> {
    const found: DealRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await deals.page(tx, {}, { limit: 100, ...(cursor ? { cursor } : {}) });
      found.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return found;
  },

  /** Counts for the home page: all pacts, active ones, and per stage. */
  async summary(tx: TransactionClient): Promise<{ total: number; active: number; byStage: Record<string, number> }> {
    const grouped = await tx.deal.groupBy({ by: ['stage', 'status'], where: { status: { not: 'DELETED' } }, _count: { _all: true } });
    const byStage: Record<string, number> = {};
    let total = 0;
    let active = 0;
    for (const row of grouped) {
      total += row._count._all;
      if (row.status === 'ACTIVE') active += row._count._all;
      byStage[row.stage] = (byStage[row.stage] ?? 0) + row._count._all;
    }
    return { total, active, byStage };
  },

  async get(tx: TransactionClient, dealId: string): Promise<DealRecord | null> {
    return tx.deal.findUnique({ where: { id: dealId }, select: dealSelect });
  },

  async update(
    tx: TransactionClient,
    dealId: string,
    input: Partial<Pick<DealRecord, 'name' | 'targetName' | 'stage' | 'status' | 'workingLanguage'>>,
  ): Promise<DealRecord | null> {
    const updated = await tx.deal.updateMany({ where: { id: dealId }, data: input });
    return updated.count === 0 ? null : deals.get(tx, dealId);
  },

};

export const storedFiles = {
  async get(tx: TransactionClient, fileId: string) {
    return tx.storedFile.findUnique({ where: { id: fileId } });
  },

  async register(
    tx: TransactionClient,
    input: {
      organizationId: string;
      dealId: string;
      objectKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: bigint;
      sha256: string;
    },
  ) {
    if (!objectKeyBelongsTo(input.objectKey, input.organizationId, input.dealId)) {
      throw new Error('Object key is outside the tenant/deal prefix');
    }
    return tx.storedFile.create({ data: input });
  },
};

export interface JobRunInput {
  jobId: string;
  organizationId: string;
  dealId: string;
  type: string;
  schemaVersion: number;
  idempotencyKey: string;
  attempt: number;
  requestedBy: string;
  correlationId: string;
}

export const jobRuns = {
  /**
   * Idempotent start: a replayed job with the same idempotency key returns the
   * existing run instead of creating a duplicate.
   */
  async start(tx: TransactionClient, job: JobRunInput): Promise<{ id: string; replayed: boolean; status: string }> {
    const existing = await tx.jobRun.findUnique({
      where: {
        organizationId_dealId_idempotencyKey: {
          organizationId: job.organizationId,
          dealId: job.dealId,
          idempotencyKey: job.idempotencyKey,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) return { ...existing, replayed: true };
    const created = await tx.jobRun.create({
      data: {
        id: job.jobId,
        organizationId: job.organizationId,
        dealId: job.dealId,
        type: job.type,
        schemaVersion: job.schemaVersion,
        idempotencyKey: job.idempotencyKey,
        attempt: job.attempt,
        requestedBy: job.requestedBy,
        correlationId: job.correlationId,
        status: 'RUNNING',
      },
      select: { id: true, status: true },
    });
    return { ...created, replayed: false };
  },

  async complete(tx: TransactionClient, id: string, status: 'SUCCEEDED' | 'FAILED', errorClass?: string) {
    await tx.jobRun.update({ where: { id }, data: { status, errorClass: errorClass ?? null, completedAt: new Date() } });
  },
};
