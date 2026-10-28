import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { appendAuditEvent, invitationLinks, withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { DealAccess } from '../deals/deal-access';
import type { EmailSender } from '../email-login/email-sender';
import { emails } from '../email-login/emails';
import { LOGGER, PRISMA } from '../tokens';
import type { CreateInvitationBody, InvitationPreview, InvitationView } from './invitations.schemas';

export const INVITATIONS = Symbol('INVITATIONS');
export interface InvitationDependencies {
  readonly emailSender: EmailSender;
  /** The web app's origin, for the link in the email. */
  readonly appOrigin: string;
}

const VALID_DAYS = 14;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const status = (row: { status: string; expiresAt: Date }): InvitationView['status'] => (row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : (row.status as InvitationView['status']));

/**
 * Invitations to one pact (T-094 B12, ADR 0014). The pact's lead invites by
 * email with a side and role. A colleague already in this organization is
 * added directly; anyone else gets a link and, on accepting, becomes a guest
 * on this pact only — never a member of this organization. Tokens are random
 * and stored as hashes; links expire after 14 days.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(INVITATIONS) private readonly deps: InvitationDependencies,
  ) {}

  private requireMember(tenant: TenantContext) {
    // Guests cannot invite: only the pact owner's own team manages its people.
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
  }

  async list(tenant: TenantContext, dealId: string, requestId: string): Promise<{ items: InvitationView[] }> {
    this.requireMember(tenant);
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', { action: 'deal.invitations.list', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const rows = await tx.dealInvitation.findMany({ where: { dealId }, orderBy: { createdAt: 'desc' } });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.invitedBy))] } }, select: { id: true, displayName: true } });
      const names = new Map(users.map((user) => [user.id, user.displayName]));
      return {
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          side: row.side as InvitationView['side'],
          role: row.role,
          status: status(row),
          invitedByName: names.get(row.invitedBy) ?? null,
          expiresAt: row.expiresAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async create(tenant: TenantContext, dealId: string, body: CreateInvitationBody, requestId: string): Promise<{ kind: 'ADDED' | 'INVITED' }> {
    this.requireMember(tenant);
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', { action: 'deal.invitation.created', requestId });
    const result = await withTenant(this.prisma, tenant, async (tx) => {
      // A colleague in this organization joins directly, on the buyer side only.
      const colleague = await tx.organizationMembership.findFirst({
        where: { organizationId: tenant.organizationId, status: 'ACTIVE', user: { email: body.email } },
        select: { userId: true },
      });
      if (colleague) {
        if (body.side !== 'BUYER') throw new UnprocessableEntityException({ code: 'COLLEAGUE_IS_BUYER_SIDE' });
        await tx.dealMembership.upsert({
          where: { organizationId_dealId_userId: { organizationId: tenant.organizationId, dealId, userId: colleague.userId } },
          create: { organizationId: tenant.organizationId, dealId, userId: colleague.userId, role: body.role },
          update: { role: body.role, status: 'ACTIVE' },
        });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'deal.member.added', targetType: 'user', targetId: colleague.userId, outcome: 'SUCCEEDED', requestId });
        return { kind: 'ADDED' as const };
      }
      const pending = await tx.dealInvitation.findFirst({ where: { dealId, email: body.email, status: 'PENDING', expiresAt: { gt: new Date() } } });
      if (pending) throw new ConflictException({ code: 'ALREADY_INVITED' });
      const token = randomBytes(32).toString('base64url');
      const invitation = await tx.dealInvitation.create({
        data: { organizationId: tenant.organizationId, dealId, email: body.email, side: body.side, role: body.role, tokenHash: hashToken(token), invitedBy: tenant.userId, expiresAt: new Date(Date.now() + VALID_DAYS * 86_400_000) },
      });
      const [deal, inviter] = await Promise.all([
        tx.deal.findFirst({ where: { id: dealId }, select: { name: true } }),
        tx.user.findFirst({ where: { id: tenant.userId }, select: { displayName: true } }),
      ]);
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'deal.invitation.created', targetType: 'deal_invitation', targetId: invitation.id, outcome: 'SUCCEEDED', requestId });
      return { kind: 'INVITED' as const, token, dealName: deal?.name ?? 'a pact', inviterName: inviter?.displayName ?? 'A colleague' };
    });
    if (result.kind === 'INVITED') {
      const link = new URL(`/invite/${result.token}`, this.deps.appOrigin).toString();
      void this.deps.emailSender.send(emails.dealInvitation(body.email, { inviterName: result.inviterName, dealName: result.dealName, side: body.side, role: body.role, link, days: VALID_DAYS })).catch((error: unknown) => {
        // Never log the link or the address.
        this.logger.error({ requestId, errorClass: error instanceof Error ? error.name : 'unknown' }, 'invitation email delivery failed');
      });
    }
    return { kind: result.kind };
  }

  async revoke(tenant: TenantContext, dealId: string, invitationId: string, requestId: string): Promise<void> {
    this.requireMember(tenant);
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', { action: 'deal.invitation.revoked', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const { count } = await tx.dealInvitation.updateMany({ where: { id: invitationId, dealId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      if (count !== 1) throw new NotFoundException();
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'deal.invitation.revoked', targetType: 'deal_invitation', targetId: invitationId, outcome: 'SUCCEEDED', requestId });
    });
  }

  /** What an invitation link shows before sign-in; unknown tokens are 404. */
  async preview(token: string): Promise<InvitationPreview> {
    const row = await invitationLinks.preview(this.prisma, hashToken(token));
    if (!row) throw new NotFoundException();
    return { ...row, status: row.status as InvitationPreview['status'], expiresAt: row.expiresAt.toISOString() };
  }

  /** The signed-in user accepts: their own address must match. Returns where to switch the session. */
  async accept(tenant: TenantContext, token: string, requestId: string): Promise<{ organizationId: string; dealId: string }> {
    const accepted = await invitationLinks.accept(this.prisma, hashToken(token), tenant.userId);
    // Wrong address, expired, revoked or already used: one answer, nothing revealed.
    if (!accepted) throw new UnprocessableEntityException({ code: 'INVITATION_NOT_ACCEPTED' });
    // Audited in the pact's own chain, as the new guest on it.
    const guest: TenantContext = { organizationId: accepted.organizationId as TenantContext['organizationId'], userId: tenant.userId, organizationRole: 'GUEST', dealIds: [accepted.dealId as TenantContext['dealIds'][number]] };
    await withTenant(this.prisma, guest, (tx) =>
      appendAuditEvent(tx, { organizationId: accepted.organizationId, dealId: accepted.dealId, actorUserId: tenant.userId, action: 'deal.invitation_accepted', targetType: 'deal_invitation', targetId: accepted.invitationId, outcome: 'SUCCEEDED', requestId }),
    );
    return { organizationId: accepted.organizationId, dealId: accepted.dealId };
  }
}
