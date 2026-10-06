import type { DealId, EvidenceSource, OrganizationId, UserId } from '@pactlab/domain';
import type { PrismaClient } from '../client';
import { executeSyncRun, type SyncRunJob, type SyncRunOutcome } from '../sync';
import { withTenant } from '../tenant';

export interface SeedSyncResult {
  /** Null when the source failed (e.g. a fixture without read permission). */
  sync: SyncRunOutcome | null;
  /** Error class recorded on the failed run. */
  failed: string | null;
}

/**
 * Run a seed sync once. A source that fails (deliberately, for the partial-
 * permission fixtures) leaves a FAILED run for the UI to show; replaying the
 * seed does not re-run it, so re-seeding writes nothing new.
 */
export async function seedSync(prisma: PrismaClient, job: SyncRunJob, source: EvidenceSource): Promise<SeedSyncResult> {
  const context = {
    organizationId: job.organizationId as OrganizationId,
    userId: job.requestedBy as UserId,
    organizationRole: 'ORG_ADMIN' as const,
    dealIds: [job.dealId as DealId],
  };
  const previous = await withTenant(prisma, context, (tx) =>
    tx.syncRun.findFirst({ where: { id: job.syncRunId }, select: { status: true, errorClass: true } }),
  );
  if (previous?.status === 'FAILED') return { sync: null, failed: previous.errorClass ?? 'Unknown' };
  try {
    return { sync: await executeSyncRun(prisma, job, source), failed: null };
  } catch (error) {
    return { sync: null, failed: error instanceof Error ? error.name : 'Unknown' };
  }
}
