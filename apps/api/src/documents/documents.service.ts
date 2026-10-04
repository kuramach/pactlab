import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  askDocuments,
  extractContractTerms,
  GatewayPolicyError,
  PROHIBITED_CLASSIFICATIONS,
  type CitableSource,
  type ClaudeGateway,
  type ResolvedCitation,
} from '@pactlab/ai';
import {
  appendAuditEvent,
  dealMemberships,
  withTenant,
  type AuditEventInput,
  type PrismaClient,
} from '@pactlab/db';
import {
  newId,
  permissionsForDealRole,
  tenantObjectKey,
  type DealRole,
  type Permission,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import {
  decideDocumentFinding,
  DocumentFindingError,
  draftFromExtraction,
} from './document-findings';
import {
  CLAUDE_GATEWAY,
  DOCUMENT_OBJECT_STORE,
  DOCUMENTS_REPOSITORY,
  MALWARE_SCANNER,
  type DocumentObjectStore,
  type DocumentsRepository,
} from './documents.repository';
import type {
  AskQuestionBody,
  ListDocumentFindingsQuery,
  ReviewDocumentFindingBody,
  UploadDocumentBody,
} from './documents.schemas';
import type { DocumentPageRecord, DocumentRecord } from './documents.types';
import { ExtractionError, extractPages } from './extraction';
import {
  retainUntil,
  UploadRejectedError,
  validateUpload,
  type MalwareScanner,
} from './upload-policy';

/** Direct long-context budget; larger corpora need retrieval (not in this slice). */
export const MAX_CONTEXT_CHARS = 600_000;

const has = (role: DealRole, permission: Permission) =>
  permissionsForDealRole(role).has(permission);

/** Buyers with deal write, and target contributors, may supply documents. */
const canUpload = (role: DealRole) => has(role, 'DEAL_WRITE') || role === 'TARGET_CONTRIBUTOR';
const canReadDocuments = (role: DealRole) =>
  has(role, 'EVIDENCE_READ') || role === 'TARGET_CONTRIBUTOR';
/** Q&A answers are buyer analysis over evidence. */
const canAsk = (role: DealRole) => has(role, 'EVIDENCE_READ') && has(role, 'BUYER_ANALYSIS_READ');
const canExtract = (role: DealRole) => has(role, 'DEAL_WRITE') && has(role, 'BUYER_ANALYSIS_READ');
const canReadFindings = (role: DealRole) => has(role, 'BUYER_ANALYSIS_READ');
const canReviewFindings = (role: DealRole) => role === 'DEAL_LEAD' || role === 'REVIEWER';

const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
const modelEligible = (document: DocumentRecord) =>
  document.status === 'AVAILABLE' && !document.aiExcluded && !PROHIBITED.has(document.dataClass);

function uploadError(error: UploadRejectedError | ExtractionError): never {
  if (error instanceof ExtractionError) throw new UnprocessableEntityException();
  switch (error.reason) {
    case 'TOO_LARGE':
      throw new PayloadTooLargeException();
    case 'UNSUPPORTED_TYPE':
    case 'TYPE_MISMATCH':
      throw new UnsupportedMediaTypeException();
    case 'SCAN_UNAVAILABLE':
      throw new ServiceUnavailableException();
    case 'EMPTY':
    case 'BAD_ENCODING':
      throw new BadRequestException();
    case 'MALWARE':
      throw new UnprocessableEntityException();
  }
}

function gatewayError(error: unknown): never {
  if (error instanceof GatewayPolicyError) {
    if (error.code === 'PROHIBITED_DATA') throw new UnprocessableEntityException();
    throw new ServiceUnavailableException();
  }
  throw error;
}

function documentView(document: DocumentRecord) {
  const { objectKey: _key, organizationId: _org, ...view } = document;
  return view;
}

/**
 * Document AI application service: secure upload and page extraction, cited
 * Q&A, contract extraction into DRAFT findings, and the human review queue.
 * Authorization is checked server-side per command; every change is audited.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DOCUMENTS_REPOSITORY) private readonly documents: DocumentsRepository,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly objects: DocumentObjectStore,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(CLAUDE_GATEWAY) private readonly gateway: ClaudeGateway,
  ) {}

  private audit(
    tenant: TenantContext,
    dealId: string,
    action: string,
    target: { type: string; id: string | null },
    requestId: string,
    outcome: AuditEventInput['outcome'] = 'SUCCEEDED',
  ): AuditEventInput {
    return {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType: target.type,
      targetId: target.id,
      outcome,
      requestId,
    };
  }

  async upload(tenant: TenantContext, dealId: string, body: UploadDocumentBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, canUpload, {
      action: 'document.uploaded',
      requestId,
    });
    let validated;
    let pages;
    try {
      validated = await validateUpload(body, this.scanner);
      pages = extractPages(validated.text);
    } catch (error) {
      if (error instanceof UploadRejectedError || error instanceof ExtractionError) {
        await this.auditRejection(tenant, dealId, requestId);
        uploadError(error);
      }
      throw error;
    }

    // Idempotent on content: the same bytes in the same deal return the existing document.
    const existing = await this.documents.findDocumentBySha256(tenant, dealId, validated.sha256);
    if (existing) return { ...documentView(existing), duplicate: true };

    const now = new Date();
    const documentId = newId();
    const objectKey = tenantObjectKey(
      tenant.organizationId,
      dealId,
      'documents',
      documentId,
      'original',
    );
    await this.objects.put(objectKey, validated.bytes, {
      contentType: validated.contentType,
      sha256: validated.sha256,
    });
    const document: DocumentRecord = {
      id: documentId,
      organizationId: tenant.organizationId,
      dealId,
      fileName: validated.fileName,
      contentType: validated.contentType,
      sizeBytes: validated.bytes.length,
      sha256: validated.sha256,
      objectKey,
      pageCount: pages.length,
      dataClass: body.dataClass,
      aiExcluded: body.aiExcluded || PROHIBITED.has(body.dataClass),
      retentionClass: body.retentionClass,
      retainUntil: retainUntil(body.retentionClass, now),
      // Target-supplied documents are visible to the target; buyer uploads are buyer-only.
      visibility: role === 'TARGET_CONTRIBUTOR' ? 'SHARED' : 'BUYER_ONLY',
      malwareScanner: this.scanner.name,
      status: 'AVAILABLE',
      uploadedBy: tenant.userId,
      createdAt: now.toISOString(),
      purgedAt: null,
    };
    const pageRecords: DocumentPageRecord[] = pages.map((page) => ({
      id: newId(),
      organizationId: tenant.organizationId,
      dealId,
      documentId,
      pageNumber: page.pageNumber,
      text: page.text,
      checksum: page.checksum,
    }));
    try {
      await this.documents.insertDocument(
        tenant,
        document,
        pageRecords,
        this.audit(
          tenant,
          dealId,
          'document.uploaded',
          { type: 'document', id: documentId },
          requestId,
        ),
      );
    } catch (error) {
      await this.objects.delete(objectKey);
      throw error;
    }
    return { ...documentView(document), duplicate: false };
  }

  private async auditRejection(tenant: TenantContext, dealId: string, requestId: string) {
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(
        tx,
        this.audit(
          tenant,
          dealId,
          'document.upload.rejected',
          { type: 'document', id: null },
          requestId,
          'DENIED',
        ),
      ),
    );
  }

  private async readable(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    role: DealRole,
  ) {
    const document = await this.documents.getDocument(tenant, dealId, documentId);
    if (!document) throw new NotFoundException();
    if (role === 'TARGET_CONTRIBUTOR' && document.visibility !== 'SHARED')
      throw new NotFoundException();
    return document;
  }

  async list(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canReadDocuments, {
      action: 'document.list',
      requestId,
    });
    const items = await this.documents.listDocuments(tenant, dealId, {
      sharedOnly: role === 'TARGET_CONTRIBUTOR',
    });
    return { items: items.map(documentView) };
  }

  async get(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canReadDocuments, {
      action: 'document.viewed',
      requestId,
    });
    const document = await this.readable(tenant, dealId, documentId, role);
    const pages = await this.documents.listPages(tenant, dealId, [documentId]);
    return {
      ...documentView(document),
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        checksum: page.checksum,
        available: page.text !== null,
      })),
    };
  }

  /** Page text views are audited. */
  async page(
    tenant: TenantContext,
    dealId: string,
    documentId: string,
    pageNumber: number,
    requestId: string,
  ) {
    const role = await this.access.require(tenant, dealId, canReadDocuments, {
      action: 'document.page.viewed',
      requestId,
    });
    const document = await this.readable(tenant, dealId, documentId, role);
    const page = (await this.documents.listPages(tenant, dealId, [documentId])).find(
      (p) => p.pageNumber === pageNumber,
    );
    if (!page) throw new NotFoundException();
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(
        tx,
        this.audit(
          tenant,
          dealId,
          'document.page.viewed',
          { type: 'document', id: documentId },
          requestId,
          'ALLOWED',
        ),
      ),
    );
    return {
      documentId,
      fileName: document.fileName,
      pageNumber: page.pageNumber,
      pageCount: document.pageCount,
      checksum: page.checksum,
      text: page.text,
      available: page.text !== null,
    };
  }

  /** Retention: purge the original and page text; legal hold blocks it. */
  async purge(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', {
      action: 'document.purged',
      requestId,
    });
    const document = await this.documents.getDocument(tenant, dealId, documentId);
    if (!document) throw new NotFoundException();
    if (document.retentionClass === 'LEGAL_HOLD') throw new ConflictException();
    if (document.status === 'PURGED') return documentView(document);
    await this.objects.delete(document.objectKey);
    const purgedAt = new Date().toISOString();
    await this.documents.markPurged(
      tenant,
      dealId,
      documentId,
      purgedAt,
      this.audit(
        tenant,
        dealId,
        'document.purged',
        { type: 'document', id: documentId },
        requestId,
      ),
    );
    return documentView({ ...document, status: 'PURGED', purgedAt });
  }

  private async sources(
    tenant: TenantContext,
    dealId: string,
    documents: readonly DocumentRecord[],
  ) {
    const byId = new Map(documents.map((d) => [d.id, d]));
    const pages = await this.documents.listPages(tenant, dealId, [...byId.keys()]);
    const sources: CitableSource[] = pages.flatMap((page) =>
      page.text === null
        ? []
        : [
            {
              citationId: page.id,
              documentId: page.documentId,
              documentName: byId.get(page.documentId)?.fileName ?? 'document',
              pageNumber: page.pageNumber,
              text: page.text,
              classification: byId.get(page.documentId)?.dataClass ?? 'BUSINESS',
            },
          ],
    );
    if (sources.reduce((n, s) => n + s.text.length, 0) > MAX_CONTEXT_CHARS) {
      throw new UnprocessableEntityException();
    }
    return { sources, names: byId };
  }

  private citationView(citation: ResolvedCitation, names: ReadonlyMap<string, DocumentRecord>) {
    return {
      citationId: citation.citationId,
      documentId: citation.documentId,
      documentName: names.get(citation.documentId)?.fileName ?? null,
      pageNumber: citation.pageNumber,
      quote: citation.quote,
      quoteHash: citation.quoteHash,
      charStart: citation.charStart,
      charEnd: citation.charEnd,
    };
  }

  async ask(tenant: TenantContext, dealId: string, body: AskQuestionBody, requestId: string) {
    await this.access.require(tenant, dealId, canAsk, {
      action: 'document.question.asked',
      requestId,
    });
    const all = await this.documents.listDocuments(tenant, dealId, { sharedOnly: false });
    const requested = body.documentIds ? all.filter((d) => body.documentIds?.includes(d.id)) : all;
    if (body.documentIds && requested.length !== body.documentIds.length)
      throw new NotFoundException();
    const eligible = requested.filter(modelEligible);
    if (eligible.length === 0) throw new UnprocessableEntityException();
    const { sources, names } = await this.sources(tenant, dealId, eligible);

    let outcome;
    try {
      outcome = await askDocuments(this.gateway, {
        organizationId: tenant.organizationId,
        dealId,
        question: { classification: 'BUSINESS', text: body.question },
        sources,
      });
    } catch (error) {
      gatewayError(error);
    }
    const { run, result } = outcome;
    await this.documents.recordAiRun(
      tenant,
      run,
      this.audit(
        tenant,
        dealId,
        'document.question.asked',
        { type: 'ai_run', id: run.id },
        requestId,
      ),
    );
    return {
      aiRunId: run.id,
      status: result.status,
      answer: result.answer,
      claims: result.claims.map((claim) => ({
        statement: claim.statement,
        citations: claim.citations.map((c) => this.citationView(c, names)),
      })),
      // Unsupported statements are withheld; only the reasons are reported.
      rejectedClaims: result.rejectedClaims.map((claim) => ({ reasons: claim.reasons })),
      generatedBy: {
        label: 'AI-generated — requires human review',
        promptId: run.promptId,
        promptVersion: run.promptVersion,
        modelAlias: run.modelAlias,
        resolvedModelId: run.resolvedModelId,
      },
      documentIds: eligible.map((d) => d.id),
    };
  }

  async extract(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    await this.access.require(tenant, dealId, canExtract, {
      action: 'document.extraction.requested',
      requestId,
    });
    const document = await this.documents.getDocument(tenant, dealId, documentId);
    if (!document) throw new NotFoundException();
    if (!modelEligible(document)) throw new UnprocessableEntityException();
    const { sources } = await this.sources(tenant, dealId, [document]);

    let outcome;
    try {
      outcome = await extractContractTerms(this.gateway, {
        organizationId: tenant.organizationId,
        dealId,
        sources,
      });
    } catch (error) {
      gatewayError(error);
    }
    const { run, items, rejected } = outcome;
    await this.documents.recordAiRun(
      tenant,
      run,
      this.audit(
        tenant,
        dealId,
        'document.extraction.completed',
        { type: 'ai_run', id: run.id },
        requestId,
      ),
    );

    const now = new Date();
    const known = await this.documents.findingFingerprints(tenant, dealId, documentId);
    const drafts = items
      .map((item) =>
        draftFromExtraction({
          organizationId: tenant.organizationId,
          dealId,
          documentId,
          createdBy: tenant.userId,
          run,
          item,
          now,
        }),
      )
      .filter((draft) => {
        if (known.has(draft.fingerprint)) return false;
        known.add(draft.fingerprint);
        return true;
      });
    if (drafts.length > 0) {
      await this.documents.insertFindings(
        tenant,
        drafts,
        this.audit(
          tenant,
          dealId,
          'document_finding.drafted',
          { type: 'document', id: documentId },
          requestId,
        ),
      );
    }
    return {
      aiRunId: run.id,
      status: run.status,
      drafted: drafts.length,
      duplicates: items.length - drafts.length,
      rejected: rejected.map((item) => ({ title: item.title, reasons: item.reasons })),
    };
  }

  async listFindings(
    tenant: TenantContext,
    dealId: string,
    query: ListDocumentFindingsQuery,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canReadFindings, {
      action: 'document_finding.list',
      requestId,
    });
    return { items: await this.documents.listFindings(tenant, dealId, query) };
  }

  async getFinding(tenant: TenantContext, dealId: string, findingId: string, requestId: string) {
    await this.access.require(tenant, dealId, canReadFindings, {
      action: 'document_finding.viewed',
      requestId,
    });
    const found = await this.documents.getFinding(tenant, dealId, findingId);
    if (!found) throw new NotFoundException();
    return found;
  }

  /**
   * Human review. The reviewer is the authenticated caller, named from their
   * deal membership; acceptance re-verifies every citation against the
   * current page text.
   */
  async review(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
    body: ReviewDocumentFindingBody,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canReviewFindings, {
      action: 'document_finding.reviewed',
      requestId,
    });
    const found = await this.documents.getFinding(tenant, dealId, findingId);
    if (!found) throw new NotFoundException();
    if (found.finding.version !== body.expectedVersion) throw new ConflictException();

    const member = await withTenant(this.prisma, tenant, async (tx) =>
      (await dealMemberships.list(tx, dealId)).find(
        (m) => m.userId === tenant.userId && m.status === 'ACTIVE',
      ),
    );
    if (!member) throw new NotFoundException();
    const citedPages = await this.documents.listPages(tenant, dealId, [found.finding.documentId]);
    const pages = new Map(citedPages.map((page) => [page.id, page]));

    let decided;
    try {
      decided = decideDocumentFinding({
        finding: found.finding,
        decision: body.decision,
        actor: { kind: 'HUMAN', userId: tenant.userId, displayName: member.displayName },
        rationale: body.rationale,
        pages,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof DocumentFindingError) {
        if (error.code === 'INVALID_TRANSITION') throw new ConflictException();
        throw new UnprocessableEntityException();
      }
      throw error;
    }
    const action =
      body.decision === 'ACCEPT' ? 'document_finding.accepted' : 'document_finding.rejected';
    const saved = await this.documents.updateFinding(
      tenant,
      decided.finding,
      body.expectedVersion,
      decided.review,
      this.audit(tenant, dealId, action, { type: 'document_finding', id: findingId }, requestId),
    );
    if (!saved) throw new ConflictException();
    return { finding: decided.finding, review: decided.review };
  }
}
