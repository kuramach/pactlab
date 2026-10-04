import type { DataClassification, ResolvedCitation } from '@pactlab/ai';

export const RETENTION_CLASSES = ['DEAL_TERM', 'SHORT_90D', 'LEGAL_HOLD'] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export const ACCEPTED_CONTENT_TYPES = ['text/plain', 'text/markdown'] as const;
export type AcceptedContentType = (typeof ACCEPTED_CONTENT_TYPES)[number];

/** Spec `documents`: metadata, object key, checksum, page count and retention class. */
export interface DocumentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly fileName: string;
  readonly contentType: AcceptedContentType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly objectKey: string;
  readonly pageCount: number;
  readonly dataClass: DataClassification;
  /** Per-document AI exclusion (spec §11 privacy and governance). */
  readonly aiExcluded: boolean;
  readonly retentionClass: RetentionClass;
  readonly retainUntil: string | null;
  readonly visibility: 'BUYER_ONLY' | 'SHARED';
  readonly malwareScanner: string;
  readonly status: 'AVAILABLE' | 'PURGED';
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly purgedAt: string | null;
}

/**
 * Spec `document_pages`. The page id is the citation source id. After a
 * purge the text is gone but number and checksum remain for provenance.
 */
export interface DocumentPageRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly text: string | null;
  readonly checksum: string;
}

export const DOCUMENT_FINDING_STATUSES = ['DRAFT', 'ACCEPTED', 'REJECTED'] as const;
export type DocumentFindingStatus = (typeof DOCUMENT_FINDING_STATUSES)[number];

export interface NamedReviewer {
  readonly userId: string;
  readonly displayName: string;
}

/** A draft finding produced by document AI, decided only by a named human. */
export interface DocumentFinding {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly documentId: string;
  readonly aiRunId: string;
  readonly origin: 'AI_CONTRACT_EXTRACTION';
  readonly kind: 'PARTY' | 'DATE' | 'CLAUSE';
  readonly subtype: string;
  readonly domain: 'LEGAL';
  readonly title: string;
  readonly summary: string;
  readonly severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly status: DocumentFindingStatus;
  readonly fingerprint: string;
  readonly citations: readonly ResolvedCitation[];
  readonly provenance: {
    readonly promptId: string;
    readonly promptVersion: string;
    readonly promptHash: string;
    readonly resolvedModelId: string;
  };
  readonly createdBy: string;
  readonly reviewer: NamedReviewer | null;
  readonly decidedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
}

/** Append-only (spec `finding_reviews`). */
export interface DocumentFindingReview {
  readonly id: string;
  readonly findingId: string;
  readonly decision: 'ACCEPT' | 'REJECT';
  readonly reviewer: NamedReviewer;
  readonly rationale: string;
  readonly decidedAt: string;
}
