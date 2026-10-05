import type { AiRunRecord, ResolvedCitation } from '@pactlab/ai';
import {
  appendAuditEvent,
  withTenant,
  type AuditEventInput,
  type Prisma,
  type PrismaClient,
} from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { DocumentsRepository } from './documents.repository';
import type {
  AcceptedContentType,
  DocumentFinding,
  DocumentFindingReview,
  DocumentFindingStatus,
  DocumentPageRecord,
  DocumentRecord,
} from './documents.types';

type DocumentRow = Prisma.DocumentGetPayload<object>;
type PageRow = Prisma.DocumentPageGetPayload<object>;
type FindingRow = Prisma.DocumentFindingGetPayload<object>;
type ReviewRow = Prisma.DocumentFindingReviewGetPayload<object>;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    fileName: row.fileName,
    contentType: row.contentType as AcceptedContentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    objectKey: row.objectKey,
    pageCount: row.pageCount,
    dataClass: row.dataClass,
    aiExcluded: row.aiExcluded,
    retentionClass: row.retentionClass,
    retainUntil: iso(row.retainUntil),
    visibility: row.visibility,
    malwareScanner: row.malwareScanner,
    status: row.status,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    purgedAt: iso(row.purgedAt),
  };
}

function toPage(row: PageRow): DocumentPageRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    documentId: row.documentId,
    pageNumber: row.pageNumber,
    text: row.text,
    checksum: row.checksum,
  };
}

