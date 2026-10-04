import type { AiRunRecord } from '@pactlab/ai';
import type { AuditEventInput } from '@pactlab/db';
import { objectKeyBelongsTo, type TenantContext } from '@pactlab/domain';
import type { DocumentObjectStore, DocumentsRepository } from './documents.repository';
import type {
  DocumentFinding,
  DocumentFindingReview,
  DocumentPageRecord,
  DocumentRecord,
} from './documents.types';

const visible = (
  tenant: TenantContext,
  row: { organizationId: string; dealId: string },
  dealId: string,
) =>
  row.organizationId === tenant.organizationId &&
  row.dealId === dealId &&
  tenant.dealIds.includes(dealId as never);

/**
 * Test double for the persistence port: tenant-keyed (mirrors RLS),
 * copy-on-read, audits captured. Production persistence is RLS-backed.
 */
export class InMemoryDocumentsRepository implements DocumentsRepository {
  readonly documents = new Map<string, DocumentRecord>();
  readonly pages = new Map<string, DocumentPageRecord>();
  readonly findings = new Map<string, DocumentFinding>();
  readonly reviews: DocumentFindingReview[] = [];
  readonly runs: AiRunRecord[] = [];
  readonly audits: AuditEventInput[] = [];

  async insertDocument(
    _t: TenantContext,
    document: DocumentRecord,
    pages: readonly DocumentPageRecord[],
    audit: AuditEventInput,
  ) {
    this.documents.set(document.id, structuredClone(document));
    for (const page of pages) this.pages.set(page.id, structuredClone(page));
    this.audits.push(audit);
  }

  async findDocumentBySha256(tenant: TenantContext, dealId: string, sha256: string) {
    const found = [...this.documents.values()].find(
      (d) => visible(tenant, d, dealId) && d.sha256 === sha256,
    );
    return found ? structuredClone(found) : null;
  }

  async listDocuments(tenant: TenantContext, dealId: string, options: { sharedOnly: boolean }) {
    return [...this.documents.values()]
      .filter(
        (d) => visible(tenant, d, dealId) && (!options.sharedOnly || d.visibility === 'SHARED'),
      )
      .map((d) => structuredClone(d));
  }

  async getDocument(tenant: TenantContext, dealId: string, documentId: string) {
    const found = this.documents.get(documentId);
    return found && visible(tenant, found, dealId) ? structuredClone(found) : null;
  }

  async listPages(tenant: TenantContext, dealId: string, documentIds: readonly string[]) {
    return [...this.pages.values()]
      .filter((p) => visible(tenant, p, dealId) && documentIds.includes(p.documentId))
      .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.pageNumber - b.pageNumber)
      .map((p) => structuredClone(p));
  }

  async markPurged(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    purgedAt: string,
    audit: AuditEventInput,
  ) {
    const document = this.documents.get(documentId);
    if (!document || !visible(tenant, document, dealId)) return;
    this.documents.set(documentId, { ...document, status: 'PURGED', purgedAt });
    for (const [id, page] of this.pages)
      if (page.documentId === documentId) this.pages.set(id, { ...page, text: null });
    this.audits.push(audit);
  }

  async recordAiRun(_t: TenantContext, run: AiRunRecord, audit: AuditEventInput) {
    this.runs.push(structuredClone(run));
    this.audits.push(audit);
  }

  async insertFindings(
    _t: TenantContext,
    findings: readonly DocumentFinding[],
    audit: AuditEventInput,
  ) {
    for (const finding of findings) this.findings.set(finding.id, structuredClone(finding));
    this.audits.push(audit);
  }

  async listFindings(
    tenant: TenantContext,
    dealId: string,
    filter: { status?: string; documentId?: string },
  ) {
    return [...this.findings.values()]
      .filter(
        (f) =>
          visible(tenant, f, dealId) &&
          (!filter.status || f.status === filter.status) &&
          (!filter.documentId || f.documentId === filter.documentId),
      )
      .map((f) => structuredClone(f));
  }

  async getFinding(tenant: TenantContext, dealId: string, findingId: string) {
    const finding = this.findings.get(findingId);
    if (!finding || !visible(tenant, finding, dealId)) return null;
    return {
      finding: structuredClone(finding),
      reviews: this.reviews.filter((r) => r.findingId === findingId).map((r) => structuredClone(r)),
    };
  }

  async findingFingerprints(tenant: TenantContext, dealId: string, documentId: string) {
    return new Set(
      [...this.findings.values()]
        .filter((f) => visible(tenant, f, dealId) && f.documentId === documentId)
        .map((f) => f.fingerprint),
    );
  }

  async updateFinding(
    tenant: TenantContext,
    finding: DocumentFinding,
    expectedVersion: number,
    review: DocumentFindingReview,
    audit: AuditEventInput,
  ) {
    const current = this.findings.get(finding.id);
    if (
      !current ||
      !visible(tenant, current, finding.dealId) ||
      current.version !== expectedVersion
    )
      return false;
    this.findings.set(finding.id, structuredClone(finding));
    this.reviews.push(structuredClone(review));
    this.audits.push(audit);
    return true;
  }
}

/** Object store double that enforces the tenant key prefix like the bucket policy does. */
export class InMemoryObjectStore implements DocumentObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    const [organizationId = '', dealId = ''] = key.split('/');
    if (!objectKeyBelongsTo(key, organizationId, dealId) || key.split('/').length < 3) {
      throw new Error('Object keys must be tenant-prefixed');
    }
    this.objects.set(key, bytes);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
