import { objectKeyBelongsTo } from '@pactlab/domain';
import type { TransactionClient } from './client';

export interface DealRecord {
  id: string;
  organizationId: string;
  name: string;
  targetName: string;
  transactionType: 'PUBLIC_ACQUIRER' | 'PRIVATE_ACQUIRER' | 'TAKE_PRIVATE';
  stage: string;
  status: string;
  baseCurrency: string;
  createdAt: Date;
}

const dealSelect = {
  id: true,
  organizationId: true,
  name: true,
  targetName: true,
  transactionType: true,
  stage: true,
  status: true,
  baseCurrency: true,
  createdAt: true,
} as const;

/** All repository functions take a tenant-scoped transaction from `withTenant`. */
export const deals = {
  async list(tx: TransactionClient): Promise<DealRecord[]> {
    return tx.deal.findMany({ select: dealSelect, orderBy: { createdAt: 'desc' } });
  },

  async get(tx: TransactionClient, dealId: string): Promise<DealRecord | null> {
    return tx.deal.findUnique({ where: { id: dealId }, select: dealSelect });
  },

  async update(
    tx: TransactionClient,
    dealId: string,
    input: Partial<Pick<DealRecord, 'name' | 'targetName' | 'stage' | 'status'>>,
  ): Promise<DealRecord | null> {
    const updated = await tx.deal.updateMany({ where: { id: dealId }, data: input });
    return updated.count === 0 ? null : deals.get(tx, dealId);
  },

  /** Full-text search. RLS removes other tenants' rows before ranking. */
  async search(tx: TransactionClient, query: string): Promise<DealRecord[]> {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM deals
       WHERE to_tsvector('simple'::regconfig, name || ' ' || target_name) @@ plainto_tsquery('simple', ${query})
       ORDER BY ts_rank(to_tsvector('simple'::regconfig, name || ' ' || target_name), plainto_tsquery('simple', ${query})) DESC, id
       LIMIT 50`;
    if (ids.length === 0) return [];
    const rows = await tx.deal.findMany({ where: { id: { in: ids.map((row) => row.id) } }, select: dealSelect });
    const order = new Map(ids.map((row, index) => [row.id, index]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
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
