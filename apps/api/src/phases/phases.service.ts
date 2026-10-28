import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  ClaimView,
  CreateClaimInput,
  PostCloseItemView,
  PostCloseView,
  ScreeningInput,
  ScreeningVerdictInput,
  ScreeningView,
  UpdateClaimInput,
  UpdatePostCloseItemInput,
} from '@pactlab/contracts';
import { appendAuditEvent, askingPrices, dealMemberships, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  isCounterpartyRole,
  newId,
  permissionsForDealRole,
  postCloseProposals,
  type ClaimStatus,
  type DealRole,
  type PostCloseSourceFinding,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && !isCounterpartyRole(role);
/** Go / no-go is the deal lead's call. */
const canDecide = (role: DealRole) => role === 'DEAL_LEAD';

type RedFlag = { id: string; text: string };
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/**
 * The three phases of a pact (T-071), layered on the existing deal stage:
 * Pre-Diligence screening with a recorded verdict, the Diligence claims
 * register (said vs observed), and the Post-Close registers generated from
 * diligence output. Nothing is re-typed between phases: red flags become
 * claims, claims link to findings, findings become post-close items — all
 * by reference. Every write is audited. Buyer side only (RLS).
 */
@Injectable()
export class PhasesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  private async names(tx: TransactionClient, dealId: string): Promise<Map<string, string>> {
    return new Map((await dealMemberships.list(tx, dealId)).map((member) => [member.userId, member.displayName]));
  }

  // --- Pre-Diligence ---------------------------------------------------------

  async screening(tenant: TenantContext, dealId: string, requestId: string): Promise<ScreeningView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'screening.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { stage: true } });
      if (!deal) throw new NotFoundException();
      const [review, asking, names] = await Promise.all([
        tx.screeningReview.findFirst({ where: { dealId } }),
        askingPrices.currentFor(tx, [dealId]),
        this.names(tx, dealId),
      ]);
      const price = asking.get(dealId);
      return {
        dealId,
        stage: deal.stage,
        intakeNotes: review?.intakeNotes ?? null,
        headlineRevenue: review?.headlineRevenue?.toFixed() ?? null,
        headlineCurrency: review?.headlineCurrency ?? null,
        valueLow: review?.valueLow?.toFixed() ?? null,
        valueHigh: review?.valueHigh?.toFixed() ?? null,
        redFlags: (review?.redFlags as RedFlag[] | undefined) ?? [],
        verdict: (review?.verdict as ScreeningView['verdict']) ?? null,
        rationale: review?.rationale ?? null,
        gaps: review?.gaps ?? null,
        decidedByName: review?.decidedBy ? (names.get(review.decidedBy) ?? null) : null,
        decidedAt: review?.decidedAt?.toISOString() ?? null,
        version: review?.version ?? 0,
        askingPrice: price ? { amount: price.amount, currency: price.currency, basis: price.basis } : null,
        canEdit: canWrite(role) && deal.stage === 'SCREENING',
        canDecide: canDecide(role) && deal.stage === 'SCREENING',
      };
    });
  }

  async saveScreening(tenant: TenantContext, dealId: string, input: ScreeningInput, requestId: string): Promise<ScreeningView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'screening.saved', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { stage: true } });
      if (!deal) throw new NotFoundException();
      if (deal.stage !== 'SCREENING') throw new ConflictException({ code: 'NOT_IN_SCREENING' });
      const existing = await tx.screeningReview.findFirst({ where: { dealId } });
      if ((existing?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const flags = input.redFlags.map((text, index) => ({ id: (existing?.redFlags as RedFlag[] | undefined)?.find((flag) => flag.text === text)?.id ?? `rf-${index + 1}-${newId().slice(-8)}`, text }));
      const data = {
        intakeNotes: input.intakeNotes,
        headlineRevenue: input.headlineRevenue,
        headlineCurrency: input.headlineCurrency,
        valueLow: input.valueLow,
        valueHigh: input.valueHigh,
        redFlags: flags,
        updatedBy: tenant.userId,
        updatedAt: new Date(),
      };
      const saved = existing
        ? await tx.screeningReview.update({ where: { id: existing.id }, data: { ...data, version: existing.version + 1 } })
        : await tx.screeningReview.create({ data: { ...data, organizationId: tenant.organizationId, dealId } });
      await this.audit(tx, tenant, dealId, 'screening.saved', 'screening_review', saved.id, requestId);
    });
    return this.screening(tenant, dealId, requestId);
  }

  /**
   * The screening verdict. GO moves the deal into Diligence and turns every
   * red flag into a claim to verify (a line of inquiry); NO_GO archives the
   * pact with its rationale; NEEDS_MORE keeps it in Pre with the gaps named.
   */
  async decide(tenant: TenantContext, dealId: string, input: ScreeningVerdictInput, requestId: string): Promise<ScreeningView> {
    await this.access.require(tenant, dealId, canDecide, { action: 'screening.decided', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { stage: true } });
      if (!deal) throw new NotFoundException();
      if (deal.stage !== 'SCREENING') throw new ConflictException({ code: 'NOT_IN_SCREENING' });
      if (input.verdict === 'NEEDS_MORE' && !input.gaps) throw new UnprocessableEntityException({ code: 'GAPS_REQUIRED' });
      const existing =
        (await tx.screeningReview.findFirst({ where: { dealId } })) ??
        (await tx.screeningReview.create({ data: { organizationId: tenant.organizationId, dealId, updatedBy: tenant.userId } }));
      const decided = await tx.screeningReview.update({
        where: { id: existing.id },
        data: { verdict: input.verdict, rationale: input.rationale, gaps: input.gaps, decidedBy: tenant.userId, decidedAt: new Date(), updatedBy: tenant.userId, updatedAt: new Date(), version: existing.version + 1 },
      });
      if (input.verdict === 'GO') {
        await tx.deal.update({ where: { id: dealId }, data: { stage: 'DILIGENCE' } });
        for (const flag of decided.redFlags as RedFlag[]) {
          await tx.dealClaim.create({
            data: {
              organizationId: tenant.organizationId,
              dealId,
              statement: flag.text,
              source: 'Screening red flag',
              origin: 'SCREENING_RED_FLAG',
              createdBy: tenant.userId,
              updatedBy: tenant.userId,
            },
          });
        }
      } else if (input.verdict === 'NO_GO') {
        await tx.deal.update({ where: { id: dealId }, data: { status: 'ARCHIVED' } });
      }
      await this.audit(tx, tenant, dealId, `screening.verdict_${input.verdict.toLowerCase()}`, 'screening_review', decided.id, requestId);
    });
    return this.screening(tenant, dealId, requestId);
  }

  // --- Diligence: said vs observed --------------------------------------------

  async claims(tenant: TenantContext, dealId: string, requestId: string): Promise<{ items: ClaimView[]; canEdit: boolean }> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'claims.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const rows = await tx.dealClaim.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const findingIds = [...new Set(rows.flatMap((row) => row.findingIds))];
      const findings = findingIds.length > 0 ? await tx.finding.findMany({ where: { dealId, id: { in: findingIds } }, select: { id: true, title: true, status: true } }) : [];
      const byId = new Map(findings.map((finding) => [finding.id, finding]));
      const names = await this.names(tx, dealId);
      return {
        items: rows.map((row) => ({
          id: row.id,
          statement: row.statement,
          source: row.source,
          origin: row.origin as ClaimView['origin'],
          status: row.status as ClaimStatus,
          rationale: row.rationale,
          evidenceItemIds: row.evidenceItemIds,
          findings: row.findingIds.flatMap((id) => (byId.get(id) ? [{ id, title: byId.get(id)?.title ?? '', status: byId.get(id)?.status ?? '' }] : [])),
          version: row.version,
          updatedByName: names.get(row.updatedBy) ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
        canEdit: canWrite(role),
      };
    });
  }

  async createClaim(tenant: TenantContext, dealId: string, input: CreateClaimInput, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'claim.created', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const claim = await tx.dealClaim.create({
        data: { organizationId: tenant.organizationId, dealId, statement: input.statement, source: input.source, origin: 'MANUAL', createdBy: tenant.userId, updatedBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'claim.created', 'deal_claim', claim.id, requestId);
    });
    return this.claims(tenant, dealId, requestId);
  }

  /** Move a claim between UNVERIFIED, VERIFIED and CONTRADICTED; its links must resolve in this deal. */
  async updateClaim(tenant: TenantContext, dealId: string, claimId: string, input: UpdateClaimInput, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'claim.updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const claim = await tx.dealClaim.findFirst({ where: { id: claimId, dealId } });
      if (!claim) throw new NotFoundException();
      const [evidence, findings] = await Promise.all([
        input.evidenceItemIds.length > 0 ? tx.evidenceItem.count({ where: { dealId, id: { in: input.evidenceItemIds } } }) : 0,
        input.findingIds.length > 0 ? tx.finding.count({ where: { dealId, id: { in: input.findingIds } } }) : 0,
      ]);
      if (evidence !== new Set(input.evidenceItemIds).size || findings !== new Set(input.findingIds).size) {
        throw new UnprocessableEntityException({ code: 'LINK_NOT_FOUND' });
      }
      if (input.status !== 'UNVERIFIED' && !input.rationale) throw new UnprocessableEntityException({ code: 'RATIONALE_REQUIRED' });
      const { count } = await tx.dealClaim.updateMany({
        where: { id: claimId, dealId, version: input.expectedVersion },
        data: {
          status: input.status,
          rationale: input.rationale,
          evidenceItemIds: [...new Set(input.evidenceItemIds)],
          findingIds: [...new Set(input.findingIds)],
          version: input.expectedVersion + 1,
          updatedBy: tenant.userId,
          updatedAt: new Date(),
        },
      });
      if (count !== 1) throw new ConflictException();
      await this.audit(tx, tenant, dealId, `claim.${input.status.toLowerCase()}`, 'deal_claim', claimId, requestId);
    });
    return this.claims(tenant, dealId, requestId);
  }

  // --- Post-Close ------------------------------------------------------------

  /**
   * Generate the post-close registers from diligence output (idempotent by
   * source: closing twice adds nothing). Called when the deal moves to
   * CLOSED, and available as an explicit refresh.
   */
  async generatePostClose(tenant: TenantContext, dealId: string, requestId: string): Promise<{ created: number }> {
    await this.access.require(tenant, dealId, canWrite, { action: 'post_close.generated', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const findings = await tx.finding.findMany({
        where: { dealId },
        select: { id: true, title: true, status: true, direction: true, valueDriver: true, pricedRiskType: true },
        orderBy: { createdAt: 'asc' },
      });
      let created = 0;
      for (const proposal of postCloseProposals(findings as unknown as PostCloseSourceFinding[])) {
        const result = await tx.postCloseItem.createMany({
          data: [{ organizationId: tenant.organizationId, dealId, ...proposal, updatedBy: tenant.userId }],
          skipDuplicates: true,
        });
        created += result.count;
      }
      if (created > 0) await this.audit(tx, tenant, dealId, 'post_close.generated', 'deal', dealId, requestId);
      return { created };
    });
  }

  async postClose(tenant: TenantContext, dealId: string, requestId: string): Promise<PostCloseView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'post_close.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const [rows, members] = await Promise.all([
        tx.postCloseItem.findMany({ where: { dealId }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
        dealMemberships.list(tx, dealId),
      ]);
      const names = new Map(members.map((member) => [member.userId, member.displayName]));
      return {
        items: rows.map(
          (row): PostCloseItemView => ({
            id: row.id,
            kind: row.kind as PostCloseItemView['kind'],
            sourceType: 'FINDING',
            sourceId: row.sourceId,
            title: row.title,
            action: row.action,
            ownerUserId: row.ownerUserId,
            ownerName: row.ownerUserId ? (names.get(row.ownerUserId) ?? null) : null,
            dueDate: day(row.dueDate),
            cadence: row.cadence as PostCloseItemView['cadence'],
            status: row.status as PostCloseItemView['status'],
            note: row.note,
            version: row.version,
          }),
        ),
        members: members.filter((member) => member.status === 'ACTIVE' && !isCounterpartyRole(member.role)).map((member) => ({ userId: member.userId, displayName: member.displayName })),
        canEdit: canWrite(role),
      };
    });
  }

  async updatePostCloseItem(tenant: TenantContext, dealId: string, itemId: string, input: UpdatePostCloseItemInput, requestId: string): Promise<PostCloseView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'post_close.updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      if (input.ownerUserId) {
        const owner = (await dealMemberships.list(tx, dealId)).find((member) => member.userId === input.ownerUserId && member.status === 'ACTIVE');
        if (!owner || isCounterpartyRole(owner.role)) throw new UnprocessableEntityException({ code: 'OWNER_NOT_MEMBER' });
      }
      const { count } = await tx.postCloseItem.updateMany({
        where: { id: itemId, dealId, version: input.expectedVersion },
        data: {
          status: input.status,
          ownerUserId: input.ownerUserId,
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
          cadence: input.cadence,
          note: input.note,
          version: input.expectedVersion + 1,
          updatedBy: tenant.userId,
          updatedAt: new Date(),
        },
      });
      if (count !== 1) {
        if (!(await tx.postCloseItem.findFirst({ where: { id: itemId, dealId }, select: { id: true } }))) throw new NotFoundException();
        throw new ConflictException();
      }
      await this.audit(tx, tenant, dealId, `post_close.${input.status === 'OPEN' ? 'updated' : input.status.toLowerCase()}`, 'post_close_item', itemId, requestId);
    });
    return this.postClose(tenant, dealId, requestId);
  }
}
