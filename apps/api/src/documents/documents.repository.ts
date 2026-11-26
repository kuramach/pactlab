import type { PageRequest, PageResult, PageSize, RankedPage } from '@pactlab/db';
import type { AiRunRecord } from '@pactlab/ai';
import type { AuditEventInput } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type {
  DocumentFinding,
  DocumentFindingReview,
  DocumentFindingStatus,
  DocumentIntake,
  DocumentPageRecord,
  DocumentRecord,
} from './documents.types';

export const DOCUMENTS_REPOSITORY = Symbol('DOCUMENTS_REPOSITORY');
export const DOCUMENT_OBJECT_STORE = Symbol('DOCUMENT_OBJECT_STORE');
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');
export const CLAUDE_GATEWAY = Symbol('CLAUDE_GATEWAY');
export const CONTEXT_BUDGET_CHARS = Symbol('CONTEXT_BUDGET_CHARS');

/**
 * Persistence port for documents, pages, AI runs and document findings.
 * Implementations run every call inside the caller's tenant context (RLS)
 * and write the supplied audit event in the same transaction as the change.
 */
export interface DocumentsRepository {
  insertDocument(
    tenant: TenantContext,
    document: DocumentRecord,
    pages: readonly DocumentPageRecord[],
    audit: AuditEventInput,
  ): Promise<void>;
  findDocumentBySha256(
    tenant: TenantContext,
    dealId: string,
    sha256: string,
  ): Promise<DocumentRecord | null>;
  /** Every document of a pact, for calculations over the whole set (intake checklist, requests); never a screen. */
  listDocuments(
    tenant: TenantContext,
    dealId: string,
    options: { sharedOnly: boolean },
  ): Promise<DocumentRecord[]>;
  /** The library, a page at a time (T-126). */
  pageDocuments(
    tenant: TenantContext,
    dealId: string,
    filter: { sharedOnly: boolean; query?: string | undefined; contentTypes?: readonly string[] | undefined; sort: 'uploaded' | 'name' | 'pages'; dir: 'asc' | 'desc' },
    request: PageRequest,
  ): Promise<PageResult<DocumentRecord>>;
  /** Drafts and decided AI findings per document, for some documents (one page). */
  findingCounts(tenant: TenantContext, dealId: string, documentIds: readonly string[]): Promise<Map<string, { findings: number; pending: number }>>;
  getDocument(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
  ): Promise<DocumentRecord | null>;
  listPages(
    tenant: TenantContext,
    dealId: string,
    documentIds: readonly string[],
  ): Promise<DocumentPageRecord[]>;
  /** Pages by id (the ones retrieval chose), in the order given; pages the caller cannot see are left out. */
  pagesById(tenant: TenantContext, dealId: string, pageIds: readonly string[]): Promise<DocumentPageRecord[]>;
  /** Every page of the documents without its text (T-139): ids, checksums and lengths for the budget check. */
  pageSizes(tenant: TenantContext, dealId: string, documentIds: readonly string[]): Promise<PageSize[]>;
  /** Keyword ranking of the documents' pages for a question, best first, under RLS (T-139). */
  rankPages(tenant: TenantContext, dealId: string, documentIds: readonly string[], question: string): Promise<RankedPage[]>;
  /** Removes page text; keeps page numbers, checksums and decision history. */
  markPurged(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    purgedAt: string,
    audit: AuditEventInput,
  ): Promise<void>;
  recordAiRun(tenant: TenantContext, run: AiRunRecord, audit: AuditEventInput): Promise<void>;
  /**
   * Intake: file the document (category, state, question). `aiExcluded`
   * may only turn exclusion on. Writes the AI run (when given) and the audit
   * event in the same transaction.
   */
  updateIntake(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    intake: Omit<DocumentIntake, 'sourcePath'>,
    options: { excludeFromAi: boolean; run: AiRunRecord | null; recategorizedFrom?: string | null },
    audit: AuditEventInput,
  ): Promise<void>;
  insertFindings(
    tenant: TenantContext,
    findings: readonly DocumentFinding[],
    audit: AuditEventInput,
  ): Promise<void>;
  /** AI drafts on a pact, oldest first, a page at a time (T-126), each with its document's name. */
  listFindings(
    tenant: TenantContext,
    dealId: string,
    filter: { status?: DocumentFindingStatus | undefined; decided?: boolean | undefined; documentId?: string | undefined },
    request: PageRequest,
  ): Promise<PageResult<DocumentFinding & { documentName: string }>>;
  getFinding(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
  ): Promise<{ finding: DocumentFinding; reviews: DocumentFindingReview[] } | null>;
  findingFingerprints(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
  ): Promise<Set<string>>;
  /** Returns false when `expectedVersion` is stale (optimistic concurrency). */
  updateFinding(
    tenant: TenantContext,
    finding: DocumentFinding,
    expectedVersion: number,
    review: DocumentFindingReview,
    audit: AuditEventInput,
  ): Promise<boolean>;
}

/**
 * Tenant-scoped object storage for originals. Keys always begin with
 * organization and deal ids; deployed stores enforce the prefix in bucket
 * policy and KMS encryption context.
 */
export interface DocumentObjectStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void>;
  /** The stored original, for the side-by-side review viewer. */
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
