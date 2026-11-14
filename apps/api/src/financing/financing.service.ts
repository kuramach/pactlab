import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { rank, type TrancheStatus } from '@pactlab/calculations';
import type { FinancingView } from '@pactlab/contracts';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { isCounterpartyRole, newId, permissionsForDealRole, tenantObjectKey, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import type { DocumentObjectStore } from '../documents/documents.repository';
import { UploadRejectedError, validateUpload, type MalwareScanner } from '../documents/upload-policy';
import { PRISMA } from '../tokens';
import { financingPlans, type Reader } from './financing-state';
import type { DepositBody, EscrowBody, FinancingDocumentBody, PlanBody, TrancheBody } from './financing.schemas';

export const FINANCING_FILES = Symbol('FINANCING_FILES');
export interface FinancingFiles {
  readonly objectStore: DocumentObjectStore;
  readonly scanner: MalwareScanner;
}

const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE');

interface Who {
  role: DealRole;
  reader: Reader | null;
  /** The bid this person buys through (seller-led pacts). */
  bidId: string | null;
  canEdit: boolean;
}

/**
 * Buyer financing (T-117, ADR 0033): the buyer maintains how they fund the deal; the seller sees
 * structure, status, coverage and the documents the buyer shared. Buyer-attested throughout.
 * Row-level security keeps each bidder to their own plan, and unshared documents to the buyer.
 */
@Injectable()
export class FinancingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FINANCING_FILES) private readonly files: FinancingFiles,
  ) {}

  private async who(tenant: TenantContext, dealId: string, action: string, requestId: string): Promise<Who> {
    const role = await this.access.require(tenant, dealId, canRead, { action, requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { initiatedBy: true } });
      if (deal?.initiatedBy === 'SELLER') {
        if (role === 'BIDDER') {
          const membership = await tx.dealMembership.findFirst({ where: { dealId, userId: tenant.userId, status: 'ACTIVE' }, select: { bidId: true } });
          return { role, reader: 'BUYER' as const, bidId: membership?.bidId ?? null, canEdit: Boolean(membership?.bidId) };
        }
        return { role, reader: isCounterpartyRole(role) ? null : ('SELLER' as const), bidId: null, canEdit: false };
      }
      if (role === 'TARGET_CONTRIBUTOR') return { role, reader: 'SELLER' as const, bidId: null, canEdit: false };
      return { role, reader: isCounterpartyRole(role) ? null : ('BUYER' as const), bidId: null, canEdit: !isCounterpartyRole(role) && canWrite(role) };
    });
  }

  private async buyer(tenant: TenantContext, dealId: string, action: string, requestId: string): Promise<Who> {
    const who = await this.who(tenant, dealId, action, requestId);
    if (who.reader !== 'BUYER' || !who.canEdit) {
      await withTenant(this.prisma, tenant, (tx) => this.audit(tx, tenant, dealId, action, 'deal', dealId, requestId, 'DENIED'));
      throw new ForbiddenException('The buyer maintains their financing');
    }
    return who;
  }

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string, outcome: 'SUCCEEDED' | 'DENIED' | 'ALLOWED' = 'SUCCEEDED') {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome, requestId });
  }

  /** The buyer's own plan, created on first write. */
  private async ownPlan(tx: TransactionClient, tenant: TenantContext, dealId: string, who: Who) {
    const existing = await tx.financingPlan.findFirst({ where: { dealId, bidId: who.bidId } });
    if (existing) return existing;
    return tx.financingPlan.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, bidId: who.bidId, createdBy: tenant.userId, updatedBy: tenant.userId } });
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<FinancingView> {
    const who = await this.who(tenant, dealId, 'financing.viewed', requestId);
    if (!who.reader) return { side: null, canEdit: false, plans: [] };
    const plans = await withTenant(this.prisma, tenant, (tx) => financingPlans(tx, dealId, who.reader as Reader, who.bidId));
    return { side: who.reader, canEdit: who.canEdit, plans };
  }

  async updatePlan(tenant: TenantContext, dealId: string, body: PlanBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.plan_updated', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const plan = await this.ownPlan(tx, tenant, dealId, who);
      await tx.financingPlan.update({ where: { id: plan.id }, data: { commitmentExpectedBy: body.commitmentExpectedBy ? new Date(`${body.commitmentExpectedBy}T00:00:00Z`) : null, buyerNote: body.buyerNote, updatedBy: tenant.userId, updatedAt: new Date() } });
      await this.audit(tx, tenant, dealId, 'financing.plan_updated', 'financing_plan', plan.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async addTranche(tenant: TenantContext, dealId: string, body: TrancheBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.tranche_added', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const plan = await this.ownPlan(tx, tenant, dealId, who);
      const count = await tx.financingTranche.count({ where: { planId: plan.id } });
      if (count >= 12) throw new UnprocessableEntityException({ code: 'FINANCING_TOO_MANY_TRANCHES' });
      const last = await tx.financingTranche.findFirst({ where: { planId: plan.id }, orderBy: { ordinal: 'desc' }, select: { ordinal: true } });
      const id = newId();
      await tx.financingTranche.create({ data: { id, organizationId: tenant.organizationId, dealId, planId: plan.id, ordinal: (last?.ordinal ?? -1) + 1, ...body, updatedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'financing.tranche_added', 'financing_tranche', id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async ownTranche(tx: TransactionClient, tenant: TenantContext, dealId: string, who: Who, trancheId: string) {
    const plan = await this.ownPlan(tx, tenant, dealId, who);
    const tranche = await tx.financingTranche.findFirst({ where: { id: trancheId, planId: plan.id } });
    if (!tranche) throw new NotFoundException();
    return tranche;
  }

  async updateTranche(tenant: TenantContext, dealId: string, trancheId: string, body: TrancheBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.tranche_updated', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const tranche = await this.ownTranche(tx, tenant, dealId, who, trancheId);
      await tx.financingTranche.update({ where: { id: tranche.id }, data: { ...body, updatedBy: tenant.userId, updatedAt: new Date() } });
      // Status moves are audited on their own: they are what the seller relies on.
      const moved = tranche.status !== body.status ? `financing.tranche_${rank(body.status as TrancheStatus) > rank(tranche.status as TrancheStatus) ? 'advanced' : 'stepped_back'}` : 'financing.tranche_updated';
      await this.audit(tx, tenant, dealId, moved, 'financing_tranche', tranche.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async removeTranche(tenant: TenantContext, dealId: string, trancheId: string, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.tranche_removed', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const tranche = await this.ownTranche(tx, tenant, dealId, who, trancheId);
      await tx.financingTranche.delete({ where: { id: tranche.id } });
      await this.audit(tx, tenant, dealId, 'financing.tranche_removed', 'financing_tranche', tranche.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** A financing document: scanned like any upload, kept buyer-only until the buyer shares it. */
  async attach(tenant: TenantContext, dealId: string, body: FinancingDocumentBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.document_attached', requestId);
    let validated;
    try {
      validated = await validateUpload(body, this.files.scanner);
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) throw error;
      if (error.reason === 'TOO_LARGE') throw new PayloadTooLargeException();
      if (error.reason === 'UNSUPPORTED_TYPE' || error.reason === 'TYPE_MISMATCH') throw new UnsupportedMediaTypeException();
      if (error.reason === 'SCAN_UNAVAILABLE') throw new ServiceUnavailableException();
      if (error.reason === 'MALWARE') throw new UnprocessableEntityException({ code: 'UPLOAD_MALWARE' });
      throw new BadRequestException();
    }
    const id = newId();
    const plan = await withTenant(this.prisma, tenant, async (tx) => {
      const own = await this.ownPlan(tx, tenant, dealId, who);
      if (body.trancheId && !(await tx.financingTranche.findFirst({ where: { id: body.trancheId, planId: own.id }, select: { id: true } }))) throw new NotFoundException();
      return own;
    });
    const objectKey = tenantObjectKey(tenant.organizationId, dealId, 'financing', plan.id, id);
    await this.files.objectStore.put(objectKey, validated.bytes, { contentType: validated.contentType, sha256: validated.sha256 });
    try {
      await withTenant(this.prisma, tenant, async (tx) => {
        await tx.financingDocument.create({
          data: { id, organizationId: tenant.organizationId, dealId, planId: plan.id, trancheId: body.trancheId, purpose: body.purpose, fileName: validated.fileName, contentType: validated.contentType, byteSize: validated.bytes.length, sha256: validated.sha256, objectKey, uploadedBy: tenant.userId },
        });
        await this.audit(tx, tenant, dealId, 'financing.document_attached', 'financing_document', id, requestId);
      });
    } catch (error) {
      await this.files.objectStore.delete(objectKey);
      throw error;
    }
    return this.view(tenant, dealId, requestId);
  }

  /** Share a document with the seller, or take it back. Per document; every change audited. */
  async share(tenant: TenantContext, dealId: string, documentId: string, shared: boolean, requestId: string) {
    const who = await this.buyer(tenant, dealId, shared ? 'financing.document_shared' : 'financing.document_unshared', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const plan = await this.ownPlan(tx, tenant, dealId, who);
      const document = await tx.financingDocument.findFirst({ where: { id: documentId, planId: plan.id } });
      if (!document) throw new NotFoundException();
      if (!shared && (await tx.financingEscrow.findFirst({ where: { planId: plan.id, proofDocumentId: documentId, status: 'DEPOSITED' }, select: { planId: true } }))) {
        throw new UnprocessableEntityException({ code: 'FINANCING_PROOF_IN_USE' });
      }
      await tx.financingDocument.update({ where: { id: documentId }, data: shared ? { sharedAt: new Date(), sharedBy: tenant.userId } : { sharedAt: null, sharedBy: null } });
      await this.audit(tx, tenant, dealId, shared ? 'financing.document_shared' : 'financing.document_unshared', 'financing_document', documentId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** A document: the buyer's own, or a shared one for the seller (row-level security decides). Read audited. */
  async download(tenant: TenantContext, dealId: string, documentId: string, requestId: string) {
    const who = await this.who(tenant, dealId, 'financing.document_read', requestId);
    if (!who.reader) throw new NotFoundException();
    const document = await withTenant(this.prisma, tenant, (tx) => tx.financingDocument.findFirst({ where: { id: documentId, dealId } }));
    if (!document || (who.reader === 'SELLER' && !document.sharedAt)) throw new NotFoundException();
    let bytes: Uint8Array;
    try {
      bytes = await this.files.objectStore.get(document.objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256) throw new ConflictException();
    await withTenant(this.prisma, tenant, (tx) => this.audit(tx, tenant, dealId, 'financing.document_read', 'financing_document', documentId, requestId, 'ALLOWED'));
    return { bytes, contentType: document.contentType, fileName: document.fileName };
  }

  // --- Earnest money ------------------------------------------------------------------------

  async setEscrow(tenant: TenantContext, dealId: string, body: EscrowBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.escrow_committed', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const plan = await this.ownPlan(tx, tenant, dealId, who);
      const existing = await tx.financingEscrow.findUnique({ where: { planId: plan.id } });
      // Once deposited, the terms of the deposit are what the seller confirmed: they no longer change.
      if (existing && existing.status !== 'COMMITTED' && existing.status !== 'NOT_COMMITTED') throw new UnprocessableEntityException({ code: 'FINANCING_ESCROW_DEPOSITED' });
      const data = {
        amount: body.amount,
        currency: body.currency,
        holderKind: body.holderKind,
        holderName: body.holderName,
        depositDueOn: body.depositDueOn ? new Date(`${body.depositDueOn}T00:00:00Z`) : null,
        hardOn: body.hardOn ? new Date(`${body.hardOn}T00:00:00Z`) : null,
        refundConditions: body.refundConditions,
        status: 'COMMITTED',
        updatedBy: tenant.userId,
        updatedAt: new Date(),
      };
      await tx.financingEscrow.upsert({ where: { planId: plan.id }, create: { planId: plan.id, organizationId: tenant.organizationId, dealId, ...data }, update: data });
      await this.audit(tx, tenant, dealId, 'financing.escrow_committed', 'financing_plan', plan.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The buyer records the deposit, like the closing payment (ADR 0022): date, reference, optional shared proof. */
  async recordDeposit(tenant: TenantContext, dealId: string, body: DepositBody, requestId: string) {
    const who = await this.buyer(tenant, dealId, 'financing.escrow_deposited', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const plan = await this.ownPlan(tx, tenant, dealId, who);
      const escrow = await tx.financingEscrow.findUnique({ where: { planId: plan.id } });
      if (!escrow || escrow.status !== 'COMMITTED') throw new ConflictException('Commit the deposit first');
      if (body.proofDocumentId && !(await tx.financingDocument.findFirst({ where: { id: body.proofDocumentId, planId: plan.id, sharedAt: { not: null } }, select: { id: true } }))) {
        throw new UnprocessableEntityException({ code: 'FINANCING_PROOF_NOT_SHARED' });
      }
      await tx.financingEscrow.update({
        where: { planId: plan.id },
        data: { status: 'DEPOSITED', depositedOn: new Date(`${body.depositedOn}T00:00:00Z`), depositReference: body.reference, proofDocumentId: body.proofDocumentId, depositRecordedBy: tenant.userId, depositRecordedAt: new Date(), disputedAt: null, disputeNote: null, confirmedAt: null, confirmedBy: null, updatedBy: tenant.userId, updatedAt: new Date() },
      });
      await this.audit(tx, tenant, dealId, 'financing.escrow_deposited', 'financing_plan', plan.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async sellerEscrow(tx: TransactionClient, dealId: string, planId: string) {
    const escrow = await tx.financingEscrow.findFirst({ where: { planId, dealId } });
    if (!escrow) throw new NotFoundException();
    return escrow;
  }

  private async seller(tenant: TenantContext, dealId: string, action: string, requestId: string) {
    const who = await this.who(tenant, dealId, action, requestId);
    if (who.reader !== 'SELLER' || !(who.role === 'TARGET_CONTRIBUTOR' || canWrite(who.role))) {
      await withTenant(this.prisma, tenant, (tx) => this.audit(tx, tenant, dealId, action, 'deal', dealId, requestId, 'DENIED'));
      throw new ForbiddenException('The seller answers the deposit');
    }
    return who;
  }

  async confirmDeposit(tenant: TenantContext, dealId: string, planId: string, requestId: string) {
    await this.seller(tenant, dealId, 'financing.escrow_confirmed', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const escrow = await this.sellerEscrow(tx, dealId, planId);
      if (escrow.status !== 'DEPOSITED' || escrow.confirmedAt) throw new ConflictException('Nothing recorded to confirm');
      await tx.financingEscrow.update({ where: { planId }, data: { confirmedAt: new Date(), confirmedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'financing.escrow_confirmed', 'financing_plan', planId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Not with the holder: back to the buyer, with a note. */
  async disputeDeposit(tenant: TenantContext, dealId: string, planId: string, note: string, requestId: string) {
    await this.seller(tenant, dealId, 'financing.escrow_disputed', requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const escrow = await this.sellerEscrow(tx, dealId, planId);
      if (escrow.status !== 'DEPOSITED' || escrow.confirmedAt) throw new ConflictException('Nothing recorded to dispute');
      await tx.financingEscrow.update({
        where: { planId },
        data: { status: 'COMMITTED', depositedOn: null, depositReference: null, proofDocumentId: null, depositRecordedAt: null, depositRecordedBy: null, disputedAt: new Date(), disputeNote: note },
      });
      await this.audit(tx, tenant, dealId, 'financing.escrow_disputed', 'financing_plan', planId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /**
   * Where the deposit went, recorded by the side that received it: refunded (the buyer), released
   * to the seller (the seller), or applied against the price at close (either). From a confirmed deposit only.
   */
  async disposition(tenant: TenantContext, dealId: string, planId: string | null, disposition: 'APPLIED_AT_CLOSE' | 'RELEASED_TO_SELLER' | 'REFUNDED_TO_BUYER', requestId: string) {
    const who = await this.who(tenant, dealId, 'financing.escrow_disposed', requestId);
    const allowed = who.reader === 'BUYER' ? who.canEdit && disposition !== 'RELEASED_TO_SELLER' : who.reader === 'SELLER' && (who.role === 'TARGET_CONTRIBUTOR' || canWrite(who.role)) && disposition !== 'REFUNDED_TO_BUYER';
    if (!allowed) {
      await withTenant(this.prisma, tenant, (tx) => this.audit(tx, tenant, dealId, 'financing.escrow_disposed', 'deal', dealId, requestId, 'DENIED'));
      throw new ForbiddenException('The side that received the money records it');
    }
    await withTenant(this.prisma, tenant, async (tx) => {
      const id = who.reader === 'BUYER' ? (await this.ownPlan(tx, tenant, dealId, who)).id : planId;
      if (!id) throw new NotFoundException();
      const escrow = await this.sellerEscrow(tx, dealId, id);
      if (escrow.status !== 'DEPOSITED' || !escrow.confirmedAt) throw new ConflictException('Only a confirmed deposit has a disposition');
      await tx.financingEscrow.update({ where: { planId: id }, data: { status: disposition, dispositionAt: new Date(), dispositionBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'financing.escrow_disposed', 'financing_plan', id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }
}
