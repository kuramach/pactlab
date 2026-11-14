import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { IcSettingsView, IcSubmissionView, IcView } from '@pactlab/contracts';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { ReportsService } from '../reports/reports.service';
import { closingFinancing } from '../financing/financing-state';
import { PRISMA } from '../tokens';
import { IC_STATE_LABELS, icStatus } from './ic-state';
import type { IcDecisionInput } from './ic.schemas';

const COMMITTEE: DealRole = 'INVESTMENT_COMMITTEE';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const isLead = (role: DealRole) => role === 'DEAL_LEAD';
const isTeam = (role: DealRole) => role === 'DEAL_LEAD' || role === 'ANALYST';
const isCommittee = (role: DealRole) => role === COMMITTEE;
const isOrgAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';

/**
 * The investment committee decides the deal (T-118, ADR 0029). The deal lead submits an IC pack
 * (a versioned report, T-110); a committee member records one decision on it; conditions are
 * addressed by the team and, if the organization asks, cleared by the committee. When the pact
 * requires it, signing waits for approval (CloseService). Buyer side only, enforced by RLS.
 */
@Injectable()
export class IcService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string | null, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<IcView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'ic.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const status = await icStatus(tx, tenant.organizationId, dealId);
      const [deal, organization, submissions, decisions, conditions, pactCommittee, orgCommittee] = await Promise.all([
        tx.deal.findUnique({ where: { id: dealId }, select: { icApprovalRequired: true } }),
        tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { icApprovalRequired: true } }),
        tx.icSubmission.findMany({ where: { dealId }, orderBy: { submittedAt: 'desc' } }),
        tx.icDecision.findMany({ where: { dealId } }),
        tx.icCondition.findMany({ where: { dealId }, orderBy: { ordinal: 'asc' } }),
        tx.dealMembership.findMany({ where: { dealId, status: 'ACTIVE', role: COMMITTEE }, select: { userId: true } }),
        tx.organizationMembership.findMany({ where: { organizationId: tenant.organizationId, status: 'ACTIVE', investmentCommittee: true }, select: { userId: true } }),
      ]);
      const versions = await tx.reportVersion.findMany({ where: { id: { in: submissions.map((row) => row.reportVersionId) } }, select: { id: true, version: true, status: true } });
      const ids = [...new Set([...submissions.map((row) => row.submittedBy), ...decisions.map((row) => row.decidedBy), ...conditions.flatMap((row) => [row.addressedBy, row.clearedBy]), ...pactCommittee.map((row) => row.userId), ...orgCommittee.map((row) => row.userId)].filter((id): id is string => Boolean(id)))];
      const names = new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName]));
      const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
      const latest = submissions[0];
      const latestDecided = latest ? decisions.some((row) => row.submissionId === latest.id) : true;
      const orgIds = new Set(orgCommittee.map((row) => row.userId));
      const view: IcView = {
        state: status.state,
        required: status.required,
        requirement: { pact: deal?.icApprovalRequired ?? null, organization: organization?.icApprovalRequired ?? false },
        clearsConditions: status.clearsConditions,
        committee: [
          ...orgCommittee.map((row) => ({ userId: row.userId, name: name(row.userId) ?? 'A committee member', source: 'ORGANIZATION' as const })),
          ...pactCommittee.filter((row) => !orgIds.has(row.userId)).map((row) => ({ userId: row.userId, name: name(row.userId) ?? 'A committee member', source: 'PACT' as const })),
        ],
        submissions: submissions.map((submission): IcSubmissionView => {
          const decision = decisions.find((row) => row.submissionId === submission.id) ?? null;
          const version = versions.find((row) => row.id === submission.reportVersionId);
          return {
            id: submission.id,
            version: version?.version ?? 0,
            reportId: submission.reportVersionId,
            reportStatus: version?.status ?? 'GENERATING',
            submittedByName: name(submission.submittedBy),
            submittedAt: submission.submittedAt.toISOString(),
            decision: decision ? { decision: decision.decision as 'APPROVE' | 'APPROVE_WITH_CONDITIONS' | 'DECLINE', note: decision.note, decidedByName: name(decision.decidedBy), decidedAt: decision.decidedAt.toISOString() } : null,
            conditions: decision
              ? conditions
                  .filter((row) => row.decisionId === decision.id)
                  .map((row) => ({
                    id: row.id,
                    text: row.text,
                    status: row.status as 'OPEN' | 'ADDRESSED' | 'CLEARED',
                    addressedByName: name(row.addressedBy),
                    addressedAt: row.addressedAt?.toISOString() ?? null,
                    addressedNote: row.addressedNote,
                    clearedByName: name(row.clearedBy),
                    clearedAt: row.clearedAt?.toISOString() ?? null,
                  }))
              : [],
          };
        }),
        canSubmit: isLead(role) && latestDecided,
        canDecide: isCommittee(role) && !latestDecided,
        canAddress: isTeam(role),
        canClear: isCommittee(role) && status.clearsConditions,
        canSetRequirement: isLead(role),
      };
      return view;
    });
  }

  /** What the committee should know is still open: carried into the pack's first page. */
  private async blockers(tx: TransactionClient, dealId: string): Promise<string[]> {
    const [inReview, openConditions, agreed, financing] = await Promise.all([
      tx.finding.count({ where: { dealId, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
      tx.icCondition.findMany({ where: { dealId, status: 'OPEN' }, select: { text: true } }),
      tx.termProposalBatch.findFirst({ where: { dealId, agreedAt: { not: null } }, select: { id: true } }),
      closingFinancing(tx, dealId, 'BUYER'),
    ]);
    return [
      ...(inReview > 0 ? [`${inReview} finding${inReview === 1 ? '' : 's'} still in review`] : []),
      ...(agreed ? [] : ['Terms not yet agreed with the seller']),
      ...openConditions.map((condition) => `Earlier IC condition still open: ${condition.text}`),
      // How the deal is funded (T-117): the committee sees the same gaps that would hold up close.
      ...(financing?.posture.blockers ?? []).map((blocker) => `Financing: ${blocker}`),
    ];
  }

  /**
   * Submit the pact to the committee: a new IC pack version, the organization's committee seated on
   * the pact, and the submission recorded. One open submission at a time.
   */
  async submit(tenant: TenantContext, dealId: string, requestId: string): Promise<IcView> {
    await this.access.require(tenant, dealId, isLead, { action: 'ic.submitted', requestId });
    const blockers = await withTenant(this.prisma, tenant, async (tx) => {
      const latest = await tx.icSubmission.findFirst({ where: { dealId }, orderBy: { submittedAt: 'desc' } });
      if (latest && !(await tx.icDecision.findUnique({ where: { submissionId: latest.id } }))) throw new ConflictException({ code: 'IC_AWAITING_DECISION' });
      const committee = await tx.organizationMembership.findMany({ where: { organizationId: tenant.organizationId, status: 'ACTIVE', investmentCommittee: true }, select: { userId: true } });
      const members = await tx.dealMembership.findMany({ where: { dealId }, select: { userId: true } });
      const seated = new Set(members.map((row) => row.userId));
      for (const { userId } of committee) {
        if (seated.has(userId)) continue;
        await tx.dealMembership.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, userId, role: COMMITTEE } });
        await this.audit(tx, tenant, dealId, 'ic.member_seated', 'user', userId, requestId);
      }
      return this.blockers(tx, dealId);
    });
    const pack = await this.reports.generate(tenant, 'IC', dealId, requestId, { icBlockers: blockers });
    await withTenant(this.prisma, tenant, async (tx) => {
      const submission = await tx.icSubmission.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, reportVersionId: pack.id, submittedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'ic.submitted', 'ic_submission', submission.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** A committee member decides the latest submission, once. */
  async decide(tenant: TenantContext, dealId: string, submissionId: string, input: IcDecisionInput, requestId: string): Promise<IcView> {
    await this.access.require(tenant, dealId, isCommittee, { action: 'ic.decided', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const latest = await tx.icSubmission.findFirst({ where: { dealId }, orderBy: { submittedAt: 'desc' } });
      if (!latest || latest.id !== submissionId) throw new ConflictException({ code: 'IC_NOT_LATEST' });
      if (await tx.icDecision.findUnique({ where: { submissionId } })) throw new ConflictException({ code: 'IC_ALREADY_DECIDED' });
      const decision = await tx.icDecision.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, submissionId, decision: input.decision, note: input.note, decidedBy: tenant.userId } });
      for (const [ordinal, text] of input.conditions.entries()) {
        await tx.icCondition.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, decisionId: decision.id, ordinal, text } });
      }
      await this.audit(tx, tenant, dealId, 'ic.decided', 'ic_decision', decision.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async address(tenant: TenantContext, dealId: string, conditionId: string, note: string | null, requestId: string): Promise<IcView> {
    await this.access.require(tenant, dealId, isTeam, { action: 'ic.condition_addressed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const condition = await tx.icCondition.findFirst({ where: { id: conditionId, dealId } });
      if (!condition) throw new NotFoundException();
      if (condition.status !== 'OPEN') throw new ConflictException('Already addressed');
      await tx.icCondition.update({ where: { id: conditionId }, data: { status: 'ADDRESSED', addressedBy: tenant.userId, addressedAt: new Date(), addressedNote: note } });
      await this.audit(tx, tenant, dealId, 'ic.condition_addressed', 'ic_condition', conditionId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async clear(tenant: TenantContext, dealId: string, conditionId: string, requestId: string): Promise<IcView> {
    await this.access.require(tenant, dealId, isCommittee, { action: 'ic.condition_cleared', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const condition = await tx.icCondition.findFirst({ where: { id: conditionId, dealId } });
      if (!condition) throw new NotFoundException();
      if (condition.status === 'CLEARED') throw new ConflictException('Already cleared');
      await tx.icCondition.update({ where: { id: conditionId }, data: { status: 'CLEARED', clearedBy: tenant.userId, clearedAt: new Date() } });
      await this.audit(tx, tenant, dealId, 'ic.condition_cleared', 'ic_condition', conditionId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The deal lead overrides the organization's requirement for this pact (null follows it). */
  async setRequirement(tenant: TenantContext, dealId: string, required: boolean | null, requestId: string): Promise<IcView> {
    await this.access.require(tenant, dealId, isLead, { action: 'ic.requirement_set', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.deal.update({ where: { id: dealId }, data: { icApprovalRequired: required } });
      await this.audit(tx, tenant, dealId, 'ic.requirement_set', 'deal', dealId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The signing gate (CloseService): refuse when approval is required and not yet given. */
  async requireApproval(tx: TransactionClient, tenant: TenantContext, dealId: string): Promise<void> {
    const status = await icStatus(tx, tenant.organizationId, dealId);
    if (!status.satisfied) throw new UnprocessableEntityException({ code: 'IC_APPROVAL_REQUIRED', message: `Investment committee approval is required before signing (${IC_STATE_LABELS[status.state]}).` });
  }

  // --- Organization settings: the committee list and the default requirement ---------------

  async settings(tenant: TenantContext): Promise<IcSettingsView> {
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
    return withTenant(this.prisma, tenant, async (tx) => {
      const [organization, members] = await Promise.all([
        tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { icApprovalRequired: true, icClearsConditions: true } }),
        tx.organizationMembership.findMany({ where: { organizationId: tenant.organizationId, status: 'ACTIVE' }, select: { userId: true, role: true, investmentCommittee: true, user: { select: { displayName: true } } }, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        required: organization?.icApprovalRequired ?? false,
        clearsConditions: organization?.icClearsConditions ?? false,
        members: members.map((row) => ({ userId: row.userId, name: row.user.displayName, role: row.role, investmentCommittee: row.investmentCommittee })),
        canEdit: isOrgAdmin(tenant),
      };
    });
  }

  async saveSettings(tenant: TenantContext, input: { required: boolean; clearsConditions: boolean }, requestId: string): Promise<IcSettingsView> {
    if (!isOrgAdmin(tenant)) throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.organization.update({ where: { id: tenant.organizationId }, data: { icApprovalRequired: input.required, icClearsConditions: input.clearsConditions, updatedAt: new Date() } });
      await this.audit(tx, tenant, null, 'org.ic_settings_changed', 'organization', tenant.organizationId, requestId);
    });
    return this.settings(tenant);
  }

  async setMember(tenant: TenantContext, userId: string, member: boolean, requestId: string): Promise<IcSettingsView> {
    if (!isOrgAdmin(tenant)) throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      const { count } = await tx.organizationMembership.updateMany({ where: { organizationId: tenant.organizationId, userId, status: 'ACTIVE' }, data: { investmentCommittee: member } });
      if (count === 0) throw new NotFoundException();
      await this.audit(tx, tenant, null, 'org.ic_member_set', 'user', userId, requestId);
    });
    return this.settings(tenant);
  }
}
