import type { AuditEventInput, FindingPageFilter, PageRequest, PageResult } from '@pactlab/db';
import type { Finding, FindingReview, FindingStatus, TenantContext } from '@pactlab/domain';

export const FINDINGS_REPOSITORY = Symbol('FINDINGS_REPOSITORY');

export interface FindingFilter {
  readonly status?: FindingStatus;
  readonly domain?: Finding['domain'];
}

export interface FindingWithReviews {
  readonly finding: Finding;
  /** Oldest first; append-only. */
  readonly reviews: readonly FindingReview[];
}

/**
 * Persistence port for findings, evidence links and append-only reviews.
 * Implementations run every call inside the caller's tenant context (RLS)
 * and write the supplied audit event in the same transaction as the change.
 */
export interface FindingsRepository {
  /** Every matching finding, for calculations (valuation, pricing, the pact report); screens use `page`. */
  list(tenant: TenantContext, dealId: string, filter: FindingFilter): Promise<Finding[]>;
  /** Counts across every matching finding, for charts on a paged list. */
  summary(tenant: TenantContext, dealId: string, filter: FindingFilter & { source?: 'document-review' | undefined }): Promise<{ total: number; bySeverity: Record<string, number>; byStatus: Record<string, number>; pricingNeeded: number }>;
  /** A page of findings, oldest first, filtered in the database (T-126). */
  page(tenant: TenantContext, dealId: string, filter: FindingPageFilter, request: PageRequest): Promise<PageResult<Finding>>;
  get(tenant: TenantContext, dealId: string, findingId: string): Promise<FindingWithReviews | null>;
  findByFingerprint(
    tenant: TenantContext,
    dealId: string,
    fingerprint: string,
  ): Promise<Finding | null>;
  insert(tenant: TenantContext, finding: Finding, audit: AuditEventInput): Promise<void>;
  /** Returns false when `expectedVersion` is stale (optimistic concurrency). */
  update(
    tenant: TenantContext,
    finding: Finding,
    expectedVersion: number,
    review: FindingReview | null,
    audit: AuditEventInput,
  ): Promise<boolean>;
}
