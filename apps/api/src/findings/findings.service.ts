import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { citationStillValid, SourceIndex } from '@pactlab/ai';
import { evidence, withTenant, type PrismaClient } from '@pactlab/db';
import {
  auditActionFor,
  canDraftFindings,
  canReadFindings,
  canReviewFindings,
  createDraft,
  decide,
  editDraft,
  findingRule,
  FindingValidationError,
  FindingWorkflowError,
  newId,
  ruleProposals,
  type DealRole,
  type Finding,
  type FindingActor,
  type FindingEvidenceLink,
  type ProposedFinding,
  type ReviewDecision,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import { MAX_RULE_EVIDENCE, PACK_REGISTRY, RULE_READABLE_CLASSES, type PackRegistry } from './pack-rules';
import {
  FINDINGS_REPOSITORY,
  type FindingsRepository,
  type FindingWithReviews,
} from './findings.repository';
import type {
  CreateFindingBody,
  ListFindingsQuery,
  ReviewFindingBody,
  UpdateFindingBody,
} from './findings.schemas';

function translate(error: unknown): never {
  if (error instanceof FindingValidationError) throw new BadRequestException();
  if (error instanceof FindingWorkflowError) {
    if (error.code === 'FORBIDDEN' || error.code === 'HUMAN_REQUIRED')
      throw new ForbiddenException();
    if (error.code === 'INVALID_TRANSITION') throw new ConflictException();
    // Business-rule refusals name the rule, e.g. DRAG_NEEDS_PRICE, so the UI can say what to do next.
    throw new UnprocessableEntityException({ code: error.code });
  }
  throw error;
}

/**
 * Findings application service. Authorization is checked server-side per
 * command; the domain workflow enforces human decisions; every change is
 * audited atomically by the repository.
 */
@Injectable()
export class FindingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FINDINGS_REPOSITORY) private readonly findings: FindingsRepository,
    @Inject(PACK_REGISTRY) private readonly packs: PackRegistry,
  ) {}

  private human(tenant: TenantContext, role: DealRole): FindingActor {
    return { kind: 'HUMAN', userId: tenant.userId, role };
  }

  private audit(tenant: TenantContext, finding: Finding, action: string, requestId: string | null) {
    return {
      organizationId: tenant.organizationId,
      dealId: finding.dealId,
      actorUserId: tenant.userId,
      action,
      targetType: 'finding',
      targetId: finding.id,
      outcome: 'SUCCEEDED' as const,
      requestId,
    };
  }

  /** Every cited evidence item must exist in this deal and be visible to the caller (RLS). */
  private async requireResolvable(
    tenant: TenantContext,
    dealId: string,
    links: readonly FindingEvidenceLink[],
  ) {
    const ids = [...new Set(links.flatMap((link) => (link.evidenceItemId ? [link.evidenceItemId] : [])))];
    const citations = links.flatMap((link) => (link.documentCitation ? [link.documentCitation] : []));
    const { found, pages } = await withTenant(this.prisma, tenant, async (tx) => ({
      found: await Promise.all(ids.map((id) => evidence.get(tx, dealId, id))),
      pages: await Promise.all(
        citations.map((citation) =>
          tx.documentPage.findFirst({
            where: {
              dealId,
              documentId: citation.documentId,
              pageNumber: citation.pageNumber,
              document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } },
            },
            select: { text: true },
          }),
        ),
      ),
    }));
    if (found.some((item) => item === null))
      throw new UnprocessableEntityException('Evidence link does not resolve');
    // A cited page quote must still be on that page, in a class findings may cite.
    if (citations.some((citation, index) => !pages[index]?.text || !citationStillValid({ citationId: '', ...citation }, pages[index].text)))
      throw new UnprocessableEntityException('Document citation does not resolve');
  }

  private async load(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
  ): Promise<FindingWithReviews> {
    const found = await this.findings.get(tenant, dealId, findingId);
    if (!found) throw new NotFoundException();
    return found;
  }

  async list(tenant: TenantContext, dealId: string, query: ListFindingsQuery, requestId: string) {
    await this.access.require(tenant, dealId, canReadFindings, {
      action: 'finding.list',
      requestId,
    });
    return { items: await this.findings.list(tenant, dealId, query) };
  }

  async get(tenant: TenantContext, dealId: string, findingId: string, requestId: string) {
    await this.access.require(tenant, dealId, canReadFindings, {
      action: 'finding.viewed',
      requestId,
    });
    return this.load(tenant, dealId, findingId);
  }

  async create(tenant: TenantContext, dealId: string, body: CreateFindingBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, canDraftFindings, {
      action: 'finding.created',
      requestId,
    });
    await this.requireResolvable(tenant, dealId, body.evidence);
    let finding: Finding;
    try {
      finding = createDraft(
        { ...body, origin: 'HUMAN', fingerprint: `human:${newId()}` },
        this.human(tenant, role),
        {
          id: newId(),
          organizationId: tenant.organizationId,
          dealId,
          now: new Date().toISOString(),
        },
      );
    } catch (error) {
      translate(error);
    }
    await this.findings.insert(
      tenant,
      finding,
      this.audit(tenant, finding, 'finding.created', requestId),
    );
    return finding;
  }

  /**
   * Drafts proposed by scanners, heuristics or models. Idempotent by
   * fingerprint, so re-running a scan creates nothing new. Never reviews.
   */
  async recordProposals(
    tenant: TenantContext,
    dealId: string,
    proposals: readonly ProposedFinding[],
    actor: Exclude<FindingActor, { kind: 'HUMAN' }>,
    requestId: string,
  ): Promise<{ created: Finding[]; existing: number }> {
    await this.access.require(tenant, dealId, canDraftFindings, {
      action: 'finding.created',
      requestId,
    });
    const created: Finding[] = [];
    let existing = 0;
    for (const proposal of proposals) {
      if (await this.findings.findByFingerprint(tenant, dealId, proposal.fingerprint)) {
        existing += 1;
        continue;
      }
      await this.requireResolvable(tenant, dealId, proposal.evidence);
      let finding: Finding;
      try {
        finding = createDraft(proposal, actor, {
          id: newId(),
          organizationId: tenant.organizationId,
          dealId,
          now: new Date().toISOString(),
        });
      } catch (error) {
        translate(error);
      }
      await this.findings.insert(
        tenant,
        finding,
        this.audit(tenant, finding, 'finding.drafted', requestId),
      );
      created.push(finding);
    }
    return { created, existing };
  }

  /**
   * Run the deal's pack finding rules over its current pack evidence and
   * record what they propose as DRAFT findings (idempotent by fingerprint:
   * a re-run creates nothing new). Deterministic, no model; humans decide.
   */
  async runPackRules(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canDraftFindings, { action: 'finding.pack_rules_run', requestId });
    const { pack, evidence: rows, pages } = await withTenant(this.prisma, tenant, async (tx) => {
      const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
      const type = seller?.companyType;
      const pack = this.packs.packs[type && type !== 'OTHER' ? type : 'SOFTWARE_SAAS'];
      const types = [...new Set(pack.findingRules.flatMap((id) => findingRule(id, this.packs.rules).evidenceTypes))];
      const found = types.length === 0
        ? []
        : await tx.evidenceItem.findMany({
            where: { dealId, evidenceType: { in: types } },
            select: { id: true, connectionId: true, evidenceType: true, sourceRecordId: true, canonical: true },
            orderBy: { id: 'asc' },
            take: MAX_RULE_EVIDENCE + 1,
          });
      // Pages only for rules that read documents, only from readable classes (never HR, pay or performance).
      const readsDocuments = pack.findingRules.some((id) => findingRule(id, this.packs.rules).readsDocuments);
      const pageRows = readsDocuments
        ? await tx.documentPage.findMany({
            where: { dealId, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } } },
            select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
            orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
          })
        : [];
      return {
        pack,
        evidence: found,
        pages: pageRows.flatMap((page) =>
          page.text ? [{ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text, documentName: page.document.fileName, classification: page.document.dataClass }] : [],
        ),
      };
    });
    if (rows.length > MAX_RULE_EVIDENCE) throw new PayloadTooLargeException('Too much evidence for one rule run');
    // The newest version of each source record (earlier versions stay in lineage).
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) latest.set(`${row.connectionId}|${row.evidenceType}|${row.sourceRecordId}`, row);
    const input = [...latest.values()].map((row) => ({
      id: row.id,
      evidenceType: row.evidenceType,
      sourceRecordId: row.sourceRecordId,
      canonical: (row.canonical ?? {}) as Record<string, string | null>,
    }));
    const rules = pack.findingRules.map((id) => findingRule(id, this.packs.rules));
    // Quotes become citations only if they are really on the page (no model; same check as AI citations).
    const index = new SourceIndex(
      pages.map((page) => ({
        citationId: `${page.documentId}:${page.pageNumber}`,
        documentId: page.documentId,
        documentName: page.documentName,
        pageNumber: page.pageNumber,
        text: page.text,
        classification: page.classification,
      })),
    );
    const resolve = (quote: { documentId: string; pageNumber: number; quote: string }) => {
      const check = index.verify({ citationId: `${quote.documentId}:${quote.pageNumber}`, quote: quote.quote });
      if (!check.ok) return null;
      const { citationId: _id, ...citation } = check.citation;
      return citation;
    };
    const rulePages = pages.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text }));
    const runs = rules.map((rule) => ruleProposals(rule, { evidence: input, pages: rulePages }, resolve));
    const proposals = runs.flatMap((run) => run.proposals);
    const recorded = await this.recordProposals(tenant, dealId, proposals, { kind: 'SYSTEM', component: 'pack-rules' }, requestId);
    return {
      pack: pack.id,
      rules: rules.map((rule) => ({ id: rule.id, version: rule.version })),
      evidenceRead: input.length,
      pagesRead: pages.length,
      unresolvedQuotes: runs.reduce((total, run) => total + run.unresolved, 0),
      created: recorded.created.length,
      existing: recorded.existing,
    };
  }

  async update(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
    body: UpdateFindingBody,
    requestId: string,
  ) {
    const role = await this.access.require(tenant, dealId, canDraftFindings, {
      action: 'finding.updated',
      requestId,
    });
    const { finding: current } = await this.load(tenant, dealId, findingId);
    if (current.version !== body.expectedVersion) throw new ConflictException();
    const { expectedVersion: _version, ...patch } = body;
    if (patch.evidence) await this.requireResolvable(tenant, dealId, patch.evidence);
    let next: Finding;
    try {
      next = editDraft(current, patch, this.human(tenant, role), new Date().toISOString());
    } catch (error) {
      translate(error);
    }
    const saved = await this.findings.update(
      tenant,
      next,
      current.version,
      null,
      this.audit(tenant, next, 'finding.updated', requestId),
    );
    if (!saved) throw new ConflictException();
    return next;
  }

  async review(
    tenant: TenantContext,
    dealId: string,
    findingId: string,
    body: ReviewFindingBody,
    requestId: string,
  ) {
    const decision: ReviewDecision = body.decision;
    const role = await this.access.require(
      tenant,
      dealId,
      decision === 'SUBMITTED' ? canDraftFindings : canReviewFindings,
      { action: auditActionFor(decision), requestId },
    );
    const { finding: current } = await this.load(tenant, dealId, findingId);
    if (current.version !== body.expectedVersion) throw new ConflictException();
    if (decision === 'ACCEPTED') await this.requireResolvable(tenant, dealId, current.evidence);
    let result: ReturnType<typeof decide>;
    try {
      result = decide(
        current,
        decision,
        body.rationale,
        this.human(tenant, role),
        { reviewId: newId(), now: new Date().toISOString() },
        {
          ...(body.direction !== undefined ? { direction: body.direction } : {}),
          ...(body.directionRationale !== undefined ? { directionRationale: body.directionRationale } : {}),
        },
      );
    } catch (error) {
      translate(error);
    }
    const saved = await this.findings.update(
      tenant,
      result.finding,
      current.version,
      result.review,
      this.audit(tenant, result.finding, auditActionFor(decision), requestId),
    );
    if (!saved) throw new ConflictException();
    return result;
  }
}
