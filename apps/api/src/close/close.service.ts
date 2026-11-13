import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  DocuSignSigningProvider,
  parseDocuSignConnect,
  SigningProviderError,
  verifyDocuSignConnect,
  type DocuSignOAuth,
  type DocuSignTokens,
  type FixtureSigningProvider,
  type SecretStore,
  type SigningProvider,
} from '@pactlab/connectors';
import { appendAuditEvent, signingOutcomes, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { PhasesService } from '../phases/phases.service';
import { termSide } from '../pricing/pricing.service';
import { IC_STATE_LABELS, icStatus } from '../ic/ic-state';
import { loiSatisfied } from './loi-gate';
import { PRISMA } from '../tokens';
import type { ClosingItemBody, DisputeBody, EsignBody, PaidBody, SignatoryBody } from './close.schemas';
import { SIGN_ANCHORS, termSheetPdf } from './term-sheet';

export const CLOSE_DEPENDENCIES = Symbol('CLOSE_DEPENDENCIES');

/** E-signature for this deployment (T-107, ADR 0022). */
export interface CloseDependencies {
  /** Outside production only: the fixture signing provider. */
  readonly fixtureSigning: FixtureSigningProvider | null;
  /** Pactlab's DocuSign app registration; customers connect their own accounts to it. */
  readonly docusign: { readonly oauth: DocuSignOAuth; readonly connectHmacKey: string; readonly redirectUri: string } | null;
  /** Where each organization's DocuSign tokens live. */
  readonly secrets: SecretStore | null;
  /** Signs the OAuth `state`, binding the callback to the admin who started it. */
  readonly stateSecret: string;
}

type Side = 'BUYER' | 'SELLER';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('DEAL_READ');
const actor = (role: DealRole) => termSide(role) !== null;
const isLead = (role: DealRole) => role === 'DEAL_LEAD';

export interface CloseView {
  readonly me: { readonly side: Side | null };
  readonly signatories: Readonly<Record<Side, { readonly userId: string; readonly name: string } | null>>;
  readonly candidates: Readonly<Record<Side, readonly { readonly userId: string; readonly name: string }[]>>;
  readonly agreed: {
    readonly batchId: string;
    readonly version: number;
    readonly agreedAt: string;
    readonly declinedAt: string | null;
    readonly signoffs: readonly { readonly side: Side; readonly name: string; readonly method: 'IN_APP' | 'ESIGN'; readonly signedAt: string }[];
    readonly envelope: { readonly provider: 'FIXTURE' | 'DOCUSIGN'; readonly status: string; readonly sentAt: string; readonly signedBy: readonly Side[] } | null;
  } | null;
  readonly items: readonly {
    readonly id: string;
    readonly kind: 'CONDITION' | 'FUNDS';
    readonly title: string;
    readonly ownerSide: Side;
    readonly amount: string | null;
    readonly currency: string | null;
    readonly paid: { readonly on: string; readonly reference: string; readonly by: string; readonly proofDocumentId: string | null } | null;
    readonly dispute: { readonly note: string; readonly at: string } | null;
    readonly done: { readonly by: string; readonly at: string } | null;
  }[];
  readonly esign: { readonly provider: 'FIXTURE' | 'DOCUSIGN' | null };
  /** What still stands between the pact and its close; empty when it can close. */
  readonly missing: readonly string[];
  readonly closed: { readonly at: string; readonly buyer: string; readonly seller: string } | null;
}

/**
 * The two-sided close (T-107, ADR 0022). Each side names its signatory; an
 * agreed version is signed off by both (in the app, or by e-signature from the
 * buyer organization's own DocuSign); both sides work a closing checklist,
 * including the funds transfer (the buyer records it, the seller confirms it;
 * Pactlab never moves money); and the pact closes only when all of it is done.
 */
@Injectable()
export class CloseService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(CLOSE_DEPENDENCIES) private readonly deps: CloseDependencies,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly documents: DocumentObjectStore,
    @Optional() @Inject(PhasesService) private readonly phases: PhasesService | null,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  /** The side's current named signatory (also used by the letter of intent, T-119). */
  async signatory(tx: TransactionClient, dealId: string, side: Side) {
    return tx.pactSignatory.findFirst({ where: { dealId, side }, orderBy: [{ namedAt: 'desc' }, { id: 'desc' }] });
  }

  /** The latest agreed version, if it is the latest proposed one (a newer proposal reopens the round). */
  /** The latest agreed version (the letter of intent quotes it, T-119). */
  async agreedBatch(tx: TransactionClient, dealId: string) {
    const latest = await tx.termProposalBatch.findFirst({ where: { dealId, proposedAt: { not: null } }, orderBy: { version: 'desc' }, include: { terms: { orderBy: { ordinal: 'asc' } }, signoffs: true, envelopes: { where: { loiId: null }, orderBy: { sentAt: 'desc' }, take: 1 } } });
    return latest?.agreedAt ? latest : null;
  }

  /** The provider this organization signs with: its own DocuSign when connected, else the fixture outside production. */
  async provider(tx: TransactionClient, tenant: TenantContext): Promise<{ provider: SigningProvider; name: 'FIXTURE' | 'DOCUSIGN' } | null> {
    if (this.deps.docusign && this.deps.secrets) {
      const connection = await tx.organizationConnection.findFirst({ where: { organizationId: tenant.organizationId, provider: 'docusign', disconnectedAt: null } });
      if (connection) {
        const docusign = this.deps.docusign;
        const secrets = this.deps.secrets;
        const accessToken = async () => {
          const tokens = JSON.parse(await secrets.get(connection.credentialRef)) as DocuSignTokens;
          if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
          const refreshed = await docusign.oauth.refresh(tokens.refreshToken);
          await secrets.put(connection.credentialRef, JSON.stringify(refreshed));
          return refreshed.accessToken;
        };
        return { provider: new DocuSignSigningProvider({ accountId: connection.accountId, accountName: connection.accountName, baseUri: connection.baseUri }, accessToken), name: 'DOCUSIGN' };
      }
    }
    return this.deps.fixtureSigning ? { provider: this.deps.fixtureSigning, name: 'FIXTURE' } : null;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<CloseView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'close.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const [buyer, seller, agreed, items, deal, members, signingProvider, proposedAny] = await Promise.all([
        this.signatory(tx, dealId, 'BUYER'),
        this.signatory(tx, dealId, 'SELLER'),
        this.agreedBatch(tx, dealId),
        tx.closingItem.findMany({ where: { dealId }, orderBy: { createdAt: 'asc' } }),
        tx.deal.findUnique({ where: { id: dealId }, select: { closedAt: true, closedByBuyer: true, closedBySeller: true } }),
        tx.dealMembership.findMany({ where: { dealId, status: 'ACTIVE' }, select: { userId: true, role: true } }),
        this.provider(tx, tenant),
        tx.termProposalBatch.count({ where: { dealId, proposedAt: { not: null } } }),
      ]);
      const ids = [...new Set([...members.map((member) => member.userId), ...items.flatMap((item) => [item.doneBy, item.paidBy]), deal?.closedByBuyer, deal?.closedBySeller].filter((id): id is string => Boolean(id)))];
      const users = new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName]));
      const name = (id: string | null | undefined) => (id ? (users.get(id) ?? 'a team member') : '');
      const envelope = agreed?.envelopes[0] ?? null;
      const signedBy = envelope && envelope.provider === 'FIXTURE' && this.deps.fixtureSigning ? this.deps.fixtureSigning.signedBy(envelope.providerEnvelopeId) : [];
      const emails = new Map((await tx.user.findMany({ where: { id: { in: [buyer?.userId, seller?.userId].filter((id): id is string => Boolean(id)) } }, select: { id: true, email: true } })).map((user) => [user.id, (user.email ?? '').toLowerCase()]));

      const missing: string[] = [];
      if (proposedAny === 0) missing.push('Agree terms on Pactlab first.');
      else if (!agreed || agreed.declinedAt) missing.push('Agree a version of the terms (both sides).');
      if (!buyer) missing.push('Name the buyer’s signatory.');
      if (!seller) missing.push('Name the seller’s signatory.');
      if (agreed && !agreed.declinedAt) for (const side of ['BUYER', 'SELLER'] as const) if (!agreed.signoffs.some((signoff) => signoff.side === side)) missing.push(`${side === 'BUYER' ? 'The buyer' : 'The seller'} signs off the agreed terms.`);
      // The investment committee (T-118): the buyer's side waits for approval when the pact requires it. Never shown to the seller.
      if (termSide(role) === 'BUYER') {
        const ic = await icStatus(tx, tenant.organizationId, dealId);
        if (!ic.satisfied) missing.push(`Investment committee approval (${IC_STATE_LABELS[ic.state]}).`);
      }
      // A letter of intent, when the pact requires one (T-119): two-sided, so both sides see it.
      if (!(await loiSatisfied(tx, dealId))) missing.push('A countersigned letter of intent.');
      for (const item of items) if (!item.doneAt) missing.push(item.kind === 'FUNDS' ? `Funds: ${item.paidAt ? 'the seller confirms receipt' : 'the buyer records the payment'} (${item.title}).` : `${item.title} (${item.ownerSide === 'BUYER' ? 'buyer' : 'seller'}).`);

      return {
        me: { side: termSide(role) },
        signatories: {
          BUYER: buyer ? { userId: buyer.userId, name: name(buyer.userId) } : null,
          SELLER: seller ? { userId: seller.userId, name: name(seller.userId) } : null,
        },
        candidates: {
          BUYER: members.filter((member) => termSide(member.role as DealRole) === 'BUYER').map((member) => ({ userId: member.userId, name: name(member.userId) })),
          SELLER: members.filter((member) => member.role === 'TARGET_CONTRIBUTOR').map((member) => ({ userId: member.userId, name: name(member.userId) })),
        },
        agreed: agreed?.agreedAt
          ? {
              batchId: agreed.id,
              version: agreed.version,
              agreedAt: agreed.agreedAt.toISOString(),
              declinedAt: agreed.declinedAt?.toISOString() ?? null,
              signoffs: agreed.signoffs.map((signoff) => ({ side: signoff.side as Side, name: name(signoff.userId), method: signoff.method as 'IN_APP' | 'ESIGN', signedAt: signoff.signedAt.toISOString() })),
              envelope: envelope
                ? {
                    provider: envelope.provider as 'FIXTURE' | 'DOCUSIGN',
                    status: envelope.status,
                    sentAt: envelope.sentAt.toISOString(),
                    signedBy: (['BUYER', 'SELLER'] as const).filter((side) => signedBy.includes(emails.get(side === 'BUYER' ? envelope.buyerSignatory : envelope.sellerSignatory) ?? '-')),
                  }
                : null,
            }
          : null,
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind as 'CONDITION' | 'FUNDS',
          title: item.title,
          ownerSide: item.ownerSide as Side,
          amount: item.amount?.toFixed(2) ?? null,
          currency: item.currency,
          paid: item.paidAt && item.paidOn ? { on: item.paidOn.toISOString().slice(0, 10), reference: item.paidReference ?? '', by: name(item.paidBy), proofDocumentId: item.proofDocumentId } : null,
          dispute: item.disputedAt && !item.paidAt ? { note: item.disputeNote ?? '', at: item.disputedAt.toISOString() } : null,
          done: item.doneAt ? { by: name(item.doneBy), at: item.doneAt.toISOString() } : null,
        })),
        esign: { provider: signingProvider?.name ?? null },
        missing: deal?.closedAt ? [] : missing,
        closed: deal?.closedAt ? { at: deal.closedAt.toISOString(), buyer: name(deal.closedByBuyer), seller: name(deal.closedBySeller) } : null,
      };
    });
  }

  /** Each side names its own signatory: the buyer's deal lead for the buyer; any seller contributor for the seller. */
  async nameSignatory(tenant: TenantContext, dealId: string, side: Side, body: SignatoryBody, requestId: string) {
    await this.access.require(tenant, dealId, side === 'BUYER' ? isLead : (r: DealRole) => r === 'TARGET_CONTRIBUTOR', { action: 'signatory.named', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.agreedBatch(tx, dealId);
      if (agreed?.signoffs.some((signoff) => signoff.side === side)) throw new ConflictException('This side has signed; its signatory is fixed for this version');
      const member = await tx.dealMembership.findFirst({ where: { dealId, userId: body.userId, status: 'ACTIVE' } });
      if (!member || termSide(member.role as DealRole) !== side) throw new UnprocessableEntityException('Name someone on this side of the pact');
      const row = await tx.pactSignatory.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, side, userId: body.userId, namedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'signatory.named', 'pact_signatory', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The buyer signs only once its investment committee has approved, when the pact requires it (T-118). */
  private async requireIcApproval(tx: TransactionClient, tenant: TenantContext, dealId: string) {
    const ic = await icStatus(tx, tenant.organizationId, dealId);
    if (!ic.satisfied) throw new UnprocessableEntityException({ code: 'IC_APPROVAL_REQUIRED' });
  }

  private async requireOpenAgreed(tx: TransactionClient, dealId: string, batchId: string) {
    const agreed = await this.agreedBatch(tx, dealId);
    if (!agreed || agreed.id !== batchId) throw new ConflictException('Only the latest agreed version is signed');
    if (agreed.declinedAt) throw new ConflictException('This version was declined; agree a new one');
    return agreed;
  }

  /** In-app sign-off by the caller, who must be their side's signatory. */
  async signOff(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'terms.signed_off', requestId });
    const side = termSide(role) as Side;
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.requireOpenAgreed(tx, dealId, batchId);
      if ((await this.signatory(tx, dealId, side))?.userId !== tenant.userId) throw new ForbiddenException('Only your side’s signatory signs off');
      if (side === 'BUYER') await this.requireIcApproval(tx, tenant, dealId);
      if (!(await loiSatisfied(tx, dealId))) throw new UnprocessableEntityException({ code: 'LOI_REQUIRED' });
      if (agreed.envelopes[0]?.status === 'SENT') throw new ConflictException('Sent for e-signature: sign there');
      if (agreed.signoffs.some((signoff) => signoff.side === side)) throw new ConflictException('Already signed off');
      const row = await tx.termSignoff.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, batchId, side, userId: tenant.userId, method: 'IN_APP' } });
      await this.audit(tx, tenant, dealId, 'terms.signed_off', 'term_signoff', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** A signatory turns the agreed version down before anyone signs; a new version follows. */
  async decline(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'terms.declined', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.requireOpenAgreed(tx, dealId, batchId);
      if ((await this.signatory(tx, dealId, termSide(role) as Side))?.userId !== tenant.userId) throw new ForbiddenException('Only a signatory declines');
      if (agreed.signoffs.length > 0 || agreed.envelopes[0]?.status === 'SENT') throw new ConflictException('Signing has started');
      await tx.termProposalBatch.update({ where: { id: batchId }, data: { declinedAt: new Date(), declinedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'terms.declined', 'term_proposal_batch', batchId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The term sheet of an agreed version, as both sides download and sign it. */
  async termSheet(tenant: TenantContext, dealId: string, batchId: string, requestId: string): Promise<{ bytes: Uint8Array; sha256: string; fileName: string }> {
    await this.access.require(tenant, dealId, canRead, { action: 'terms.term_sheet', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.agreedBatch(tx, dealId);
      if (!agreed || agreed.id !== batchId || !agreed.agreedAt) throw new NotFoundException();
      return { ...(await this.render(tx, dealId, agreed)), fileName: `Term sheet v${agreed.version}.pdf` };
    });
  }

  private async render(tx: TransactionClient, dealId: string, agreed: NonNullable<Awaited<ReturnType<CloseService['agreedBatch']>>>) {
    const [deal, parties, buyer, seller] = await Promise.all([
      tx.deal.findUnique({ where: { id: dealId }, select: { name: true } }),
      tx.dealParty.findMany({ where: { dealId }, select: { role: true, name: true } }),
      this.signatory(tx, dealId, 'BUYER'),
      this.signatory(tx, dealId, 'SELLER'),
    ]);
    const names = new Map((await tx.user.findMany({ where: { id: { in: [buyer?.userId, seller?.userId].filter((id): id is string => Boolean(id)) } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName]));
    return termSheetPdf({
      dealName: deal?.name ?? 'Pact',
      buyerName: parties.find((party) => party.role === 'BUYER')?.name ?? 'Buyer',
      sellerName: parties.find((party) => party.role === 'SELLER')?.name ?? 'Seller',
      version: agreed.version,
      agreedAt: (agreed.agreedAt as Date).toISOString(),
      terms: agreed.terms.map((term) => ({ lever: term.lever, amount: term.amount.toFixed(2), currency: term.currency, note: term.sellerNote })),
      signatories: { buyer: (buyer && names.get(buyer.userId)) ?? 'Buyer signatory', seller: (seller && names.get(seller.userId)) ?? 'Seller signatory' },
    });
  }

  /**
   * Send the agreed version for e-signature from the buyer organization's own
   * account (DocuSign when connected; the fixture outside production): the
   * term sheet, and the final agreement if one is attached.
   */
  async sendForSignature(tenant: TenantContext, dealId: string, batchId: string, body: EsignBody, requestId: string) {
    await this.access.require(tenant, dealId, (r: DealRole) => termSide(r) === 'BUYER', { action: 'terms.esign_sent', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.requireOpenAgreed(tx, dealId, batchId);
      await this.requireIcApproval(tx, tenant, dealId);
      if (!(await loiSatisfied(tx, dealId))) throw new UnprocessableEntityException({ code: 'LOI_REQUIRED' });
      if (agreed.signoffs.length > 0 || agreed.envelopes[0]?.status === 'SENT') throw new ConflictException('Signing has started');
      const [buyer, seller] = [await this.signatory(tx, dealId, 'BUYER'), await this.signatory(tx, dealId, 'SELLER')];
      if (!buyer || !seller) throw new ConflictException('Name both signatories first');
      const signing = await this.provider(tx, tenant);
      if (!signing) throw new ConflictException({ code: 'ESIGN_UNAVAILABLE' });
      const people = new Map((await tx.user.findMany({ where: { id: { in: [buyer.userId, seller.userId] } }, select: { id: true, displayName: true, email: true } })).map((user) => [user.id, user]));
      const [buyerUser, sellerUser] = [people.get(buyer.userId), people.get(seller.userId)];
      if (!buyerUser?.email || !sellerUser?.email) throw new ConflictException({ code: 'SIGNATORY_EMAIL_MISSING' });
      const sheet = await this.render(tx, dealId, agreed);
      const documents = [{ name: `Term sheet v${agreed.version}.pdf`, fileExtension: 'pdf' as const, bytes: sheet.bytes }];
      if (body.agreementDocumentId) {
        const document = await tx.document.findFirst({ where: { id: body.agreementDocumentId, dealId, visibility: 'SHARED', contentType: 'application/pdf' } });
        if (!document) throw new UnprocessableEntityException('Attach a PDF both sides can see');
        documents.push({ name: document.fileName, fileExtension: 'pdf', bytes: await this.documents.get(document.objectKey) });
      }
      let envelopeId: string;
      try {
        ({ envelopeId } = await signing.provider.createEnvelope({
          emailSubject: `Sign the agreed terms (v${agreed.version})`,
          documents,
          signers: [
            { email: buyerUser.email, name: buyerUser.displayName, anchor: SIGN_ANCHORS.BUYER },
            { email: sellerUser.email, name: sellerUser.displayName, anchor: SIGN_ANCHORS.SELLER },
          ],
        }));
      } catch (error) {
        if (error instanceof SigningProviderError) throw new ServiceUnavailableException({ code: error.kind === 'AUTH' ? 'ESIGN_RECONNECT' : 'ESIGN_UNAVAILABLE' });
        throw error;
      }
      const row = await tx.signatureEnvelope.create({
        data: { id: newId(), organizationId: tenant.organizationId, dealId, batchId, provider: signing.name, providerEnvelopeId: envelopeId, termSheetSha256: sheet.sha256, agreementDocumentId: body.agreementDocumentId, buyerSignatory: buyer.userId, sellerSignatory: seller.userId, sentBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'terms.esign_sent', 'signature_envelope', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Fixture e-signature (outside production): the caller signs as their side's signatory on the envelope. */
  async fixtureSign(tenant: TenantContext, dealId: string, batchId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'terms.esign_signed', requestId });
    const fixture = this.deps.fixtureSigning;
    if (!fixture) throw new NotFoundException();
    const envelope = await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.requireOpenAgreed(tx, dealId, batchId);
      const sent = agreed.envelopes[0];
      if (!sent || sent.provider !== 'FIXTURE' || sent.status !== 'SENT') throw new ConflictException('No open fixture envelope');
      if ((termSide(role) === 'BUYER' ? sent.buyerSignatory : sent.sellerSignatory) !== tenant.userId) throw new ForbiddenException('Only the named signatory signs');
      const me = await tx.user.findUnique({ where: { id: tenant.userId }, select: { email: true } });
      return { id: sent.providerEnvelopeId, email: me?.email ?? '' };
    });
    if (fixture.sign(envelope.id, envelope.email) === 'COMPLETED') await signingOutcomes.record(this.prisma, 'FIXTURE', envelope.id, 'COMPLETED');
    return this.view(tenant, dealId, requestId);
  }

  /** DocuSign Connect: a signed (HMAC) envelope event, recorded once. No session; the body is the proof. */
  async docusignEvent(rawBody: Uint8Array, headers: Readonly<Record<string, string | string[] | undefined>>): Promise<{ recorded: boolean }> {
    if (!this.deps.docusign || !verifyDocuSignConnect(this.deps.docusign.connectHmacKey, rawBody, headers)) throw new ForbiddenException();
    const event = parseDocuSignConnect(rawBody);
    if (!event || event.status === 'SENT') return { recorded: false };
    return { recorded: (await signingOutcomes.record(this.prisma, 'DOCUSIGN', event.envelopeId, event.status)) !== null };
  }

  // --- The closing checklist ---------------------------------------------------

  async addItem(tenant: TenantContext, dealId: string, body: ClosingItemBody, requestId: string) {
    await this.access.require(tenant, dealId, actor, { action: 'closing_item.added', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.closingItem.create({
        data:
          body.kind === 'FUNDS'
            ? { id: newId(), organizationId: tenant.organizationId, dealId, kind: 'FUNDS', title: body.title, ownerSide: 'SELLER', amount: body.amount, currency: body.currency, createdBy: tenant.userId }
            : { id: newId(), organizationId: tenant.organizationId, dealId, kind: 'CONDITION', title: body.title, ownerSide: body.ownerSide, createdBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'closing_item.added', 'closing_item', row.id, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  private async item(tx: TransactionClient, dealId: string, itemId: string) {
    const item = await tx.closingItem.findFirst({ where: { id: itemId, dealId } });
    if (!item) throw new NotFoundException();
    if (item.doneAt) throw new ConflictException('Already done');
    return item;
  }

  /** The owning side ticks a condition, or the seller confirms funds received. */
  async tick(tenant: TenantContext, dealId: string, itemId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'closing_item.done', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const item = await this.item(tx, dealId, itemId);
      if (termSide(role) !== item.ownerSide) throw new ForbiddenException(item.kind === 'FUNDS' ? 'The seller confirms receipt' : 'The owning side ticks this item');
      if (item.kind === 'FUNDS' && !item.paidAt) throw new ConflictException('The buyer records the payment first');
      await tx.closingItem.update({ where: { id: itemId }, data: { doneAt: new Date(), doneBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, item.kind === 'FUNDS' ? 'closing_item.funds_confirmed' : 'closing_item.done', 'closing_item', itemId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The buyer records a payment made outside Pactlab: date and reference; never bank details. */
  async recordPayment(tenant: TenantContext, dealId: string, itemId: string, body: PaidBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'closing_item.paid', requestId });
    if (termSide(role) !== 'BUYER') throw new ForbiddenException('The buyer records the payment');
    await withTenant(this.prisma, tenant, async (tx) => {
      const item = await this.item(tx, dealId, itemId);
      if (item.kind !== 'FUNDS') throw new UnprocessableEntityException('Not a funds item');
      if (body.proofDocumentId && !(await tx.document.findFirst({ where: { id: body.proofDocumentId, dealId, visibility: 'SHARED' }, select: { id: true } }))) {
        throw new UnprocessableEntityException('Attach proof the seller can see');
      }
      await tx.closingItem.update({
        where: { id: itemId },
        data: { paidAt: new Date(), paidBy: tenant.userId, paidOn: new Date(`${body.paidOn}T00:00:00Z`), paidReference: body.reference, proofDocumentId: body.proofDocumentId, disputedAt: null, disputeNote: null },
      });
      await this.audit(tx, tenant, dealId, 'closing_item.paid', 'closing_item', itemId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** The seller has not received it: back to the buyer, with a note. */
  async disputePayment(tenant: TenantContext, dealId: string, itemId: string, body: DisputeBody, requestId: string) {
    const role = await this.access.require(tenant, dealId, actor, { action: 'closing_item.disputed', requestId });
    if (termSide(role) !== 'SELLER') throw new ForbiddenException('The seller disputes a payment');
    await withTenant(this.prisma, tenant, async (tx) => {
      const item = await this.item(tx, dealId, itemId);
      if (item.kind !== 'FUNDS' || !item.paidAt) throw new ConflictException('Nothing recorded to dispute');
      await tx.closingItem.update({ where: { id: itemId }, data: { paidAt: null, paidBy: null, paidOn: null, paidReference: null, proofDocumentId: null, disputedAt: new Date(), disputeNote: body.note } });
      await this.audit(tx, tenant, dealId, 'closing_item.disputed', 'closing_item', itemId, requestId);
    });
    return this.view(tenant, dealId, requestId);
  }

  /** Close the pact: only with both sign-offs on the agreed version and every checklist item done. */
  async close(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, isLead, { action: 'deal.closed', requestId });
    const current = await this.view(tenant, dealId, requestId);
    if (current.closed) throw new ConflictException('Already closed');
    if (current.missing.length > 0) throw new ConflictException({ code: 'CLOSE_NOT_READY', missing: current.missing });
    await withTenant(this.prisma, tenant, async (tx) => {
      const agreed = await this.agreedBatch(tx, dealId);
      const by = (side: Side) => agreed?.signoffs.find((signoff) => signoff.side === side)?.userId ?? null;
      await tx.deal.update({ where: { id: dealId }, data: { stage: 'CLOSED', closedAt: new Date(), closedByBuyer: by('BUYER'), closedBySeller: by('SELLER') } });
      await this.audit(tx, tenant, dealId, 'deal.closed', 'deal', dealId, requestId);
    });
    // Closing opens Post-Close: its registers come from diligence output, by reference.
    if (this.phases) await this.phases.generatePostClose(tenant, dealId, requestId);
    return this.view(tenant, dealId, requestId);
  }

  // --- The organization's own DocuSign account -----------------------------------

  private stateFor(tenant: TenantContext, expires: number) {
    const payload = `${tenant.organizationId}.${tenant.userId}.${expires}`;
    return `${payload}.${createHmac('sha256', this.deps.stateSecret).update(`docusign-state:${payload}`).digest('base64url')}`;
  }

  private requireAdmin(tenant: TenantContext) {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
  }

  async docusignStatus(tenant: TenantContext) {
    const connection = await withTenant(this.prisma, tenant, (tx) => tx.organizationConnection.findFirst({ where: { organizationId: tenant.organizationId, provider: 'docusign', disconnectedAt: null } }));
    return {
      available: Boolean(this.deps.docusign && this.deps.secrets),
      connected: connection ? { accountName: connection.accountName, connectedAt: connection.connectedAt.toISOString() } : null,
      canEdit: tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN',
    };
  }

  /** Where an organization admin signs in to DocuSign to connect the organization's own account. */
  docusignStart(tenant: TenantContext): { url: string } {
    this.requireAdmin(tenant);
    if (!this.deps.docusign || !this.deps.secrets) throw new ServiceUnavailableException({ code: 'DOCUSIGN_NOT_CONFIGURED' });
    return { url: this.deps.docusign.oauth.authorizeUrl(this.deps.docusign.redirectUri, this.stateFor(tenant, Date.now() + 10 * 60_000)) };
  }

  async docusignCallback(tenant: TenantContext, code: string, state: string, requestId: string) {
    this.requireAdmin(tenant);
    const docusign = this.deps.docusign;
    const secrets = this.deps.secrets;
    if (!docusign || !secrets) throw new ServiceUnavailableException({ code: 'DOCUSIGN_NOT_CONFIGURED' });
    const expires = Number(state.split('.')[2]);
    const expected = Buffer.from(this.stateFor(tenant, expires));
    const given = Buffer.from(state);
    if (!Number.isFinite(expires) || expires < Date.now() || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ForbiddenException();
    let tokens: DocuSignTokens;
    let account;
    try {
      tokens = await docusign.oauth.exchangeCode(code);
      account = await docusign.oauth.defaultAccount(tokens.accessToken);
    } catch (error) {
      if (error instanceof SigningProviderError) throw new UnprocessableEntityException({ code: 'DOCUSIGN_REFUSED' });
      throw error;
    }
    const id = newId();
    const credentialRef = `secretref:${tenant.organizationId}/docusign/${id}`;
    await secrets.put(credentialRef, JSON.stringify(tokens));
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.organizationConnection.updateMany({ where: { organizationId: tenant.organizationId, provider: 'docusign', disconnectedAt: null }, data: { disconnectedAt: new Date() } });
      await tx.organizationConnection.create({ data: { id, organizationId: tenant.organizationId, provider: 'docusign', credentialRef, accountId: account.accountId, accountName: account.accountName, baseUri: account.baseUri, connectedBy: tenant.userId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: null, actorUserId: tenant.userId, action: 'docusign.connected', targetType: 'organization_connection', targetId: id, outcome: 'SUCCEEDED', requestId });
    });
    return this.docusignStatus(tenant);
  }

  async docusignDisconnect(tenant: TenantContext, requestId: string) {
    this.requireAdmin(tenant);
    await withTenant(this.prisma, tenant, async (tx) => {
      const { count } = await tx.organizationConnection.updateMany({ where: { organizationId: tenant.organizationId, provider: 'docusign', disconnectedAt: null }, data: { disconnectedAt: new Date() } });
      if (count > 0) await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: null, actorUserId: tenant.userId, action: 'docusign.disconnected', targetType: 'organization', targetId: tenant.organizationId, outcome: 'SUCCEEDED', requestId });
    });
    return this.docusignStatus(tenant);
  }
}
