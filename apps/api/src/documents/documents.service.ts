import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  askDocuments,
  CLASSIFY_MAX_PAGES,
  classifyDocument,
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
  categoriesForPack,
  categoryDefinition,
  decideIntake,
  intakeChecklist,
  isIntakeCategory,
  missingRequest,
  newId,
  packFor,
  permissionsForDealRole,
  tenantObjectKey,
  type CompanyType,
  type DealRole,
  type IntakeCategory,
  type PackDefinition,
  type Permission,
  type TenantContext,
} from '@pactlab/domain';
import { ArchiveError, unpackArchive } from './archive';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
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
  CategorizeDocumentBody,
  ListDocumentFindingsQuery,
  ReviewDocumentFindingBody,
  UploadArchiveBody,
  UploadDocumentBody,
} from './documents.schemas';
import { UNCLASSIFIED_INTAKE, type DocumentIntake, type DocumentPageRecord, type DocumentRecord } from './documents.types';
import { documentPages } from './document-text';
import { ExtractionError } from './extraction';
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

/** Why one file in an archive was refused, in the upload's own terms. */
function rejectionReason(error: unknown): string {
  if (error instanceof PayloadTooLargeException) return 'TOO_LARGE';
  if (error instanceof UnsupportedMediaTypeException) return 'UNSUPPORTED_TYPE';
  if (error instanceof BadRequestException) return 'EMPTY_OR_UNREADABLE';
  if (error instanceof UnprocessableEntityException) return 'UNREADABLE_OR_INFECTED';
  return 'FAILED';
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
/**
 * A failed model call, with a stable reason code the screen can explain:
 * AI_ACCESS (sign-in expired or refused — an operator must sign in again),
 * AI_THROTTLED (rate-limited), otherwise AI_UNAVAILABLE. Never provider text.
 */
function providerUnavailable(kind: string | null): ServiceUnavailableException {
  const code = kind === 'ACCESS' ? 'AI_ACCESS' : kind === 'THROTTLED' ? 'AI_THROTTLED' : 'AI_UNAVAILABLE';
  return new ServiceUnavailableException({ code });
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DOCUMENTS_REPOSITORY) private readonly documents: DocumentsRepository,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly objects: DocumentObjectStore,
    @Optional() @Inject(FindingsService) private readonly register: FindingsService | null,
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
    return this.ingest(tenant, dealId, role, body, null, requestId);
  }

  /** One file through the secure upload path: scan, type check, pages, store. */
  private async ingest(
    tenant: TenantContext,
    dealId: string,
    role: DealRole,
    body: UploadDocumentBody,
    sourcePath: string | null,
    requestId: string,
  ) {
    let validated;
    let pages;
    try {
      validated = await validateUpload(body, this.scanner);
      pages = await documentPages(validated);
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
      intake: { ...UNCLASSIFIED_INTAKE, sourcePath },
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

  /**
   * The stored original file (a PDF shown page by page beside the finding
   * under review). Same access as page reads; the bytes must still match the
   * upload's hash; every read is audited. Purged documents have no original.
   */
  async original(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canReadDocuments, { action: 'document.original_read', requestId });
    const document = await this.readable(tenant, dealId, documentId, role);
    if (document.status === 'PURGED') throw new GoneException();
    let bytes: Uint8Array;
    try {
      bytes = await this.objects.get(document.objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256) throw new ConflictException();
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, this.audit(tenant, dealId, 'document.original_read', { type: 'document', id: documentId }, requestId, 'ALLOWED')),
    );
    return { bytes, contentType: document.contentType, fileName: document.fileName };
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
    const { run, result, providerError } = outcome;
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
    if (run.status === 'PROVIDER_ERROR') throw providerUnavailable(providerError);
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

  /**
   * Zip intake (T-098): unpack on the server and send every file inside
   * through the same upload path as a direct upload. Each file's outcome is
   * returned — uploaded, already there, refused (with why) or skipped — so
   * nothing in the archive disappears silently.
   */
  async uploadArchive(tenant: TenantContext, dealId: string, body: UploadArchiveBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, canUpload, { action: 'document.archive.uploaded', requestId });
    let entries;
    try {
      entries = unpackArchive(Buffer.from(body.contentBase64, 'base64'));
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      await this.auditRejection(tenant, dealId, requestId);
      if (error.reason === 'TOO_LARGE' || error.reason === 'EXPANDS_TOO_FAR' || error.reason === 'TOO_MANY_FILES') {
        throw new PayloadTooLargeException({ code: `ARCHIVE_${error.reason}` });
      }
      throw new UnprocessableEntityException({ code: `ARCHIVE_${error.reason}` });
    }
    const files = [];
    for (const entry of entries) {
      if (entry.kind === 'SKIPPED') {
        files.push({ path: entry.path, outcome: 'SKIPPED' as const, reason: entry.reason, document: null });
        continue;
      }
      try {
        const uploaded = await this.ingest(
          tenant,
          dealId,
          role,
          {
            fileName: entry.fileName,
            contentType: entry.contentType,
            contentBase64: Buffer.from(entry.bytes).toString('base64'),
            retentionClass: body.retentionClass,
            dataClass: body.dataClass,
            aiExcluded: body.aiExcluded,
          },
          entry.folder,
          requestId,
        );
        files.push({ path: entry.path, outcome: uploaded.duplicate ? ('DUPLICATE' as const) : ('UPLOADED' as const), reason: null, document: uploaded });
      } catch (error) {
        // A scanner outage fails the whole archive closed; anything else is this file's problem.
        if (error instanceof ServiceUnavailableException) throw error;
        files.push({ path: entry.path, outcome: 'REJECTED' as const, reason: rejectionReason(error), document: null });
      }
    }
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, this.audit(tenant, dealId, 'document.archive.unpacked', { type: 'deal', id: dealId }, requestId)),
    );
    return { fileName: body.fileName, files };
  }

  private async packOf(tenant: TenantContext, dealId: string): Promise<PackDefinition> {
    const seller = await withTenant(this.prisma, tenant, (tx) =>
      tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } }),
    );
    return packFor((seller?.companyType ?? null) as CompanyType | null);
  }

  private intakeView(document: DocumentRecord) {
    const category = document.intake.category as IntakeCategory | null;
    const definition = category ? categoryDefinition(category) : null;
    return {
      documentId: document.id,
      fileName: document.fileName,
      ...document.intake,
      label: definition?.label ?? null,
      route: document.intake.state === 'FILED' ? (definition?.route ?? null) : null,
    };
  }

  /**
   * What is this file? The AI proposes a category; `decideIntake` files it
   * when that is clear and otherwise leaves a question for a person. A
   * person's answer is never overwritten by a later AI run. Files the AI may
   * not read are left for a person, unread.
   */
  async classify(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    await this.access.require(tenant, dealId, canExtract, { action: 'document.classified', requestId });
    const document = await this.documents.getDocument(tenant, dealId, documentId);
    if (!document) throw new NotFoundException();
    if (document.status === 'PURGED') throw new GoneException();
    if (document.intake.source === 'PERSON') return this.intakeView(document);
    const now = new Date().toISOString();
    const audit = this.audit(tenant, dealId, 'document.classified', { type: 'document', id: documentId }, requestId);

    if (!modelEligible(document)) {
      const intake: DocumentIntake = {
        ...UNCLASSIFIED_INTAKE,
        sourcePath: document.intake.sourcePath,
        state: 'NOT_READ',
        question: 'This file is kept away from AI, so Pactlab has not read it. What is it?',
      };
      await this.documents.updateIntake(tenant, dealId, documentId, intake, { excludeFromAi: false, run: null }, audit);
      return this.intakeView({ ...document, intake });
    }

    const pack = await this.packOf(tenant, dealId);
    // Only the first pages are read, so a long file is classified like a short one.
    const sources: CitableSource[] = (await this.documents.listPages(tenant, dealId, [documentId]))
      .filter((page) => page.text !== null && page.pageNumber <= CLASSIFY_MAX_PAGES)
      .map((page) => ({
        citationId: page.id,
        documentId,
        documentName: document.fileName,
        pageNumber: page.pageNumber,
        text: page.text ?? '',
        classification: document.dataClass,
      }));
    let outcome;
    try {
      outcome = await classifyDocument(this.gateway, {
        organizationId: tenant.organizationId,
        dealId,
        fileName: document.fileName,
        folder: document.intake.sourcePath,
        categories: categoriesForPack(pack).map((category) => ({ id: category.id, description: category.description })),
        pages: sources,
      });
    } catch (error) {
      gatewayError(error);
    }
    const { run, classification, providerError } = outcome;
    if (run.status === 'PROVIDER_ERROR') {
      await this.documents.recordAiRun(tenant, run, audit);
      throw providerUnavailable(providerError);
    }

    let intake: DocumentIntake;
    if (!classification) {
      intake = {
        ...UNCLASSIFIED_INTAKE,
        sourcePath: document.intake.sourcePath,
        state: 'NEEDS_YOU',
        question: 'Pactlab could not tell what this file is. What is it?',
        classifiedRunId: run.id,
        categorizedAt: now,
      };
    } else {
      const decision = decideIntake(pack, classification);
      intake = {
        state: decision.state,
        category: decision.category,
        source: decision.category ? 'AI' : null,
        confidence: classification.confidence,
        reason: classification.reason,
        question: decision.state === 'NEEDS_YOU' ? decision.question : null,
        entityName: classification.entity,
        counterpartyName: classification.counterparty?.name ?? null,
        sourcePath: document.intake.sourcePath,
        classifiedRunId: run.id,
        categorizedBy: null,
        categorizedAt: now,
      };
    }
    const excludeFromAi = intake.state === 'FILED' && intake.category !== null && categoryDefinition(intake.category as IntakeCategory).people;
    await this.documents.updateIntake(tenant, dealId, documentId, intake, { excludeFromAi, run }, audit);
    return this.intakeView({ ...document, aiExcluded: document.aiExcluded || excludeFromAi, intake });
  }

  /** A person answers the AI's question, or corrects a category. Their answer is final until they change it. */
  async categorize(tenant: TenantContext, dealId: string, documentId: string, body: CategorizeDocumentBody, requestId: string) {
    await this.access.require(tenant, dealId, canExtract, { action: 'document.categorized', requestId });
    const document = await this.documents.getDocument(tenant, dealId, documentId);
    if (!document) throw new NotFoundException();
    if (document.status === 'PURGED') throw new GoneException();
    const pack = await this.packOf(tenant, dealId);
    if (!isIntakeCategory(pack, body.category)) throw new UnprocessableEntityException({ code: 'UNKNOWN_CATEGORY' });
    const intake: DocumentIntake = {
      ...document.intake,
      state: 'FILED',
      category: body.category,
      source: 'PERSON',
      confidence: null,
      question: null,
      counterpartyName: body.counterpartyName === undefined ? document.intake.counterpartyName : body.counterpartyName,
      categorizedBy: tenant.userId,
      categorizedAt: new Date().toISOString(),
    };
    const excludeFromAi = categoryDefinition(body.category).people;
    await this.documents.updateIntake(
      tenant,
      dealId,
      documentId,
      intake,
      { excludeFromAi, run: null },
      this.audit(tenant, dealId, 'document.categorized', { type: 'document', id: documentId }, requestId),
    );
    return this.intakeView({ ...document, aiExcluded: document.aiExcluded || excludeFromAi, intake });
  }

  /**
   * The intake picture for a pact: what the pack expects and whether each is
   * received, connected or missing; the files waiting for a person; the
   * request list for what is missing; and the categories a person may pick.
   */
  async intake(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canAsk, { action: 'document.intake.viewed', requestId });
    const [pack, documents, connections] = await Promise.all([
      this.packOf(tenant, dealId),
      this.documents.listDocuments(tenant, dealId, { sharedOnly: false }),
      withTenant(this.prisma, tenant, (tx) =>
        tx.connection.findMany({ where: { dealId, status: 'ACTIVE' }, select: { provider: true } }),
      ),
    ]);
    const available = documents.filter((document) => document.status === 'AVAILABLE');
    const checklist = intakeChecklist(
      pack,
      available.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        category: document.intake.category as IntakeCategory | null,
        intakeState: document.intake.state,
      })),
      [...new Set(connections.map((connection) => connection.provider))],
    );
    return {
      pack: { id: pack.id, label: pack.label },
      checklist,
      request: missingRequest(checklist),
      needsYou: available
        .filter((document) => document.intake.state === 'NEEDS_YOU' || document.intake.state === 'NOT_READ')
        .map((document) => this.intakeView(document)),
      unclassified: available.filter((document) => document.intake.state === 'UNCLASSIFIED').map((document) => document.id),
      categories: categoriesForPack(pack).map((category) => ({ id: category.id, label: category.label, route: category.route.kind })),
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
    const { run, items, rejected, providerError } = outcome;
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
    // The run is recorded either way; a failed provider call is not "zero drafts".
    if (run.status === 'PROVIDER_ERROR') throw providerUnavailable(providerError);

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
    if (body.decision === 'ACCEPT' && this.register) {
      // One register: the accepted claim becomes a draft to price on Findings. Idempotent;
      // if it fails here, the Findings page offers to bring it in.
      try {
        await this.register.fromDocumentReview(tenant, dealId, requestId);
      } catch {
        // The document decision stands either way.
      }
    }
    return { finding: decided.finding, review: decided.review };
  }
}
