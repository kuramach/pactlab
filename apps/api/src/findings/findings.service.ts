import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { evidence, withTenant, type PrismaClient } from '@pactlab/db';
import {
  auditActionFor,
  canDraftFindings,
  canReadFindings,
  canReviewFindings,
  createDraft,
  decide,
  editDraft,
  FindingValidationError,
  FindingWorkflowError,
  newId,
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
    throw new UnprocessableEntityException();
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
    const ids = [...new Set(links.map((link) => link.evidenceItemId))];
    const found = await withTenant(this.prisma, tenant, async (tx) =>
      Promise.all(ids.map((id) => evidence.get(tx, dealId, id))),
    );
    if (found.some((item) => item === null))
      throw new UnprocessableEntityException('Evidence link does not resolve');
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
      result = decide(current, decision, body.rationale, this.human(tenant, role), {
        reviewId: newId(),
        now: new Date().toISOString(),
      });
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
