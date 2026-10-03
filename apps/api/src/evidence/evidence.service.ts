import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { appendAuditEvent, evidence, withTenant, type PrismaClient } from '@pactlab/db';
import {
  canBrowseEvidence,
  type EvidenceItemView,
  type EvidenceLineage,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import type { ListEvidenceQuery } from './evidence.schemas';

/** Evidence reads. RLS additionally hides buyer-only rows from target contributors. */
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async list(tenant: TenantContext, dealId: string, query: ListEvidenceQuery, requestId: string) {
    await this.access.require(tenant, dealId, canBrowseEvidence, {
      action: 'evidence.list',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => ({
      ...(await evidence.list(tx, dealId, {
        evidenceType: query.type,
        connectionId: query.connectionId,
        visibility: query.visibility,
        sourceRecordId: query.recordId,
        after: query.cursor,
        limit: query.limit,
      })),
      types: await evidence.types(tx, dealId),
    }));
  }

  async get(
    tenant: TenantContext,
    dealId: string,
    evidenceId: string,
    requestId: string,
  ): Promise<EvidenceItemView> {
    await this.access.require(tenant, dealId, canBrowseEvidence, {
      action: 'evidence.viewed',
      requestId,
    });
    const item = await withTenant(this.prisma, tenant, (tx) =>
      evidence.get(tx, dealId, evidenceId),
    );
    if (!item) throw new NotFoundException();
    return item;
  }

  /** Evidence views are audited. */
  async lineage(
    tenant: TenantContext,
    dealId: string,
    evidenceId: string,
    requestId: string,
  ): Promise<EvidenceLineage> {
    await this.access.require(tenant, dealId, canBrowseEvidence, {
      action: 'evidence.viewed',
      requestId,
    });
    const lineage = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await evidence.lineage(tx, dealId, evidenceId);
      if (found) {
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'evidence.viewed',
          targetType: 'evidence',
          targetId: evidenceId,
          outcome: 'ALLOWED',
          requestId,
        });
      }
      return found;
    });
    if (!lineage) throw new NotFoundException();
    return lineage;
  }

  /** Only a deal lead explicitly shares an item across the contributor boundary. */
  async share(
    tenant: TenantContext,
    dealId: string,
    evidenceId: string,
    requestId: string,
  ): Promise<EvidenceItemView> {
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', {
      action: 'evidence.shared',
      requestId,
    });
    const item = await withTenant(this.prisma, tenant, async (tx) => {
      const shared = await evidence.share(tx, dealId, evidenceId, tenant.userId);
      if (shared) {
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'evidence.shared',
          targetType: 'evidence',
          targetId: evidenceId,
          outcome: 'SUCCEEDED',
          requestId,
        });
      }
      return shared;
    });
    if (!item) throw new NotFoundException();
    return item;
  }
}
