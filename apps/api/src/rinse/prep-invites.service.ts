import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { CreatedPrepInvite, PrepInviteView } from '@pactlab/contracts';
import { afterCursor, appendAuditEvent, toPage, withTenant, type PageResult, type PrismaClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { DealAccess } from '../deals/deal-access';
import { LOGGER, PRISMA } from '../tokens';
import { RINSE_DEPENDENCIES, type RinseDependencies } from './rinse.tokens';

export const PREP_INVITE_DAYS = 14;
export const prepTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The pact's own side invites and binds preparers: manage rights and buyer-side analysis. */
export const canInvitePreparer = (role: DealRole) => {
  const permissions = permissionsForDealRole(role);
  return permissions.has('DEAL_WRITE') && permissions.has('BUYER_ANALYSIS_READ');
};
const canSeeInvites = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');

type InviteRow = { id: string; email: string; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null };
type BindingRow = { id: string; inviteId: string; boundAt: Date; revokedAt: Date | null };

function view(invite: InviteRow, binding: BindingRow | undefined, now: Date): PrepInviteView {
  const state = invite.revokedAt ? 'REVOKED' : invite.acceptedAt ? 'ACCEPTED' : invite.expiresAt <= now ? 'EXPIRED' : 'PENDING';
  return {
    id: invite.id,
    email: invite.email,
    state,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    binding: binding ? { id: binding.id, boundAt: binding.boundAt.toISOString(), revokedAt: binding.revokedAt?.toISOString() ?? null } : null,
  };
}

/**
 * Prep invites (T-178b, ADR 0059), pact side. A link or QR the pact's own side sends a Pactlab Rinse
 * preparer: it creates the preparer's free account and binds it to this pact in one step. A binding
 * gives no membership and no read access, only the right to have a rinsed set accepted here and to run
 * AI rinse jobs counted against this pact. The token is shown once; only its SHA-256 is stored.
 */
@Injectable()
export class PrepInvitesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(RINSE_DEPENDENCIES) private readonly deps: RinseDependencies,
  ) {}

  async create(tenant: TenantContext, dealId: string, email: string, requestId: string): Promise<CreatedPrepInvite> {
    await this.access.require(tenant, dealId, canInvitePreparer, { action: 'rinse.prep_invite_created', requestId });
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const normalized = email.trim().toLowerCase();
    const { invite, inviter, pactName } = await withTenant(this.prisma, tenant, async (tx) => {
      const created = await tx.rinsePrepInvite.create({
        data: { id: newId(), organizationId: tenant.organizationId, dealId, email: normalized, tokenHash: prepTokenHash(token), createdBy: tenant.userId, expiresAt: new Date(now.getTime() + PREP_INVITE_DAYS * 86_400_000) },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'rinse.prep_invite_created', targetType: 'rinse_prep_invite', targetId: created.id, outcome: 'SUCCEEDED', requestId });
      const [user, deal] = await Promise.all([
        tx.user.findFirst({ where: { id: tenant.userId }, select: { displayName: true } }),
        tx.deal.findFirst({ where: { id: dealId }, select: { name: true } }),
      ]);
      return { invite: created, inviter: user?.displayName ?? 'Your counterparty', pactName: deal?.name ?? 'a pact' };
    });
    const link = `${this.deps.siteOrigin}/rinse?invite=${token}`;
    let emailStatus: CreatedPrepInvite['emailStatus'] = 'NOT_SENT';
    if (this.deps.emailSender) {
      try {
        await this.deps.emailSender.send({
          to: normalized,
          subject: `${inviter} asked you to prepare the documents for “${pactName}”`,
          text: [
            `${inviter} asked you to prepare the documents for “${pactName}” with Pactlab Rinse.`,
            `Open the invitation in Pactlab Rinse: ${link}`,
            `Rinse runs on your machine. You get a free preparer account; it does not let you see the pact. The link works once and expires in ${PREP_INVITE_DAYS} days.`,
          ].join('\n'),
          content: {
            heading: `Prepare the documents for “${pactName}”`,
            paragraphs: [`${inviter} asked you to prepare the documents with Pactlab Rinse, on your own machine.`, 'You get a free preparer account. It does not let you see the pact.'],
            action: { label: 'Open in Pactlab Rinse', url: link },
            footnote: `The link works once and expires in ${PREP_INVITE_DAYS} days. If you were not expecting this, ignore this email.`,
          },
        });
        emailStatus = 'SENT';
      } catch (error) {
        // handled: the reply says NOT_SENT, and the page shows the link to send another way
        this.logger.error({ inviteId: invite.id, errorClass: error instanceof Error ? error.name : 'unknown' }, 'prep invite email failed');
      }
    }
    return { invite: view(invite, undefined, now), link, emailStatus };
  }

  async list(tenant: TenantContext, dealId: string, page: { cursor?: string | undefined; limit: number }, requestId: string): Promise<PageResult<PrepInviteView>> {
    await this.access.require(tenant, dealId, canSeeInvites, { action: 'rinse.prep_invites_read', requestId });
    const now = new Date();
    return withTenant(this.prisma, tenant, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.rinsePrepInvite.findMany({ where: { dealId, ...afterCursor('createdAt', page.cursor, { asDate: true }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit + 1 }),
        tx.rinsePrepInvite.count({ where: { dealId } }),
      ]);
      const bindings = await tx.rinsePreparerBinding.findMany({ where: { dealId, inviteId: { in: rows.map((row) => row.id) } }, take: rows.length });
      const byInvite = new Map(bindings.map((binding) => [binding.inviteId, binding]));
      return toPage(rows, page, total, (row) => row.createdAt, (row) => view(row, byInvite.get(row.id), now));
    });
  }

  /** Revoke a pending invite, or end an accepted one's binding: the preparer's sets are refused from then on. */
  async revoke(tenant: TenantContext, dealId: string, inviteId: string, requestId: string): Promise<PrepInviteView> {
    await this.access.require(tenant, dealId, canInvitePreparer, { action: 'rinse.prep_invite_revoked', requestId });
    const now = new Date();
    return withTenant(this.prisma, tenant, async (tx) => {
      const invite = await tx.rinsePrepInvite.findFirst({ where: { id: inviteId, dealId } });
      if (!invite) throw new NotFoundException();
      let binding = await tx.rinsePreparerBinding.findFirst({ where: { inviteId, dealId } });
      if (binding && !binding.revokedAt) {
        binding = await tx.rinsePreparerBinding.update({ where: { id: binding.id }, data: { revokedAt: now, revokedBy: tenant.userId } });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'rinse.preparer_unbound', targetType: 'rinse_preparer_binding', targetId: binding.id, outcome: 'SUCCEEDED', requestId });
        return view(invite, binding, now);
      }
      if (invite.revokedAt || invite.acceptedAt) throw new UnprocessableEntityException({ code: 'PREP_INVITE_CLOSED', message: 'This invite is already closed.' });
      const revoked = await tx.rinsePrepInvite.update({ where: { id: inviteId }, data: { revokedAt: now, revokedBy: tenant.userId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'rinse.prep_invite_revoked', targetType: 'rinse_prep_invite', targetId: inviteId, outcome: 'SUCCEEDED', requestId });
      return view(revoked, binding ?? undefined, now);
    });
  }
}
