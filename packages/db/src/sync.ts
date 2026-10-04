import { canonicalJson, type EvidenceSource, type NormalizedEvidence } from '@pactlab/domain';
import { appendAuditEvent, enqueueOutboxEvent } from './audit';
import type { PrismaClient, TransactionClient } from './client';
import { sha256Hex } from './hash';
import { resolveJobContext, withTenant } from './tenant';

export const SYNC_RUN_JOB_TYPE = 'evidence.sync_run';

/** Job payload: everything else is re-read from the database under RLS. */
export interface SyncRunJob {
  organizationId: string;
  dealId: string;
  requestedBy: string;
  syncRunId: string;
}

export interface SyncRunOutcome {
  syncRunId: string;
  /** True when the run had already completed; nothing was written. */
  replayed: boolean;
  recordsSeen: number;
  recordsCreated: number;
  recordsUnchanged: number;
  issuesCount: number;
}

export function evidenceContentHash(record: NormalizedEvidence): string {
  return sha256Hex(
    canonicalJson({ evidenceType: record.evidenceType, canonical: { ...record.canonical } }),
  );
}

async function ingestRecord(
  tx: TransactionClient,
  run: { id: string; organizationId: string; dealId: string; connectionId: string },
  visibility: 'BUYER_ONLY' | 'SHARED',
  record: NormalizedEvidence,
): Promise<'CREATED' | 'UNCHANGED'> {
  const contentHash = evidenceContentHash(record);
  const existing = await tx.evidenceItem.findUnique({
    where: {
      organizationId_dealId_connectionId_sourceRecordId_contentHash: {
        organizationId: run.organizationId,
        dealId: run.dealId,
        connectionId: run.connectionId,
        sourceRecordId: record.sourceRecordId,
        contentHash,
      },
    },
    select: { id: true },
  });
  if (existing) {
    await tx.evidenceItem.update({ where: { id: existing.id }, data: { lastSyncRunId: run.id } });
    return 'UNCHANGED';
  }

  // Changed content for a known record becomes a new version, never an overwrite.
  const previous = await tx.evidenceItem.findFirst({
    where: { connectionId: run.connectionId, sourceRecordId: record.sourceRecordId },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const created = await tx.evidenceItem.create({
    data: {
      organizationId: run.organizationId,
      dealId: run.dealId,
      connectionId: run.connectionId,
      firstSyncRunId: run.id,
      lastSyncRunId: run.id,
      evidenceType: record.evidenceType,
      sourceSystem: record.sourceSystem,
      sourceRecordId: record.sourceRecordId,
      observedAt: record.observedAt ? new Date(record.observedAt) : null,
      canonical: { ...record.canonical },
      contentHash,
      visibility,
    },
    select: { id: true },
  });
  await tx.citation.create({
    data: {
      organizationId: run.organizationId,
      dealId: run.dealId,
      evidenceItemId: created.id,
      locator: { ...record.locator },
      quoteHash: sha256Hex(record.quote),
    },
  });
  if (previous) {
    await tx.evidenceEdge.create({
      data: {
        organizationId: run.organizationId,
        dealId: run.dealId,
        fromEvidenceId: created.id,
        toEvidenceId: previous.id,
        edgeType: 'SUPERSEDES',
        reason: 'Source record content changed between syncs',
      },
    });
  }
  return 'CREATED';
}

/**
 * Execute one sync run. Replay-safe: a completed run is returned untouched;
 * an interrupted run can be re-executed; unchanged records are matched by
 * (connection, source record id, content hash) and never duplicated.
 * Runs as a BullMQ job handler or inline; the tenant context is always
 * re-established from the job and re-checked against deal membership.
 */
export async function executeSyncRun(
  prisma: PrismaClient,
  job: SyncRunJob,
  source: EvidenceSource,
): Promise<SyncRunOutcome> {
  const tenant = await resolveJobContext(prisma, job);

  const run = await withTenant(prisma, tenant, async (tx) => {
    const found = await tx.syncRun.findFirst({
      where: { id: job.syncRunId, dealId: job.dealId },
      include: {
        connection: { select: { provider: true, evidenceVisibility: true, status: true } },
      },
    });
    if (!found) throw new Error('Sync run not found');
    if (found.status === 'SUCCEEDED') return { ...found, alreadyDone: true };
    if (found.connection.provider !== source.provider)
      throw new Error('Source does not match connection provider');
    if (found.connection.status !== 'ACTIVE') throw new Error('Connection is disabled');
    await tx.syncRun.update({
      where: { id: found.id },
      data: { status: 'RUNNING', startedAt: new Date(), errorClass: null },
    });
    return { ...found, alreadyDone: false };
  });
  if (run.alreadyDone) {
    return {
      syncRunId: run.id,
      replayed: true,
      recordsSeen: run.recordsSeen,
      recordsCreated: run.recordsCreated,
      recordsUnchanged: run.recordsUnchanged,
      issuesCount: run.issuesCount,
    };
  }

  try {
    const pull = await source.pull();
    return await withTenant(prisma, tenant, async (tx) => {
      // Serialize concurrent executions of the same run; the loser sees SUCCEEDED.
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM sync_runs WHERE id = ${run.id}::uuid FOR UPDATE`;
      if (locked?.status === 'SUCCEEDED') {
        const done = await tx.syncRun.findUniqueOrThrow({ where: { id: run.id } });
        return {
          syncRunId: run.id,
          replayed: true,
          recordsSeen: done.recordsSeen,
          recordsCreated: done.recordsCreated,
          recordsUnchanged: done.recordsUnchanged,
          issuesCount: done.issuesCount,
        };
      }
      let created = 0;
      let unchanged = 0;
      for (const record of pull.records) {
        if ((await ingestRecord(tx, run, run.connection.evidenceVisibility, record)) === 'CREATED')
          created += 1;
        else unchanged += 1;
      }
      const counts = {
        recordsSeen: pull.records.length,
        recordsCreated: created,
        recordsUnchanged: unchanged,
        issuesCount: pull.issues.length,
      };
      await tx.syncRun.update({
        where: { id: run.id },
        data: {
          ...counts,
          status: 'SUCCEEDED',
          connectorVersion: source.version,
          completedAt: new Date(),
        },
      });
      await appendAuditEvent(tx, {
        organizationId: run.organizationId,
        dealId: run.dealId,
        actorUserId: job.requestedBy,
        action: 'sync_run.completed',
        targetType: 'sync_run',
        targetId: run.id,
        outcome: 'SUCCEEDED',
        requestId: run.correlationId,
      });
      await enqueueOutboxEvent(tx, {
        organizationId: run.organizationId,
        dealId: run.dealId,
        aggregateType: 'sync_run',
        aggregateId: run.id,
        eventType: 'evidence.synced',
        payload: { syncRunId: run.id, connectionId: run.connectionId, ...counts },
        idempotencyKey: `sync_run:${run.id}:completed`,
      });
      return { syncRunId: run.id, replayed: false, ...counts };
    });
  } catch (error) {
    await withTenant(prisma, tenant, async (tx) => {
      await tx.syncRun.updateMany({
        where: { id: run.id, status: { not: 'SUCCEEDED' } },
        data: {
          status: 'FAILED',
          errorClass: error instanceof Error ? error.name : 'Unknown',
          completedAt: new Date(),
        },
      });
      await appendAuditEvent(tx, {
        organizationId: run.organizationId,
        dealId: run.dealId,
        actorUserId: job.requestedBy,
        action: 'sync_run.completed',
        targetType: 'sync_run',
        targetId: run.id,
        outcome: 'FAILED',
        requestId: run.correlationId,
      });
    });
    throw error;
  }
}
