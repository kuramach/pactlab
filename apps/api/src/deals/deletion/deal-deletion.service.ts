import { Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { appendAuditEvent, withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deal-access';
import { PRISMA } from '../../tokens';

export const DELETION_STORES = Symbol('DELETION_STORES');

/** Where a deal's uploaded files live: document originals and billing/industry exports. */
export interface DeletionStores {
  readonly documents: { delete(key: string): Promise<void> };
  readonly uploads: { delete(key: string): Promise<void> };
}

/**
 * Delete a deal (deal lead only). Pactlab keeps evidence, findings and the
 * audit trail append-only, so a deal is not erased: its stored files are
 * purged (documents on legal hold are kept), every membership and pending
 * invitation is revoked so nobody can reach it, and it is marked DELETED —
 * one-way, enforced by the database. The deletion itself is audited.
 */
@Injectable()
export class DealDeletionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DELETION_STORES) private readonly stores: DeletionStores,
  ) {}

  async delete(tenant: TenantContext, dealId: string, confirmName: string, requestId: string) {
    // Guests never delete another organization's pact; only its own deal lead can.
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
    await this.access.require(tenant, dealId, (role) => role === 'DEAL_LEAD', { action: 'deal.deleted', requestId });

    const { deal, documents, uploads } = await withTenant(this.prisma, tenant, async (tx) => ({
      deal: await tx.deal.findFirst({ where: { id: dealId }, select: { name: true, status: true } }),
      documents: await tx.document.findMany({ where: { dealId, status: 'AVAILABLE' }, select: { id: true, objectKey: true, retentionClass: true } }),
      uploads: await tx.sourceUpload.findMany({ where: { dealId, status: { not: 'PURGED' } }, select: { id: true, objectKey: true } }),
    }));
    if (!deal || deal.status === 'DELETED') throw new NotFoundException();
    // Typing the name guards against deleting the wrong deal.
    if (confirmName.trim() !== deal.name.trim()) throw new UnprocessableEntityException({ code: 'NAME_MISMATCH' });

    const purge = documents.filter((document) => document.retentionClass !== 'LEGAL_HOLD');
    const kept = documents.length - purge.length;
    // Files first: if storage fails, nothing is marked deleted and the lead can retry.
    try {
      for (const document of purge) await this.stores.documents.delete(document.objectKey);
      for (const upload of uploads) if (upload.objectKey) await this.stores.uploads.delete(upload.objectKey);
    } catch {
      throw new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE' });
    }

    const now = new Date();
    await withTenant(this.prisma, tenant, async (tx) => {
      const ids = purge.map((document) => document.id);
      if (ids.length > 0) {
        await tx.document.updateMany({ where: { dealId, id: { in: ids } }, data: { status: 'PURGED', purgedAt: now } });
        await tx.documentPage.updateMany({ where: { dealId, documentId: { in: ids } }, data: { text: null } });
      }
      if (uploads.length > 0) {
        await tx.sourceUpload.updateMany({ where: { dealId, id: { in: uploads.map((upload) => upload.id) } }, data: { status: 'PURGED', objectKey: null, purgedAt: now } });
      }
      await tx.dealInvitation.updateMany({ where: { dealId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: now } });
      // The audit event is written while the lead still holds the deal.
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'deal.deleted',
        targetType: 'deal',
        targetId: dealId,
        outcome: 'SUCCEEDED',
        requestId,
      });
      await tx.deal.update({ where: { id: dealId }, data: { status: 'DELETED', deletedAt: now, deletedBy: tenant.userId } });
      await tx.dealMembership.updateMany({ where: { dealId }, data: { status: 'REVOKED' } });
    });
    return { id: dealId, status: 'DELETED', filesPurged: purge.length + uploads.filter((upload) => upload.objectKey).length, keptOnLegalHold: kept };
  }
}