function toFinding(row: FindingRow): DocumentFinding {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    documentId: row.documentId,
    aiRunId: row.aiRunId,
    origin: row.origin as DocumentFinding['origin'],
    kind: row.kind,
    subtype: row.subtype,
    domain: row.domain as DocumentFinding['domain'],
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    status: row.status,
    fingerprint: row.fingerprint,
    citations: row.citations as unknown as ResolvedCitation[],
    provenance: {
      promptId: row.promptId,
      promptVersion: row.promptVersion,
      promptHash: row.promptHash,
      resolvedModelId: row.resolvedModelId,
    },
    createdBy: row.createdBy,
    reviewer:
      row.reviewerUserId && row.reviewerDisplayName
        ? { userId: row.reviewerUserId, displayName: row.reviewerDisplayName }
        : null,
    decidedAt: iso(row.decidedAt),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReview(row: ReviewRow): DocumentFindingReview {
  return {
    id: row.id,
    findingId: row.findingId,
    decision: row.decision,
    reviewer: { userId: row.reviewerUserId, displayName: row.reviewerDisplayName },
    rationale: row.rationale,
    decidedAt: row.decidedAt.toISOString(),
  };
}

const findingOrder = [{ createdAt: 'asc' }, { id: 'asc' }] as const satisfies Prisma.DocumentFindingOrderByWithRelationInput[];

/**
 * RLS-backed documents persistence. Every call runs as `pactlab_app` inside
 * the caller's tenant context; each change and its audit event commit in
 * one transaction. AI runs hold hashes and counts only.
 */
export class PrismaDocumentsRepository implements DocumentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertDocument(
    tenant: TenantContext,
    document: DocumentRecord,
    pages: readonly DocumentPageRecord[],
    audit: AuditEventInput,
  ): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.document.create({
        data: {
          id: document.id,
          organizationId: document.organizationId,
          dealId: document.dealId,
          fileName: document.fileName,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
          sha256: document.sha256,
          objectKey: document.objectKey,
          pageCount: document.pageCount,
          dataClass: document.dataClass,
          aiExcluded: document.aiExcluded,
          retentionClass: document.retentionClass,
          retainUntil: document.retainUntil ? new Date(document.retainUntil) : null,
          visibility: document.visibility,
          malwareScanner: document.malwareScanner,
          status: document.status,
          uploadedBy: document.uploadedBy,
          createdAt: new Date(document.createdAt),
          purgedAt: document.purgedAt ? new Date(document.purgedAt) : null,
        },
      });
      await tx.documentPage.createMany({ data: pages.map((page) => ({ ...page })) });
      await appendAuditEvent(tx, audit);
    });
  }

  async findDocumentBySha256(
    tenant: TenantContext,
    dealId: string,
    sha256: string,
  ): Promise<DocumentRecord | null> {
    const row = await withTenant(this.prisma, tenant, (tx) =>
      tx.document.findFirst({ where: { dealId, sha256 }, orderBy: { createdAt: 'asc' } }),
    );
    return row ? toDocument(row) : null;
  }

  async listDocuments(
    tenant: TenantContext,
    dealId: string,
    options: { sharedOnly: boolean },
  ): Promise<DocumentRecord[]> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.document.findMany({
        where: { dealId, ...(options.sharedOnly ? { visibility: 'SHARED' } : {}) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.map(toDocument);
  }

  async getDocument(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    const row = await withTenant(this.prisma, tenant, (tx) =>
      tx.document.findFirst({ where: { id: documentId, dealId } }),
    );
    return row ? toDocument(row) : null;
  }

  async listPages(
    tenant: TenantContext,
    dealId: string,
    documentIds: readonly string[],
  ): Promise<DocumentPageRecord[]> {
    if (documentIds.length === 0) return [];
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.documentPage.findMany({
        where: { dealId, documentId: { in: [...documentIds] } },
        orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
      }),
    );
    return rows.map(toPage);
  }

  async markPurged(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    purgedAt: string,
    audit: AuditEventInput,
  ): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.document.updateMany({
        where: { id: documentId, dealId, status: 'AVAILABLE' },
        data: { status: 'PURGED', purgedAt: new Date(purgedAt) },
      });
      if (updated.count === 0) return;
      await tx.documentPage.updateMany({ where: { documentId, dealId }, data: { text: null } });
      await appendAuditEvent(tx, audit);
    });
  }

  async recordAiRun(tenant: TenantContext, run: AiRunRecord, audit: AuditEventInput): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.aiRun.create({
        data: {
          id: run.id,
          organizationId: run.organizationId,
          dealId: run.dealId,
          taskType: run.taskType,
          promptId: run.promptId,
          promptVersion: run.promptVersion,
          promptHash: run.promptHash,
          modelAlias: run.modelAlias,
          resolvedModelId: run.resolvedModelId,
          inputHashes: [...run.inputHashes],
          outputHash: run.outputHash,
          status: run.status,
          repairAttempted: run.repairAttempted,
          injectionSignals: run.injectionSignals,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          latencyMs: run.latencyMs,
          createdAt: new Date(run.createdAt),
        },
      });
      await appendAuditEvent(tx, audit);
    });
  }

  async insertFindings(
    tenant: TenantContext,
    findings: readonly DocumentFinding[],
    audit: AuditEventInput,
  ): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.documentFinding.createMany({
        data: findings.map((finding) => ({
          id: finding.id,
          organizationId: finding.organizationId,
          dealId: finding.dealId,
          documentId: finding.documentId,
          aiRunId: finding.aiRunId,
          origin: finding.origin,
          kind: finding.kind,
          subtype: finding.subtype,
          domain: finding.domain,
          title: finding.title,
          summary: finding.summary,
          severity: finding.severity,
          status: finding.status,
          fingerprint: finding.fingerprint,
          citations: finding.citations as unknown as Prisma.InputJsonValue,
          promptId: finding.provenance.promptId,
          promptVersion: finding.provenance.promptVersion,
          promptHash: finding.provenance.promptHash,
          resolvedModelId: finding.provenance.resolvedModelId,
          createdBy: finding.createdBy,
          reviewerUserId: finding.reviewer?.userId ?? null,
          reviewerDisplayName: finding.reviewer?.displayName ?? null,
          decidedAt: finding.decidedAt ? new Date(finding.decidedAt) : null,
          version: finding.version,
          createdAt: new Date(finding.createdAt),
        })),
      });
      await appendAuditEvent(tx, audit);
    });
  }

  async listFindings(
    tenant: TenantContext,
    dealId: string,
    filter: { status?: DocumentFindingStatus; documentId?: string },
  ): Promise<DocumentFinding[]> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.documentFinding.findMany({
        where: {
          dealId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.documentId ? { documentId: filter.documentId } : {}),
        },
        orderBy: findingOrder,
      }),
    );
    return rows.map(toFinding);
  }

  async getFinding(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
  ): Promise<{ finding: DocumentFinding; reviews: DocumentFindingReview[] } | null> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.documentFinding.findFirst({ where: { id: findingId, dealId } });
      if (!row) return null;
      const reviews = await tx.documentFindingReview.findMany({
        where: { findingId, dealId },
        orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      });
      return { finding: toFinding(row), reviews: reviews.map(toReview) };
    });
  }

  async findingFingerprints(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
  ): Promise<Set<string>> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.documentFinding.findMany({ where: { dealId, documentId }, select: { fingerprint: true } }),
    );
    return new Set(rows.map((row) => row.fingerprint));
  }

  updateFinding(
    tenant: TenantContext,
    finding: DocumentFinding,
    expectedVersion: number,
    review: DocumentFindingReview,
    audit: AuditEventInput,
  ): Promise<boolean> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.documentFinding.updateMany({
        where: { id: finding.id, dealId: finding.dealId, version: expectedVersion },
        data: {
          status: finding.status,
          reviewerUserId: finding.reviewer?.userId ?? null,
          reviewerDisplayName: finding.reviewer?.displayName ?? null,
          decidedAt: finding.decidedAt ? new Date(finding.decidedAt) : null,
          version: finding.version,
        },
      });
      if (updated.count === 0) return false;
      await tx.documentFindingReview.create({
        data: {
          id: review.id,
          organizationId: finding.organizationId,
          dealId: finding.dealId,
          findingId: review.findingId,
          decision: review.decision,
          reviewerUserId: review.reviewer.userId,
          reviewerDisplayName: review.reviewer.displayName,
          rationale: review.rationale,
          decidedAt: new Date(review.decidedAt),
        },
      });
      await appendAuditEvent(tx, audit);
      return true;
    });
  }
}
