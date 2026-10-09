import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { appendAuditEvent, auditEvents, withTenant, type PrismaClient } from '@pactlab/db';
import { permissionsForOrganizationRole, type TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { PRISMA } from '../tokens';

const listAuditQuerySchema = z.strictObject({
  before: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  dealId: z.uuid().optional(),
});
type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export interface AuditEventItem {
  id: string;
  sequence: string;
  occurredAt: string;
  action: string;
  outcome: string;
  targetType: string;
  targetId: string | null;
  dealId: string | null;
  dealName: string | null;
  actorName: string | null;
}

/**
 * The organization's audit trail, newest first, for organization owners and
 * administrators. Reading it is itself audited; denials are recorded too.
 */
@Controller('v1/audit-events')
export class AuditController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Query(new ZodValidationPipe(listAuditQuerySchema)) query: ListAuditQuery,
  ): Promise<{ items: AuditEventItem[]; nextBefore: string | null }> {
    const allowed = permissionsForOrganizationRole(tenant.organizationRole).has('AUDIT_READ');
    const result = await withTenant(this.prisma, tenant, async (tx) => {
      const page = allowed
        ? await auditEvents.list(tx, {
            limit: query.limit,
            ...(query.before ? { before: BigInt(query.before) } : {}),
            ...(query.dealId ? { dealId: query.dealId } : {}),
          })
        : null;
      // Recorded after reading, so a page never lists its own read.
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'audit.read',
        targetType: 'organization',
        targetId: tenant.organizationId,
        outcome: allowed ? 'SUCCEEDED' : 'DENIED',
        requestId,
      });
      return page;
    });
    if (!result) throw new ForbiddenException();
    return {
      items: result.items.map(({ actorUserId: _actor, occurredAt, ...item }) => ({ ...item, occurredAt: occurredAt.toISOString() })),
      nextBefore: result.nextBefore,
    };
  }
}
