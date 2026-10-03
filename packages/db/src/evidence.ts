import type {
  ConnectionMode,
  EvidenceEdgeType,
  EvidenceItemView,
  EvidenceLineage,
  EvidenceVisibility,
  SourceLocator,
} from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';

export interface ConnectionRecord {
  id: string;
  organizationId: string;
  dealId: string;
  provider: string;
  displayName: string;
  mode: ConnectionMode;
  credentialRef: string | null;
  config: Prisma.JsonValue;
  status: 'ACTIVE' | 'DISABLED';
  evidenceVisibility: EvidenceVisibility;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const connections = {
  async list(tx: TransactionClient, dealId: string): Promise<ConnectionRecord[]> {
    return tx.connection.findMany({ where: { dealId }, orderBy: { createdAt: 'asc' } });
  },

  async get(
    tx: TransactionClient,
    dealId: string,
    connectionId: string,
  ): Promise<ConnectionRecord | null> {
    return tx.connection.findFirst({ where: { id: connectionId, dealId } });
  },

  async create(
    tx: TransactionClient,
    input: {
      organizationId: string;
      dealId: string;
      provider: string;
      displayName: string;
      mode: ConnectionMode;
      credentialRef: string | null;
      config: Prisma.InputJsonValue;
      evidenceVisibility: EvidenceVisibility;
      createdBy: string;
    },
  ): Promise<ConnectionRecord> {
    return tx.connection.create({ data: input });
  },

  async setMode(
    tx: TransactionClient,
    connectionId: string,
    input: { mode: ConnectionMode; credentialRef: string | null },
  ): Promise<ConnectionRecord> {
    return tx.connection.update({ where: { id: connectionId }, data: input });
  },
};

export interface SyncRunRecord {
  id: string;
  organizationId: string;
  dealId: string;
  connectionId: string;
  connectorVersion: string;
  idempotencyKey: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  recordsSeen: number;
  recordsCreated: number;
  recordsUnchanged: number;
  issuesCount: number;
  errorClass: string | null;
  requestedBy: string;
  correlationId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

const syncRunSelect = {
  id: true,
  organizationId: true,
  dealId: true,
  connectionId: true,
  connectorVersion: true,
  idempotencyKey: true,
  status: true,
  recordsSeen: true,
  recordsCreated: true,
  recordsUnchanged: true,
  issuesCount: true,
  errorClass: true,
  requestedBy: true,
  correlationId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const;

export const syncRuns = {
  async get(tx: TransactionClient, dealId: string, runId: string): Promise<SyncRunRecord | null> {
    return tx.syncRun.findFirst({ where: { id: runId, dealId }, select: syncRunSelect });
  },

  async listForConnection(
    tx: TransactionClient,
    dealId: string,
    connectionId: string,
  ): Promise<SyncRunRecord[]> {
    return tx.syncRun.findMany({
      where: { dealId, connectionId },
      select: syncRunSelect,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  },

  /**
   * Idempotent request: the same (deal, idempotency key) always resolves to
   * one run. A key reused for a different connection is a conflict.
   */
  async request(
    tx: TransactionClient,
    input: {
      organizationId: string;
      dealId: string;
      connectionId: string;
      connectorVersion: string;
      idempotencyKey: string;
      requestedBy: string;
      correlationId: string;
    },
  ): Promise<{ run: SyncRunRecord; replayed: boolean }> {
    const existing = await tx.syncRun.findUnique({
      where: {
        organizationId_dealId_idempotencyKey: {
          organizationId: input.organizationId,
          dealId: input.dealId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: syncRunSelect,
    });
    if (existing) {
      if (existing.connectionId !== input.connectionId) throw new IdempotencyConflictError();
      return { run: existing, replayed: true };
    }
    const run = await tx.syncRun.create({
      data: { ...input, status: 'QUEUED' },
      select: syncRunSelect,
    });
    return { run, replayed: false };
  },
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key already used for a different request');
    this.name = 'IdempotencyConflictError';
  }
}

const evidenceSelect = {
  id: true,
  dealId: true,
  evidenceType: true,
  sourceSystem: true,
  sourceRecordId: true,
  observedAt: true,
  contentHash: true,
  visibility: true,
  connectionId: true,
  createdAt: true,
  canonical: true,
} as const;

type EvidenceRow = Prisma.EvidenceItemGetPayload<{ select: typeof evidenceSelect }>;

export function toEvidenceView(row: EvidenceRow): EvidenceItemView {
  return {
    ...row,
    observedAt: row.observedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    canonical: row.canonical as Record<string, string | null>,
  };
}

export interface EvidenceFilter {
  evidenceType?: string;
  connectionId?: string;
  visibility?: EvidenceVisibility;
  /** Matches source record id (exact prefix) — never free text over payloads. */
  sourceRecordId?: string;
  /** Opaque cursor: the last id of the previous page (UUIDv7, time ordered). */
  after?: string;
  limit: number;
}

export const evidence = {
  async list(
    tx: TransactionClient,
    dealId: string,
    filter: EvidenceFilter,
  ): Promise<{ items: EvidenceItemView[]; nextCursor: string | null }> {
    const rows = await tx.evidenceItem.findMany({
      where: {
        dealId,
        ...(filter.evidenceType ? { evidenceType: filter.evidenceType } : {}),
        ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
        ...(filter.visibility ? { visibility: filter.visibility } : {}),
        ...(filter.sourceRecordId ? { sourceRecordId: { startsWith: filter.sourceRecordId } } : {}),
        ...(filter.after ? { id: { lt: filter.after } } : {}),
      },
      select: evidenceSelect,
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });
    const page = rows.slice(0, filter.limit);
    return {
      items: page.map(toEvidenceView),
      nextCursor: rows.length > filter.limit ? (page.at(-1)?.id ?? null) : null,
    };
  },

  async types(tx: TransactionClient, dealId: string): Promise<string[]> {
    const rows = await tx.evidenceItem.findMany({
      where: { dealId },
      distinct: ['evidenceType'],
      select: { evidenceType: true },
      orderBy: { evidenceType: 'asc' },
    });
    return rows.map((row) => row.evidenceType);
  },

  async get(
    tx: TransactionClient,
    dealId: string,
    evidenceId: string,
  ): Promise<EvidenceItemView | null> {
    const row = await tx.evidenceItem.findFirst({
      where: { id: evidenceId, dealId },
      select: evidenceSelect,
    });
    return row ? toEvidenceView(row) : null;
  },

  /** Explicit share by a deal lead; recorded with who and when. */
  async share(
    tx: TransactionClient,
    dealId: string,
    evidenceId: string,
    sharedBy: string,
  ): Promise<EvidenceItemView | null> {
    const updated = await tx.evidenceItem.updateMany({
      where: { id: evidenceId, dealId },
      data: { visibility: 'SHARED', sharedBy, sharedAt: new Date() },
    });
    return updated.count === 0 ? null : evidence.get(tx, dealId, evidenceId);
  },

  /**
   * Full lineage: source record → citation → sync run → connection, plus
   * every version/derivation reachable through evidence edges (recursive CTE,
   * depth-bounded). All reads run under RLS, so nothing invisible is reachable.
   */
  async lineage(
    tx: TransactionClient,
    dealId: string,
    evidenceId: string,
  ): Promise<EvidenceLineage | null> {
    const row = await tx.evidenceItem.findFirst({
      where: { id: evidenceId, dealId },
      select: {
        ...evidenceSelect,
        lastSyncRunId: true,
        citations: {
          select: { id: true, locator: true, quoteHash: true },
          orderBy: { createdAt: 'asc' },
        },
        firstSyncRun: {
          select: {
            id: true,
            connectorVersion: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
        },
        connection: { select: { id: true, provider: true, displayName: true, mode: true } },
      },
    });
    if (!row) return null;
    const related = await tx.$queryRaw<
      {
        evidence_id: string;
        edge_type: EvidenceEdgeType;
        direction: 'OUTGOING' | 'INCOMING';
        depth: number;
      }[]
    >`
      WITH RECURSIVE outgoing AS (
        SELECT e.to_evidence_id AS evidence_id, e.edge_type, 1 AS depth
          FROM evidence_edges e WHERE e.from_evidence_id = ${evidenceId}::uuid
        UNION
        SELECT e.to_evidence_id, e.edge_type, o.depth + 1
          FROM evidence_edges e JOIN outgoing o ON e.from_evidence_id = o.evidence_id
         WHERE o.depth < 25
      ), incoming AS (
        SELECT e.from_evidence_id AS evidence_id, e.edge_type, 1 AS depth
          FROM evidence_edges e WHERE e.to_evidence_id = ${evidenceId}::uuid
        UNION
        SELECT e.from_evidence_id, e.edge_type, i.depth + 1
          FROM evidence_edges e JOIN incoming i ON e.to_evidence_id = i.evidence_id
         WHERE i.depth < 25
      )
      SELECT evidence_id::text, edge_type::text AS edge_type, 'OUTGOING' AS direction, min(depth)::int AS depth
        FROM outgoing GROUP BY evidence_id, edge_type
      UNION ALL
      SELECT evidence_id::text, edge_type::text, 'INCOMING', min(depth)::int
        FROM incoming GROUP BY evidence_id, edge_type
      ORDER BY direction, depth, evidence_id`;
    const { citations, firstSyncRun, connection, lastSyncRunId, ...item } = row;
    return {
      evidence: toEvidenceView(item),
      citations: citations.map((citation) => ({
        id: citation.id,
        locator: citation.locator as unknown as SourceLocator,
        quoteHash: citation.quoteHash,
      })),
      syncRun: {
        ...firstSyncRun,
        startedAt: firstSyncRun.startedAt?.toISOString() ?? null,
        completedAt: firstSyncRun.completedAt?.toISOString() ?? null,
      },
      lastSeenSyncRunId: lastSyncRunId,
      connection,
      related: related.map((edge) => ({
        evidenceId: edge.evidence_id,
        edgeType: edge.edge_type,
        direction: edge.direction,
        depth: Number(edge.depth),
      })),
    };
  },
};
