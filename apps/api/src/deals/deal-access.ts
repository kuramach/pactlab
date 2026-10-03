import { ForbiddenException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { appendAuditEvent, dealMemberships, withTenant, type PrismaClient } from '@pactlab/db';
import {
  permissionsForDealRole,
  type DealRole,
  type Permission,
  type TenantContext,
} from '@pactlab/domain';
import { PRISMA } from '../tokens';

/** A rule over the caller's deal role: a permission name or a predicate. */
export type DealRule = Permission | ((role: DealRole) => boolean);

/**
 * Server-side deal authorization. A deal the caller cannot see and a deal
 * that does not exist are indistinguishable (404); a visible deal without the
 * required permission is 403 and the denial is audited.
 */
@Injectable()
export class DealAccess {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async require(
    tenant: TenantContext,
    dealId: string,
    rule: DealRule,
    audit: { action: string; requestId: string },
  ): Promise<DealRole> {
    const role = tenant.dealIds.includes(dealId as never)
      ? await withTenant(this.prisma, tenant, (tx) =>
          dealMemberships.roleOf(tx, dealId, tenant.userId),
        )
      : null;
    if (!role) throw new NotFoundException();
    const allowed =
      typeof rule === 'function' ? rule(role) : permissionsForDealRole(role).has(rule);
    if (!allowed) {
      await withTenant(this.prisma, tenant, (tx) =>
        appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: audit.action,
          targetType: 'deal',
          targetId: dealId,
          outcome: 'DENIED',
          requestId: audit.requestId,
        }),
      );
      throw new ForbiddenException();
    }
    return role;
  }
}
