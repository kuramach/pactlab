import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { appendAuditEvent, withTenant, type AuditEventInput, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { isCounterpartyRole, newId, packFor, permissionsForDealRole, type CompanyType, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { InvitationsService } from '../invitations/invitations.service';
import { PRISMA } from '../tokens';
import type { AddBidBody, AnswerBody, AskBody, InviteBidderBody, OfferBody, PassBody, UpdateProcessBody } from './sale.schemas';

/** The seller's own team runs the process: write access, never a counterparty. */
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && !isCounterpartyRole(role);
const canWatch = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ') && !isCounterpartyRole(role);
const isBidder = (role: DealRole) => role === 'BIDDER';

/** Bids that are still in the running. */
const LIVE = ['INVITED', 'ACTIVE', 'OFFERED', 'SHORTLISTED'] as const;

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const decimal = (value: { toString(): string } | null) => (value === null ? null : value.toString());

type OfferRow = Awaited<ReturnType<PrismaClient['bidOffer']['findMany']>>[number];
function offerView(row: OfferRow) {
  return {
    id: row.id,
    version: row.version,
    round: row.round,
    price: decimal(row.price) as string,
    currency: row.currency,
    preMoney: decimal(row.preMoney),
    structure: row.structure,
    conditions: row.conditions,
    validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
    submittedAt: row.submittedAt.toISOString(),
  };
}

/**
 * Seller-led sale (T-097, ADR 0015). The seller's team invites bidding firms,
 * answers their questions (privately, or to all without naming the asker),
 * compares offers side by side — with no ranking — and awards. A bidder sees
 * only the seller's shared view and their own bid; row-level security keeps
 * every bidder's people, questions, offers and passes from every other bidder.
 */
@Injectable()
export class SaleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  private audit(tenant: TenantContext, dealId: string, action: string, target: { type: string; id: string }, requestId: string): AuditEventInput {
    return { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: target.type, targetId: target.id, outcome: 'SUCCEEDED', requestId };
  }

  private async process(tx: TransactionClient, dealId: string) {
    const process = await tx.saleProcess.findFirst({ where: { dealId } });
    if (!process) throw new NotFoundException({ code: 'NOT_SELLER_LED' });
    return process;
  }

  private async bid(tx: TransactionClient, dealId: string, bidId: string) {
    const bid = await tx.bid.findFirst({ where: { id: bidId, dealId } });
    if (!bid) throw new NotFoundException();
    return bid;
  }

  /** End a bidder's access: their people lose the pact; their own records stay. */
  private async revoke(tx: TransactionClient, dealId: string, bidIds: readonly string[]) {
    if (bidIds.length === 0) return;
    await tx.dealMembership.updateMany({ where: { dealId, role: 'BIDDER', bidId: { in: [...bidIds] } }, data: { status: 'REVOKED' } });
    await tx.dealInvitation.updateMany({ where: { dealId, bidId: { in: [...bidIds] }, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date() } });
  }

  // ------------------------------------------------------------------ seller

  /** The bidders board: every bid's stage, people, latest offer and open questions; all questions; published answers. */
  async board(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canWatch, { action: 'sale.board.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const process = await this.process(tx, dealId);
      const [bids, offers, questions, published, members, seller] = await Promise.all([
        tx.bid.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        tx.bidOffer.findMany({ where: { dealId }, orderBy: [{ version: 'asc' }] }),
        tx.bidQuestion.findMany({ where: { dealId }, orderBy: [{ askedAt: 'asc' }, { id: 'asc' }] }),
        tx.bidAnswerPublished.findMany({ where: { dealId }, orderBy: { publishedAt: 'asc' } }),
        tx.dealMembership.findMany({ where: { dealId, role: 'BIDDER' }, select: { bidId: true, status: true, user: { select: { displayName: true } } } }),
        tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } }),
      ]);
      const pending = await tx.dealInvitation.findMany({ where: { dealId, role: 'BIDDER', status: 'PENDING', expiresAt: { gt: new Date() } }, select: { bidId: true, email: true } });
      const firm = new Map(bids.map((bid) => [bid.id, bid.firmName]));
      return {
        canRun: canRun(role),
        venture: packFor((seller?.companyType ?? null) as CompanyType | null).id === 'VENTURE_RAISE',
        process: {
          status: process.status,
          round: process.round,
          offerDeadline: iso(process.offerDeadline),
          sharedSummary: process.sharedSummary,
          dataRoomUrl: process.dataRoomUrl,
          ndaText: process.ndaText,
          awardedBidId: process.awardedBidId,
        },
        bids: bids.map((bid) => {
          const mine = offers.filter((offer) => offer.bidId === bid.id);
          return {
            id: bid.id,
            firmName: bid.firmName,
            status: bid.status,
            round: bid.round,
            ndaAcceptedAt: iso(bid.ndaAcceptedAt),
            passReason: bid.passReason,
            people: members.filter((member) => member.bidId === bid.id && member.status === 'ACTIVE').map((member) => member.user.displayName),
            invited: pending.filter((invitation) => invitation.bidId === bid.id).map((invitation) => invitation.email),
            latestOffer: mine.length > 0 ? offerView(mine[mine.length - 1] as OfferRow) : null,
            offers: mine.map(offerView),
            openQuestions: questions.filter((question) => question.bidId === bid.id && question.answer === null).length,
          };
        }),
        questions: questions.map((question) => ({
          id: question.id,
          firmName: firm.get(question.bidId) ?? 'A bidder',
          question: question.question,
          askedAt: question.askedAt.toISOString(),
          answer: question.answer,
          scope: question.answerScope,
          answeredAt: iso(question.answeredAt),
        })),
        published: published.map((entry) => ({ id: entry.id, question: entry.question, answer: entry.answer, publishedAt: entry.publishedAt.toISOString() })),
      };
    });
  }

  async updateProcess(tenant: TenantContext, dealId: string, body: UpdateProcessBody, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.process.updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const process = await this.process(tx, dealId);
      if (process.status !== 'OPEN') throw new ConflictException({ code: 'PROCESS_CLOSED' });
      await tx.saleProcess.update({
        where: { organizationId_dealId: { organizationId: tenant.organizationId, dealId } },
        data: {
          ...(body.offerDeadline !== undefined ? { offerDeadline: body.offerDeadline ? new Date(body.offerDeadline) : null } : {}),
          ...(body.sharedSummary !== undefined ? { sharedSummary: body.sharedSummary || null } : {}),
          ...(body.dataRoomUrl !== undefined ? { dataRoomUrl: body.dataRoomUrl } : {}),
          ...(body.ndaText !== undefined ? { ndaText: body.ndaText || null } : {}),
          updatedBy: tenant.userId,
          updatedAt: new Date(),
        },
      });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.process.updated', { type: 'deal', id: dealId }, requestId));
    });
    return this.board(tenant, dealId, requestId);
  }

  async addBid(tenant: TenantContext, dealId: string, body: AddBidBody, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.bid.added', requestId });
    const id = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      const process = await this.process(tx, dealId);
      if (process.status !== 'OPEN') throw new ConflictException({ code: 'PROCESS_CLOSED' });
      const existing = await tx.bid.findFirst({ where: { dealId, firmName: { equals: body.firmName, mode: 'insensitive' } }, select: { id: true } });
      if (existing) throw new ConflictException({ code: 'BIDDER_EXISTS' });
      await tx.bid.create({ data: { id, organizationId: tenant.organizationId, dealId, firmName: body.firmName, round: process.round, createdBy: tenant.userId } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.bid.added', { type: 'bid', id }, requestId));
    });
    return { id };
  }

  /** Invite a person from a bidding firm. They join this pact as that firm's bidder — never the seller's organization. */
  async inviteToBid(tenant: TenantContext, dealId: string, bidId: string, body: InviteBidderBody, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.bidder.invited', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const bid = await this.bid(tx, dealId, bidId);
      if (!(LIVE as readonly string[]).includes(bid.status)) throw new ConflictException({ code: 'BID_CLOSED' });
    });
    return this.invitations.create(tenant, dealId, { email: body.email, side: 'BIDDER', role: 'BIDDER', bidId }, requestId);
  }

  /** Answer privately (only the asker) or to all (published with no link to who asked). */
  async answer(tenant: TenantContext, dealId: string, questionId: string, body: AnswerBody, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.question.answered', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const question = await tx.bidQuestion.findFirst({ where: { id: questionId, dealId } });
      if (!question) throw new NotFoundException();
      if (question.answer !== null) throw new ConflictException({ code: 'ALREADY_ANSWERED' });
      await tx.bidQuestion.update({ where: { id: questionId }, data: { answer: body.answer, answerScope: body.scope, answeredBy: tenant.userId, answeredAt: new Date() } });
      if (body.scope === 'ALL') {
        await tx.bidAnswerPublished.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId, question: question.question, answer: body.answer, publishedBy: tenant.userId },
        });
      }
      await appendAuditEvent(tx, this.audit(tenant, dealId, body.scope === 'ALL' ? 'sale.question.answered_all' : 'sale.question.answered', { type: 'bid_question', id: questionId }, requestId));
    });
    return { id: questionId, scope: body.scope };
  }

  async shortlist(tenant: TenantContext, dealId: string, bidId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.bid.shortlisted', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const bid = await this.bid(tx, dealId, bidId);
      if (bid.status !== 'OFFERED' && bid.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_SHORTLISTABLE' });
      await tx.bid.update({ where: { id: bidId }, data: { status: 'SHORTLISTED' } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.bid.shortlisted', { type: 'bid', id: bidId }, requestId));
    });
    return { id: bidId, status: 'SHORTLISTED' };
  }

  /**
   * Move to the next round: shortlisted bids go on (their earlier offers stay
   * on record); every other live bid is declined and its access ends.
   */
  async nextRound(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.round.started', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const process = await this.process(tx, dealId);
      if (process.status !== 'OPEN') throw new ConflictException({ code: 'PROCESS_CLOSED' });
      const bids = await tx.bid.findMany({ where: { dealId, status: { in: [...LIVE] } } });
      const goingOn = bids.filter((bid) => bid.status === 'SHORTLISTED');
      if (goingOn.length === 0) throw new UnprocessableEntityException({ code: 'NOBODY_SHORTLISTED' });
      const declined = bids.filter((bid) => bid.status !== 'SHORTLISTED').map((bid) => bid.id);
      const round = process.round + 1;
      await tx.bid.updateMany({ where: { dealId, id: { in: goingOn.map((bid) => bid.id) } }, data: { status: 'ACTIVE', round } });
      if (declined.length > 0) await tx.bid.updateMany({ where: { dealId, id: { in: declined } }, data: { status: 'DECLINED', decidedAt: new Date() } });
      await this.revoke(tx, dealId, declined);
      await tx.saleProcess.update({ where: { organizationId_dealId: { organizationId: tenant.organizationId, dealId } }, data: { round, offerDeadline: null, updatedBy: tenant.userId, updatedAt: new Date() } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.round.started', { type: 'deal', id: dealId }, requestId));
      return { round, continuing: goingOn.length, declined: declined.length };
    });
  }

  async decline(tenant: TenantContext, dealId: string, bidId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.bid.declined', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const bid = await this.bid(tx, dealId, bidId);
      if (!(LIVE as readonly string[]).includes(bid.status)) throw new ConflictException({ code: 'BID_CLOSED' });
      await tx.bid.update({ where: { id: bidId }, data: { status: 'DECLINED', decidedAt: new Date() } });
      await this.revoke(tx, dealId, [bidId]);
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.bid.declined', { type: 'bid', id: bidId }, requestId));
    });
    return { id: bidId, status: 'DECLINED' };
  }

  /**
   * Award the pact to one bidder. Every other bid still in the running is
   * declined and loses access; their own records stay. A person decides —
   * Pactlab never ranks or recommends.
   */
  async award(tenant: TenantContext, dealId: string, bidId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.awarded', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const process = await this.process(tx, dealId);
      if (process.status !== 'OPEN') throw new ConflictException({ code: 'PROCESS_CLOSED' });
      const bid = await this.bid(tx, dealId, bidId);
      if (bid.status !== 'OFFERED' && bid.status !== 'SHORTLISTED') throw new UnprocessableEntityException({ code: 'NO_OFFER' });
      const offered = await tx.bidOffer.count({ where: { dealId, bidId } });
      if (offered === 0) throw new UnprocessableEntityException({ code: 'NO_OFFER' });
      const others = (await tx.bid.findMany({ where: { dealId, id: { not: bidId }, status: { in: [...LIVE] } }, select: { id: true } })).map((other) => other.id);
      const now = new Date();
      await tx.bid.update({ where: { id: bidId }, data: { status: 'WON', decidedAt: now } });
      if (others.length > 0) await tx.bid.updateMany({ where: { dealId, id: { in: others } }, data: { status: 'DECLINED', decidedAt: now } });
      await this.revoke(tx, dealId, others);
      await tx.saleProcess.update({ where: { organizationId_dealId: { organizationId: tenant.organizationId, dealId } }, data: { status: 'AWARDED', awardedBidId: bidId, updatedBy: tenant.userId, updatedAt: now } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.awarded', { type: 'bid', id: bidId }, requestId));
    });
    return { id: bidId, status: 'WON' };
  }

  /**
   * Venture Raise: bring an investor's latest offer into the round model
   * (ADR 0012) as a term sheet, so the Raise tab compares it with the others.
   * The founder chooses which offers to model; Pactlab never does it for them.
   */
  async addToRound(tenant: TenantContext, dealId: string, bidId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRun, { action: 'sale.offer.modelled', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const bid = await this.bid(tx, dealId, bidId);
      const latest = await tx.bidOffer.findFirst({ where: { dealId, bidId }, orderBy: { version: 'desc' } });
      if (!latest) throw new UnprocessableEntityException({ code: 'NO_OFFER' });
      if (latest.preMoney === null) throw new UnprocessableEntityException({ code: 'PRE_MONEY_REQUIRED' });
      const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
      if (packFor((seller?.companyType ?? null) as CompanyType | null).id !== 'VENTURE_RAISE') throw new UnprocessableEntityException({ code: 'NOT_A_RAISE' });
      const id = newId();
      await tx.ventureOffer.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId,
          investorName: bid.firmName,
          counterpartyType: 'VC',
          status: 'TERM_SHEET',
          preMoney: latest.preMoney,
          amount: latest.price,
          receivedOn: latest.submittedAt,
          createdBy: tenant.userId,
          updatedBy: tenant.userId,
        },
      });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.offer.modelled', { type: 'venture_offer', id }, requestId));
      return { ventureOfferId: id };
    });
  }

  // ------------------------------------------------------------------ bidder

  private async myBid(tx: TransactionClient, dealId: string) {
    // RLS returns only the caller's own bid.
    const bid = await tx.bid.findFirst({ where: { dealId } });
    if (!bid) throw new NotFoundException();
    return bid;
  }

  /**
   * A bidder's own view: the process, their bid and offers, their questions
   * and every answer published to all. Until the NDA is accepted, the shared
   * view and published answers stay closed.
   */
  async mine(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, isBidder, { action: 'sale.bid.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const [process, bid, deal, seller] = await Promise.all([
        this.process(tx, dealId),
        this.myBid(tx, dealId),
        tx.deal.findFirst({ where: { id: dealId }, select: { name: true, targetName: true, baseCurrency: true } }),
        tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } }),
      ]);
      // The winner starts their own diligence pact (linked, in their organization) and invites the seller's lead into it.
      const lead =
        bid.status === 'WON'
          ? await tx.dealMembership.findFirst({ where: { dealId, role: 'DEAL_LEAD', status: 'ACTIVE' }, select: { user: { select: { email: true, displayName: true } } } })
          : null;
      const open = bid.ndaAcceptedAt !== null || !process.ndaText;
      const [offers, questions, published] = await Promise.all([
        tx.bidOffer.findMany({ where: { dealId, bidId: bid.id }, orderBy: { version: 'asc' } }),
        tx.bidQuestion.findMany({ where: { dealId, bidId: bid.id }, orderBy: { askedAt: 'asc' } }),
        open ? tx.bidAnswerPublished.findMany({ where: { dealId }, orderBy: { publishedAt: 'asc' } }) : Promise.resolve([]),
      ]);
      return {
        pact: { organizationId: tenant.organizationId, dealId, name: deal?.name ?? '', company: deal?.targetName ?? '', companyType: seller?.companyType ?? null, currency: deal?.baseCurrency ?? 'USD' },
        handover: bid.status === 'WON' ? { sellerLeadName: lead?.user.displayName ?? null, sellerLeadEmail: lead?.user.email ?? null } : null,
        process: {
          status: process.status,
          round: process.round,
          offerDeadline: iso(process.offerDeadline),
          ndaText: process.ndaText,
          sharedSummary: open ? process.sharedSummary : null,
          dataRoomUrl: open ? process.dataRoomUrl : null,
        },
        bid: {
          id: bid.id,
          firmName: bid.firmName,
          // A bidder sees where they stand, never how others are doing.
          status: bid.status,
          round: bid.round,
          ndaAccepted: bid.ndaAcceptedAt !== null,
          passReason: bid.passReason,
        },
        offers: offers.map(offerView),
        questions: questions.map((question) => ({ id: question.id, question: question.question, askedAt: question.askedAt.toISOString(), answer: question.answer, scope: question.answerScope })),
        published: published.map((entry) => ({ id: entry.id, question: entry.question, answer: entry.answer, publishedAt: entry.publishedAt.toISOString() })),
      };
    });
  }

  async acceptNda(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, isBidder, { action: 'sale.nda.accepted', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const bid = await this.myBid(tx, dealId);
      if (bid.ndaAcceptedAt) return;
      await tx.bid.update({ where: { id: bid.id }, data: { ndaAcceptedAt: new Date(), ndaAcceptedBy: tenant.userId, status: bid.status === 'INVITED' ? 'ACTIVE' : bid.status } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.nda.accepted', { type: 'bid', id: bid.id }, requestId));
    });
    return { accepted: true };
  }

  private async openBid(tx: TransactionClient, dealId: string) {
    const [process, bid] = await Promise.all([this.process(tx, dealId), this.myBid(tx, dealId)]);
    if (process.ndaText && !bid.ndaAcceptedAt) throw new ForbiddenException({ code: 'NDA_REQUIRED' });
    if (process.status !== 'OPEN' || !(['ACTIVE', 'OFFERED', 'SHORTLISTED', 'INVITED'] as string[]).includes(bid.status)) throw new ConflictException({ code: 'BID_CLOSED' });
    return { process, bid };
  }

  async ask(tenant: TenantContext, dealId: string, body: AskBody, requestId: string) {
    await this.access.require(tenant, dealId, isBidder, { action: 'sale.question.asked', requestId });
    const id = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      const { bid } = await this.openBid(tx, dealId);
      await tx.bidQuestion.create({ data: { id, organizationId: tenant.organizationId, dealId, bidId: bid.id, question: body.question, askedBy: tenant.userId } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.question.asked', { type: 'bid_question', id }, requestId));
    });
    return { id };
  }

  /** Submit or revise an offer until the deadline. Every version is kept. */
  async offer(tenant: TenantContext, dealId: string, body: OfferBody, requestId: string) {
    await this.access.require(tenant, dealId, isBidder, { action: 'sale.offer.submitted', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const { process, bid } = await this.openBid(tx, dealId);
      if (process.offerDeadline && process.offerDeadline.getTime() < Date.now()) throw new ConflictException({ code: 'DEADLINE_PASSED' });
      const last = await tx.bidOffer.findFirst({ where: { dealId, bidId: bid.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const id = newId();
      const version = (last?.version ?? 0) + 1;
      await tx.bidOffer.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId,
          bidId: bid.id,
          version,
          round: process.round,
          price: body.price,
          currency: body.currency,
          preMoney: body.preMoney ?? null,
          structure: body.structure,
          conditions: body.conditions ?? null,
          validUntil: body.validUntil ? new Date(`${body.validUntil}T00:00:00Z`) : null,
          submittedBy: tenant.userId,
        },
      });
      if (bid.status !== 'SHORTLISTED') await tx.bid.update({ where: { id: bid.id }, data: { status: 'OFFERED' } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, version === 1 ? 'sale.offer.submitted' : 'sale.offer.revised', { type: 'bid_offer', id }, requestId));
      return { id, version };
    });
  }

  async pass(tenant: TenantContext, dealId: string, body: PassBody, requestId: string) {
    await this.access.require(tenant, dealId, isBidder, { action: 'sale.bid.passed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const { bid } = await this.openBid(tx, dealId);
      await tx.bid.update({ where: { id: bid.id }, data: { status: 'PASSED', passReason: body.reason ?? null, decidedAt: new Date() } });
      await appendAuditEvent(tx, this.audit(tenant, dealId, 'sale.bid.passed', { type: 'bid', id: bid.id }, requestId));
    });
    return { status: 'PASSED' };
  }
}
