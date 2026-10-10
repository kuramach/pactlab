import { Controller, Get, Inject } from '@nestjs/common';
import { withTenant, type PrismaClient } from '@pactlab/db';
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
@Controller('v1/organization')
export class OrganizationController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('members')
  async members(@Tenant() tenant: TenantContext): Promise<{ items: OrganizationMemberView[] }> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.organizationMembership.findMany({
        where: { organizationId: tenant.organizationId, status: 'ACTIVE' },
        select: { userId: true, role: true, user: { select: { displayName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { items: rows.map((row) => ({ userId: row.userId, role: row.role, displayName: row.user.displayName })) };
  }
}
