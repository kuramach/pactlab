import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Put, Query } from '@nestjs/common';
import { pageQuerySchema, type Page } from '@pactlab/contracts';
import { z } from 'zod';
import { BUYER_PERSONAS, isBuyerPersona, PERSONA_PROFILE, resolvePersona, type BuyerPersona } from '@pactlab/calculations';
import { afterCursor, appendAuditEvent, toPage, withTenant, type PrismaClient } from '@pactlab/db';
import { personaBodySchema } from '../pricing/pricing.schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { PRISMA } from '../tokens';

export interface OrganizationMemberView {
  userId: string;
  displayName: string;
  role: 'ORG_OWNER' | 'ORG_ADMIN' | 'MEMBER';
}

/**
 * People in the caller's organization, so a deal lead can add them to a deal.
 * Names and roles only — never email addresses. RLS limits rows to the
 * current organization.
 */
const membersQuerySchema = pageQuerySchema.extend({ q: z.string().trim().min(1).max(120).optional() }).strict();

@Controller('v1/organization')
export class OrganizationController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** The organization's active members, oldest first, a page at a time (T-126); searched by name or email. */
  @Get('members')
  async members(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(membersQuerySchema)) query: z.infer<typeof membersQuerySchema>): Promise<Page<OrganizationMemberView>> {
    // Guests never see the organization's people (ADR 0014); RLS returns only themselves anyway.
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
    const matching = {
      organizationId: tenant.organizationId,
      status: 'ACTIVE' as const,
      ...(query.q ? { user: { OR: [{ displayName: { contains: query.q, mode: 'insensitive' as const } }, { email: { contains: query.q, mode: 'insensitive' as const } }] } } : {}),
    };
    const [rows, total] = await withTenant(this.prisma, tenant, (tx) =>
      Promise.all([
        tx.organizationMembership.findMany({
          where: { AND: [matching, afterCursor('createdAt', query.cursor, { direction: 'asc', asDate: true })] },
          select: { id: true, createdAt: true, userId: true, role: true, user: { select: { displayName: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: query.limit + 1,
        }),
        tx.organizationMembership.count({ where: matching }),
      ]),
    );
    return toPage(rows, query, total, (row) => row.createdAt, (row) => ({ userId: row.userId, role: row.role, displayName: row.user.displayName }));
  }

  /** The buyer persona new pacts price under (T-105). Members read it; guests never do. */
  @Get('persona')
  async persona(@Tenant() tenant: TenantContext) {
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
    const row = await withTenant(this.prisma, tenant, (tx) => tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { defaultPersona: true } }));
    const defaultPersona = isBuyerPersona(row?.defaultPersona) ? row.defaultPersona : null;
    return {
      defaultPersona,
      effective: resolvePersona(null, defaultPersona),
      canEdit: tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN',
      options: BUYER_PERSONAS.map((persona) => ({ persona, label: PERSONA_PROFILE[persona].label, descriptor: PERSONA_PROFILE[persona].descriptor, icon: PERSONA_PROFILE[persona].icon, caption: PERSONA_PROFILE[persona].caption })),
    };
  }

  /** Organization owners and admins set the default; the database checks the role again. */
  @Put('persona')
  async setPersona(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(personaBodySchema)) body: { persona: BuyerPersona | null },
  ) {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.organization.update({ where: { id: tenant.organizationId }, data: { defaultPersona: body.persona } });
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId: null,
        actorUserId: tenant.userId,
        action: 'persona.default_changed',
        targetType: 'organization',
        targetId: tenant.organizationId,
        outcome: 'SUCCEEDED',
        requestId,
      });
    });
    return this.persona(tenant);
  }
}
