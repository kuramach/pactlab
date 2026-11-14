import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SigningProviderError } from '@pactlab/connectors';
import type { LoiView } from '@pactlab/contracts';
import { appendAuditEvent, signingOutcomes, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { termSide } from '../pricing/pricing.service';
import { PRISMA } from '../tokens';
import { CLOSE_DEPENDENCIES, CloseService, type CloseDependencies } from './close.service';
import { DEFAULT_LOI_FIELDS, loiContent, loiFieldsSchema, type LoiContent, type LoiFields } from './loi-content';
import { documentBrand } from '../brand/document-brand';
import { loiPdf } from './loi-pdf';
import { SIGN_ANCHORS } from './term-sheet';

type Side = 'BUYER' | 'SELLER';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');
const isLead = (role: DealRole) => role === 'DEAL_LEAD';
const actor = (role: DealRole) => termSide(role) !== null;
const DAY = 86_400_000;

/**
 * Letters of intent (T-119, ADR 0030): generated from the agreed terms, in two labelled parts,
 * signed by the buyer and countersigned by the seller — in Pactlab or by e-signature from the
 * buyer's own account. A draft stays with the pact's own side; a sent letter never changes.
 * Optional, unless the pact requires a countersigned letter before the definitive agreement.
 */
@Injectable()
export class LoiService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(CloseService) private readonly close: CloseService,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly documents: DocumentObjectStore,
    @Inject(CLOSE_DEPENDENCIES) private readonly deps: CloseDependencies,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: 'loi_version', targetId, outcome: 'SUCCEEDED', requestId });
  }

  /** A sent letter past its answer date, not countersigned, has expired. */
  private async expire(tx: TransactionClient, tenant: TenantContext, dealId: string, requestId: string) {
    const stale = await tx.loiVersion.findMany({ where: { dealId, status: 'SENT', respondBy: { lt: new Date() } }, select: { id: true } });
    for (const row of stale) {
      await tx.loiVersion.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
      await this.audit(tx, tenant, dealId, 'loi.expired', row.id, requestId);
    }
  }

  private async inputs(tx: TransactionClient, dealId: string, batchId: string, fields: LoiFields) {
    const [deal, parties, batch] = await Promise.all([
      tx.deal.findUnique({ where: { id: dealId }, select: { name: true } }),
      tx.dealParty.findMany({ where: { dealId }, select: { role: true, name: true } }),
      tx.termProposalBatch.findFirst({ where: { id: batchId, dealId }, include: { terms: { orderBy: { ordinal: 'asc' } } } }),
    ]);
    if (!batch?.agreedAt) throw new UnprocessableEntityException({ code: 'TERMS_NOT_AGREED' });
    return {
      dealName: deal?.name ?? 'the pact',
      buyerName: parties.find((party) => party.role === 'BUYER')?.name ?? 'The buyer',
      sellerName: parties.find((party) => party.role === 'SELLER')?.name ?? 'The seller',
      termsVersion: batch.version,
      agreedAt: batch.agreedAt.toISOString(),
      // Verbatim from the agreed version: the stored decimal, its currency and the seller's note.
      terms: batch.terms.map((term) => ({ lever: term.lever, amount: term.amount.toFixed(2), currency: term.currency, note: term.sellerNote, dueOn: term.dueOn?.toISOString().slice(0, 10) ?? null })),
      fields,
    };
  }

  private async names(tx: TransactionClient, ids: readonly (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    return new Map((await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName]));
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<LoiView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'loi.viewed', requestId });
    const side = termSide(role);
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.expire(tx, tenant, dealId, requestId);
      const [deal, versions, agreed, buyer, seller] = await Promise.all([
        tx.deal.findUnique({ where: { id: dealId }, select: { loiRequired: true } }),
        tx.loiVersion.findMany({ where: { dealId }, orderBy: { version: 'desc' }, include: { signoffs: true } }),
        this.close.agreedBatch(tx, dealId),
        this.close.signatory(tx, dealId, 'BUYER'),
        this.close.signatory(tx, dealId, 'SELLER'),
      ]);
      const names = await this.names(tx, [buyer?.userId, seller?.userId, ...versions.flatMap((row) => row.signoffs.map((signoff) => signoff.userId))]);
      const current = versions[0] ?? null;
      const fields = current ? loiFieldsSchema.parse(current.fields) : null;
      const content: LoiContent | null = current ? (current.status === 'DRAFT' ? loiContent(await this.inputs(tx, dealId, current.batchId, fields as LoiFields)) : (current.snapshot as unknown as LoiContent)) : null;
      const signedBy = (row: (typeof versions)[number], who: Side) => row.signoffs.find((signoff) => signoff.side === who) ?? null;
      const signerName = (signoff: { userId: string } | null, fallback: string) => (signoff ? (names.get(signoff.userId) ?? fallback) : null);
      const mySignatory = side === 'BUYER' ? buyer?.userId : side === 'SELLER' ? seller?.userId : null;
      const countersigned = versions.find((row) => row.status === 'COUNTERSIGNED') ?? null;
      return {
        required: deal?.loiRequired ?? false,
        agreedTermsVersion: agreed?.agreedAt ? agreed.version : null,
        // A new version: from agreed terms, with no draft open and no letter already out or signed on these same terms.
        canDraft: isLead(role) && side === 'BUYER' && Boolean(agreed?.agreedAt) && current?.status !== 'DRAFT' && !(current && current.batchId === agreed?.id && (current.status === 'SENT' || current.status === 'COUNTERSIGNED')),
        canSetRequirement: isLead(role),
        signatories: { BUYER: buyer ? (names.get(buyer.userId) ?? 'Buyer signatory') : null, SELLER: seller ? (names.get(seller.userId) ?? 'Seller signatory') : null },
        exclusivity: countersigned?.exclusivityEndsAt
          ? { endsAt: countersigned.exclusivityEndsAt.toISOString(), daysLeft: Math.max(0, Math.ceil((countersigned.exclusivityEndsAt.getTime() - Date.now()) / DAY)), ended: countersigned.exclusivityEndsAt.getTime() <= Date.now() }
          : null,
        current: current
          ? {
              id: current.id,
              version: current.version,
              status: current.status as LoiView['versions'][number]['status'],
              termsBatchId: current.batchId,
              fields: fields as LoiFields,
              content: content as LoiContent,
              method: (current.method as 'IN_APP' | 'ESIGN' | null) ?? null,
              sentAt: current.sentAt?.toISOString() ?? null,
              respondBy: current.respondBy?.toISOString() ?? null,
              signedBy: { BUYER: signerName(signedBy(current, 'BUYER'), 'Buyer'), SELLER: signerName(signedBy(current, 'SELLER'), 'Seller') },
              canEdit: isLead(role) && current.status === 'DRAFT',
              canSend: isLead(role) && current.status === 'DRAFT',
              canSign: current.status === 'SENT' && current.method === 'IN_APP' && side !== null && mySignatory === tenant.userId && !signedBy(current, side) && (side === 'BUYER' || Boolean(signedBy(current, 'BUYER'))),
              canDecline: current.status === 'SENT' && side === 'SELLER' && mySignatory === tenant.userId && !signedBy(current, 'SELLER'),
              canFixtureSign: Boolean(this.deps.fixtureSigning) && current.status === 'SENT' && current.method === 'ESIGN' && side !== null && mySignatory === tenant.userId,
              hasPdf: Boolean(current.objectKey),
            }
          : null,
        versions: versions.map((row) => ({ id: row.id, version: row.version, status: row.status as LoiView['versions'][number]['status'], sentAt: row.sentAt?.toISOString() ?? null, countersignedAt: row.countersignedAt?.toISOString() ?? null, hasPdf: Boolean(row.objectKey) })),
      };
    });
  }

  /** A new draft from the latest agreed terms: the buyer's lead, before or after an earlier letter. */
  async draft(tenant: TenantContext, dealId: string, requestId: string): Promise<LoiView> {
    const role = await this.access.require(tenant, dealId, isLead, { action: 'loi.drafted', requestId });
    if (termSide(role) !== 'BUYER') throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.close.agreedBatch(tx, dealId);
      if (!agreed?.agreedAt) throw new UnprocessableEntityException({ code: 'TERMS_NOT_AGREED' });
      const latest = await tx.loiVersion.findFirst({ where: { dealId }, orderBy: { version: 'desc' } });
      if (latest?.status === 'DRAFT') throw new UnprocessableEntityException({ code: 'LOI_DRAFT_OPEN' });
      if (latest?.status === 'SENT' && latest.batchId === agreed.id) throw new UnprocessableEntityException({ code: 'LOI_AWAITING_SIGNATURE' });
      const fields = latest ? loiFieldsSchema.parse(latest.fields) : DEFAULT_LOI_FIELDS;
      const row = await tx.loiVersion.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, batchId: agreed.id, version: (latest?.version ?? 0) + 1, fields, createdBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'loi.drafted', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  async saveFields(tenant: TenantContext, dealId: string, loiId: string, fields: LoiFields, requestId: string): Promise<LoiView> {
    await this.access.require(tenant, dealId, isLead, { action: 'loi.edited', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.loiVersion.findFirst({ where: { id: loiId, dealId } });
      if (!row) throw new NotFoundException();
      if (row.status !== 'DRAFT') throw new UnprocessableEntityException({ code: 'LOI_SENT' });
      await tx.loiVersion.update({ where: { id: loiId }, data: { fields } });
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Freeze the draft, render the PDF, and send it: signed in Pactlab, or by e-signature from the buyer's account. */
  async send(tenant: TenantContext, dealId: string, loiId: string, method: 'IN_APP' | 'ESIGN', requestId: string): Promise<LoiView> {
    await this.access.require(tenant, dealId, isLead, { action: 'loi.sent', requestId });
    // The sending organization's brand, stamped into the letter as sent (T-123).
    const brand = await documentBrand(this.prisma, this.documents, tenant);
    await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.loiVersion.findFirst({ where: { id: loiId, dealId } });
      if (!row) throw new NotFoundException();
      if (row.status !== 'DRAFT') throw new UnprocessableEntityException({ code: 'LOI_SENT' });
      const fields = loiFieldsSchema.parse(row.fields);
      const content = loiContent(await this.inputs(tx, dealId, row.batchId, fields));
      const [buyer, seller] = [await this.close.signatory(tx, dealId, 'BUYER'), await this.close.signatory(tx, dealId, 'SELLER')];
      if (content.unfilled.length > 0 || !buyer || !seller) throw new UnprocessableEntityException({ code: 'LOI_INCOMPLETE' });
      const people = new Map((await tx.user.findMany({ where: { id: { in: [buyer.userId, seller.userId] } }, select: { id: true, displayName: true, email: true } })).map((user) => [user.id, user]));
      const sentAt = new Date();
      const pdf = await loiPdf(content, { version: row.version, issuedAt: sentAt.toISOString(), signatories: { buyer: people.get(buyer.userId)?.displayName ?? 'Buyer signatory', seller: people.get(seller.userId)?.displayName ?? 'Seller signatory' }, brand });
      const objectKey = `${tenant.organizationId}/${dealId}/loi/${row.id}.pdf`;
      await this.documents.put(objectKey, pdf.bytes, { contentType: 'application/pdf', sha256: pdf.sha256 } as never);
      if (method === 'ESIGN') {
        const signing = await this.close.provider(tx, tenant);
        if (!signing) throw new UnprocessableEntityException({ code: 'ESIGN_UNAVAILABLE' });
        const [buyerUser, sellerUser] = [people.get(buyer.userId), people.get(seller.userId)];
        if (!buyerUser?.email || !sellerUser?.email) throw new UnprocessableEntityException({ code: 'SIGNATORY_EMAIL_MISSING' });
        let envelopeId: string;
        try {
          ({ envelopeId } = await signing.provider.createEnvelope({
            emailSubject: `Sign the letter of intent (v${row.version})`,
            documents: [{ name: `Letter of intent v${row.version}`, fileExtension: 'pdf', bytes: pdf.bytes }],
            signers: [
              { email: buyerUser.email, name: buyerUser.displayName, anchor: SIGN_ANCHORS.BUYER },
              { email: sellerUser.email, name: sellerUser.displayName, anchor: SIGN_ANCHORS.SELLER },
            ],
          }));
        } catch (error) {
          if (error instanceof SigningProviderError) throw new ServiceUnavailableException({ code: error.kind === 'AUTH' ? 'ESIGN_RECONNECT' : 'ESIGN_UNAVAILABLE' });
          throw error;
        }
        await tx.signatureEnvelope.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId, batchId: row.batchId, loiId: row.id, provider: signing.name, providerEnvelopeId: envelopeId, termSheetSha256: pdf.sha256, buyerSignatory: buyer.userId, sellerSignatory: seller.userId, sentBy: tenant.userId },
        });
      }
      await tx.loiVersion.update({
        where: { id: row.id },
        data: { status: 'SENT', snapshot: content as never, method, objectKey, sha256: pdf.sha256, sentBy: tenant.userId, sentAt, respondBy: new Date(sentAt.getTime() + fields.responseDays * DAY) },
      });
      await this.audit(tx, tenant, dealId, 'loi.sent', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** In-app: the buyer's signatory signs, then the seller's countersigns; exclusivity starts then. */
  async sign(tenant: TenantContext, dealId: string, loiId: string, requestId: string): Promise<LoiView> {
    const role = await this.access.require(tenant, dealId, actor, { action: 'loi.signed', requestId });
    const side = termSide(role) as Side;
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.expire(tx, tenant, dealId, requestId);
      const row = await tx.loiVersion.findFirst({ where: { id: loiId, dealId }, include: { signoffs: true } });
      if (!row) throw new NotFoundException();
      if (row.status !== 'SENT' || row.method !== 'IN_APP') throw new UnprocessableEntityException({ code: 'LOI_NOT_OPEN' });
      if ((await this.close.signatory(tx, dealId, side))?.userId !== tenant.userId) throw new ForbiddenException('Only your side’s signatory signs');
      if (row.signoffs.some((signoff) => signoff.side === side)) throw new ConflictException('Already signed');
      if (side === 'SELLER' && !row.signoffs.some((signoff) => signoff.side === 'BUYER')) throw new UnprocessableEntityException({ code: 'LOI_BUYER_SIGNS_FIRST' });
      await tx.loiSignoff.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, loiId, side, userId: tenant.userId, method: 'IN_APP' } });
      await this.audit(tx, tenant, dealId, 'loi.signed', loiId, requestId);
      if (side === 'SELLER') {
        const fields = loiFieldsSchema.parse(row.fields);
        const now = new Date();
        await tx.loiVersion.update({ where: { id: loiId }, data: { status: 'COUNTERSIGNED', countersignedAt: now, exclusivityEndsAt: new Date(now.getTime() + fields.exclusivityDays * DAY) } });
        await this.audit(tx, tenant, dealId, 'loi.countersigned', loiId, requestId);
      }
    });
    return this.view(tenant, dealId, requestId);
  }

  async decline(tenant: TenantContext, dealId: string, loiId: string, requestId: string): Promise<LoiView> {
    const role = await this.access.require(tenant, dealId, actor, { action: 'loi.declined', requestId });
    if (termSide(role) !== 'SELLER') throw new ForbiddenException();
    await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.loiVersion.findFirst({ where: { id: loiId, dealId } });
      if (!row) throw new NotFoundException();
      if (row.status !== 'SENT') throw new UnprocessableEntityException({ code: 'LOI_NOT_OPEN' });
      if ((await this.close.signatory(tx, dealId, 'SELLER'))?.userId !== tenant.userId) throw new ForbiddenException('Only the seller’s signatory declines');
      await tx.loiVersion.update({ where: { id: loiId }, data: { status: 'DECLINED', declinedAt: new Date(), declinedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'loi.declined', loiId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Fixture e-signature (outside production): the caller signs on the open envelope as their side's signatory. */
  async fixtureSign(tenant: TenantContext, dealId: string, loiId: string, requestId: string): Promise<LoiView> {
    const role = await this.access.require(tenant, dealId, actor, { action: 'loi.esign_signed', requestId });
    const fixture = this.deps.fixtureSigning;
    if (!fixture) throw new NotFoundException();
    const envelope = await withTenant(this.prisma, tenant, async (tx) => {
      const sent = await tx.signatureEnvelope.findFirst({ where: { loiId, dealId, status: 'SENT', provider: 'FIXTURE' } });
      if (!sent) throw new ConflictException('No open fixture envelope');
      if ((termSide(role) === 'BUYER' ? sent.buyerSignatory : sent.sellerSignatory) !== tenant.userId) throw new ForbiddenException('Only the named signatory signs');
      const me = await tx.user.findUnique({ where: { id: tenant.userId }, select: { email: true } });
      return { id: sent.providerEnvelopeId, email: me?.email ?? '' };
    });
    if (fixture.sign(envelope.id, envelope.email) === 'COMPLETED') await signingOutcomes.record(this.prisma, 'FIXTURE', envelope.id, 'COMPLETED');
    return this.view(tenant, dealId, requestId);
  }

  async setRequirement(tenant: TenantContext, dealId: string, required: boolean, requestId: string): Promise<LoiView> {
    await this.access.require(tenant, dealId, isLead, { action: 'loi.requirement_set', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.deal.update({ where: { id: dealId }, data: { loiRequired: required } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'loi.requirement_set', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
    });
    return this.view(tenant, dealId, requestId);
  }

  /** A sent letter's PDF, for both sides. A draft has none. */
  async pdf(tenant: TenantContext, dealId: string, loiId: string, requestId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    await this.access.require(tenant, dealId, canRead, { action: 'loi.downloaded', requestId });
    const row = await withTenant(this.prisma, tenant, (tx) => tx.loiVersion.findFirst({ where: { id: loiId, dealId } }));
    if (!row?.objectKey) throw new NotFoundException();
    return { bytes: await this.documents.get(row.objectKey), fileName: `Letter of intent v${row.version}.pdf` };
  }
}

