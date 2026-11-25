import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { SourceIndex } from '@pactlab/ai';
import {
  D,
  roundCheckOf,
  sideLetters,
  SPV_ACCREDITATION_CHECK_ID,
  SPV_ACCREDITATION_CHECK_VERSION,
  SPV_CAP_TABLE,
  SPV_FINANCIALS,
  spvAccreditationCheck,
  spvEconomics,
  spvReturns,
  SpvReturnsError,
  vehicleStatement,
  INVOICE_LINE,
  type SpvEconomics,
  type SpvReturnScenario,
  type SpvRoundCheck,
} from '@pactlab/calculations';
import type { Page } from '@pactlab/contracts';
import { afterCursor, appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  ACCREDITATION_STATUS_LABELS,
  ACCREDITATION_SUFFICIENT,
  INVESTOR_VIEW_SECTION_LABELS,
  INVESTOR_VIEW_SECTIONS,
  newId,
  permissionsForDealRole,
  ruleProposals,
  SPV_EXEMPTION_LABELS,
  SPV_GUARDRAIL,
  SPV_NO_INVENTED_FIGURES,
  SPV_SCENARIO_LABEL,
  type AccreditationStatus,
  type DealRole,
  type FindingRule,
  type InvestorViewSection,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { InvitationsService } from '../invitations/invitations.service';
import { loadPackEvidence } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import type { InviteBody, SeatBody, SeatsQuery, SeatUpdate, VehicleBody, VersionsQuery } from './spv.schemas';

const has = (role: DealRole, permission: Parameters<ReturnType<typeof permissionsForDealRole>['has']>[0]) => permissionsForDealRole(role).has(permission);
/** The organizer's own side: analysis readers see the vehicle; writers change it; only the deal lead publishes outward. */
const canRead = (role: DealRole) => has(role, 'BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => has(role, 'DEAL_WRITE') && has(role, 'BUYER_ANALYSIS_READ');
const canPublish = (role: DealRole) => role === 'DEAL_LEAD';
const isInvestor = (role: DealRole) => role === 'INVESTOR';
/** The most document pages one SPV read takes: a round summary, instruments and the vehicle's papers. */
const MAX_PAGES = 2000;

type SeatRow = Awaited<ReturnType<TransactionClient['pactInvestor']['findMany']>>[number];

export interface SeatView {
  id: string;
  label: string;
  reference: string;
  commitment: string | null;
  currency: string;
  status: string;
  accreditationStatus: AccreditationStatus;
  accreditationLabel: string;
  accreditationProvider: string | null;
  accreditationUrl: string | null;
  accreditationEvidence: string | null;
  accreditationUpdatedAt: string | null;
  /** Whether the tracked status is enough for the vehicle's exemption (null when no document states one). */
  sufficient: boolean | null;
  member: 'NONE' | 'INVITED' | 'JOINED';
}

/** Exactly the allow-listed sections (INVESTOR_VIEW_SECTIONS); nothing else can be stored (database CHECK). */
export interface InvestorViewContent {
  meta: { vehicleName: string; company: string; currency: string; guardrail: string; scenarioLabel: string; noInventedFigures: string; sections: Record<InvestorViewSection, string> };
  claims: { statement: string; status: string; rationale: string | null }[];
  capTable: SpvRoundCheck;
  economics: SpvEconomics;
  scenarios: { assumptions: { downside: string | null; base: string | null; upside: string | null }; items: SpvReturnScenario[]; unavailable: string | null };
}

const text = (value: { toFixed(): string } | null | undefined) => (value === null || value === undefined ? null : value.toFixed());
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Startup equity SPV (T-141, ADR 0043). One pact, three parties, two walled directions: the
 * organizer (the pact's own side) diligences the startup's round and runs the vehicle; investors
 * are seated as guests (deal role INVESTOR, one seat each) and read only their own seat and the
 * organizer's published, frozen investor view; the startup sees the vehicle as a single investor
 * and never the investor list (RLS). Everything computed here is deterministic, from documents and
 * imports only. Diligence support only — no legal advice, no securities-offering, broker-dealer or
 * investment-adviser function, no accreditation determination.
 */
@Injectable()
export class SpvService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  private async requireSpv(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true, name: true } } } });
    if (!deal) throw new NotFoundException();
    const seller = deal.parties[0];
    if (seller?.companyType !== 'STARTUP_SPV') throw new UnprocessableEntityException({ code: 'NOT_AN_SPV', message: 'This pact is not a startup equity SPV' });
    return { currency: deal.baseCurrency, company: seller.name };
  }

  private async audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  /** The startup's evidence and the pact's readable pages (never HR, pay or performance), as the pack checks read them. */
  private async inputs(tx: TransactionClient, dealId: string) {
    const evidence = await loadPackEvidence(tx, dealId, [SPV_CAP_TABLE, SPV_FINANCIALS, INVOICE_LINE]);
    // bounded: the pact's readable document pages, at most MAX_PAGES (a round summary, instruments, the vehicle's papers)
    const pageRows = await tx.documentPage.findMany({
      where: { dealId, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } } },
      select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
      orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
      take: MAX_PAGES,
    });
    const pages = pageRows.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text ?? '' }));
    const names = new Map(pageRows.map((page) => [page.documentId, page.document.fileName]));
    return { evidence, pages, pageRows, names };
  }

  // whole-set: the accreditation check and the commitment total need every seat of the vehicle (tens), never returned as a list
  private allSeats = (tx: TransactionClient, dealId: string) => tx.pactInvestor.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  /** Everything the SPV page computes, from the same inputs the checks read. */
  private async analysis(tx: TransactionClient, dealId: string) {
    const deal = await this.requireSpv(tx, dealId);
    const vehicle = await tx.spvVehicle.findFirst({ where: { dealId } });
    const { evidence, pages, names } = await this.inputs(tx, dealId);
    const { documents, check, round } = roundCheckOf(evidence, pages);
    const statement = vehicleStatement(documents);
    const seats = await this.allSeats(tx, dealId);
    const active = seats.filter((seat) => seat.status === 'ACTIVE');
    const commitments = active.reduce((sum, seat) => sum.plus(seat.commitment?.toString() ?? '0'), new D(0)).plus(statement.agreement?.organizerCommitment?.value.amount ?? 0);
    const currency = check.currency ?? deal.currency;
    const economics = spvEconomics(statement, commitments, currency);
    const assumptions = { downside: text(vehicle?.downsideMultiple), base: text(vehicle?.baseMultiple), upside: text(vehicle?.upsideMultiple) };
    let scenarios: SpvReturnScenario[] = [];
    let unavailable: string | null = null;
    const exits = Object.fromEntries(
      (
        [
          ['DOWNSIDE', assumptions.downside],
          ['BASE', assumptions.base],
          ['UPSIDE', assumptions.upside],
        ] as const
      ).flatMap(([key, value]) => (value === null ? [] : [[key, new D(value)]])),
    );
    if (Object.keys(exits).length === 0) unavailable = 'State the exit paths (multiples of the round’s post-money) to compute return scenarios.';
    else
      try {
        scenarios = spvReturns(economics, { pricePerShare: check.pricePerShare, postRoundShares: check.postRoundShares.recomputed }, exits);
      } catch (error) {
        if (!(error instanceof SpvReturnsError)) throw error;
        unavailable = error.message;
      }
    return { deal, vehicle, names, documents, round, check, statement, seats, economics, assumptions, scenarios, unavailable, currency };
  }

  private seatView(seat: SeatRow, exemption: 'RULE_506B' | 'RULE_506C' | null, member: SeatView['member']): SeatView {
    const status = seat.accreditationStatus as AccreditationStatus;
    return {
      id: seat.id,
      label: seat.label,
      reference: seat.reference,
      commitment: seat.commitment ? seat.commitment.toFixed(2) : null,
      currency: seat.currency,
      status: seat.status,
      accreditationStatus: status,
      accreditationLabel: ACCREDITATION_STATUS_LABELS[status],
      accreditationProvider: seat.accreditationProvider,
      accreditationUrl: seat.accreditationUrl,
      accreditationEvidence: seat.accreditationEvidence,
      accreditationUpdatedAt: seat.accreditationUpdatedAt?.toISOString() ?? null,
      sufficient: exemption ? (ACCREDITATION_SUFFICIENT[exemption] as readonly string[]).includes(status) : null,
      member,
    };
  }

  /** The organizer's SPV page: the round check, claims, vehicle economics, side letters, accreditation and published versions. */
  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'spv.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const a = await this.analysis(tx, dealId);
      // bounded: the pact's rule-settled claims (tens: one per round claim)
      const claims = await tx.dealClaim.findMany({ where: { dealId, origin: 'PACK_RULE' }, select: { statement: true, status: true, rationale: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const exemption = a.statement.exemption?.value ?? null;
      const active = a.seats.filter((seat) => seat.status === 'ACTIVE');
      const latest = await tx.investorViewVersion.findFirst({ where: { dealId }, orderBy: { version: 'desc' }, select: { version: true, publishedAt: true, contentSha256: true } });
      const cite = (quote: { documentId: string; pageNumber: number; quote: string } | null | undefined) => (quote ? { documentId: quote.documentId, documentName: a.names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote } : null);
      return {
        guardrail: SPV_GUARDRAIL,
        noInventedFigures: SPV_NO_INVENTED_FIGURES,
        scenarioLabel: SPV_SCENARIO_LABEL,
        canEdit: canWrite(role),
        canPublish: canPublish(role),
        currency: a.currency,
        company: a.deal.company,
        vehicle: a.vehicle ? { vehicleName: a.vehicle.vehicleName, ...a.assumptions } : null,
        documents: a.documents.map((document) => ({ documentId: document.documentId, documentName: a.names.get(document.documentId) ?? null, kind: document.kind })),
        round: {
          check: a.check,
          citations: {
            preMoney: cite(a.round.preMoney?.quote),
            postRoundShares: cite(a.round.postRoundShares?.quote),
          },
        },
        claims: claims.map((claim) => ({ statement: claim.statement, status: claim.status, rationale: claim.rationale })),
        economics: a.economics,
        scenarios: { assumptions: a.assumptions, items: a.scenarios, unavailable: a.unavailable },
        // Organizer-side only: never part of any investor's view.
        sideLetters: sideLetters(a.documents).map((letter) => ({
          documentId: letter.documentId,
          documentName: a.names.get(letter.documentId) ?? null,
          investorRef: letter.investorRef,
          effects: letter.effects.map((effect) => ({ kind: effect.kind, economic: effect.economic, value: effect.value, citation: cite(effect.quote) })),
          disclosed: a.statement.sideLetterDisclosure?.value === 'DISCLOSED',
        })),
        offering: {
          exemption,
          exemptionLabel: exemption ? SPV_EXEMPTION_LABELS[exemption] : null,
          exemptionCitation: cite(a.statement.exemption?.quote),
          formD: cite(a.statement.formD),
          seats: active.length,
          seatsSufficient: exemption ? active.filter((seat) => (ACCREDITATION_SUFFICIENT[exemption] as readonly string[]).includes(seat.accreditationStatus)).length : null,
        },
        published: latest ? { version: latest.version, publishedAt: latest.publishedAt.toISOString(), contentSha256: latest.contentSha256 } : null,
      };
    });
  }

  async saveVehicle(tenant: TenantContext, dealId: string, body: VehicleBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'spv.vehicle_saved', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSpv(tx, dealId);
      const data = { vehicleName: body.vehicleName, downsideMultiple: body.downsideMultiple, baseMultiple: body.baseMultiple, upsideMultiple: body.upsideMultiple, updatedBy: tenant.userId, updatedAt: new Date() };
      await tx.spvVehicle.upsert({ where: { organizationId_dealId: { organizationId: tenant.organizationId, dealId } }, create: { organizationId: tenant.organizationId, dealId, ...data }, update: data });
      await this.audit(tx, tenant, dealId, 'spv.vehicle_saved', 'deal', dealId, requestId);
      return { saved: true };
    });
  }

  /** The vehicle's seats, oldest first, keyset-paged. Organizer side only. */
  async seats(tenant: TenantContext, dealId: string, query: SeatsQuery, requestId: string): Promise<Page<SeatView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'spv.seats_read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSpv(tx, dealId);
      const [rows, total, members, invited, pages] = await Promise.all([
        tx.pactInvestor.findMany({ where: { dealId, ...afterCursor('createdAt', query.cursor, { direction: 'asc', asDate: true }) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit + 1 }),
        tx.pactInvestor.count({ where: { dealId } }),
        // bounded: the memberships of the seats on this page (one or two people per seat)
        tx.dealMembership.findMany({ where: { dealId, role: 'INVESTOR', status: 'ACTIVE' }, select: { investorId: true }, take: 1000 }),
        tx.dealInvitation.findMany({ where: { dealId, side: 'INVESTOR', status: 'PENDING', expiresAt: { gt: new Date() } }, select: { investorId: true }, take: 1000 }),
        this.inputs(tx, dealId),
      ]);
      const exemption = vehicleStatement(roundCheckOf([], pages.pages).documents).exemption?.value ?? null;
      const joined = new Set(members.map((row) => row.investorId));
      const pending = new Set(invited.map((row) => row.investorId));
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((seat) => this.seatView(seat, exemption, joined.has(seat.id) ? 'JOINED' : pending.has(seat.id) ? 'INVITED' : 'NONE')),
        nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id]), 'utf8').toString('base64url') : null,
        total,
        limit: query.limit,
      };
    });
  }

  async addSeat(tenant: TenantContext, dealId: string, body: SeatBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'spv.seat_added', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireSpv(tx, dealId);
      const existing = await tx.pactInvestor.findFirst({ where: { dealId, reference: body.reference }, select: { id: true } });
      if (existing) throw new ConflictException({ code: 'REFERENCE_TAKEN', message: 'Another seat has that reference' });
      const id = newId();
      await tx.pactInvestor.create({
        data: { id, organizationId: tenant.organizationId, dealId, label: body.label, reference: body.reference, commitment: body.commitment, currency: deal.currency, accreditationStatus: body.accreditationStatus, accreditationUpdatedAt: new Date(), accreditationUpdatedBy: tenant.userId, createdBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'spv.seat_added', 'pact_investor', id, requestId);
      return { id };
    });
  }

  /** Commitment, withdrawal, or the tracked accreditation status with its specialist link and evidence pointer. */
  async updateSeat(tenant: TenantContext, dealId: string, seatId: string, body: SeatUpdate, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'spv.seat_updated', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSpv(tx, dealId);
      const seat = await tx.pactInvestor.findFirst({ where: { id: seatId, dealId } });
      if (!seat) throw new NotFoundException();
      const accreditation = body.accreditationStatus !== undefined || body.accreditationProvider !== undefined || body.accreditationUrl !== undefined || body.accreditationEvidence !== undefined;
      await tx.pactInvestor.update({
        where: { id: seatId },
        data: {
          ...(body.commitment !== undefined ? { commitment: body.commitment } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.accreditationStatus !== undefined ? { accreditationStatus: body.accreditationStatus } : {}),
          ...(body.accreditationProvider !== undefined ? { accreditationProvider: body.accreditationProvider } : {}),
          ...(body.accreditationUrl !== undefined ? { accreditationUrl: body.accreditationUrl } : {}),
          ...(body.accreditationEvidence !== undefined ? { accreditationEvidence: body.accreditationEvidence } : {}),
          ...(accreditation ? { accreditationUpdatedAt: new Date(), accreditationUpdatedBy: tenant.userId } : {}),
        },
      });
      // A withdrawn seat's people leave the pact with it.
      if (body.status === 'WITHDRAWN') await tx.dealMembership.updateMany({ where: { dealId, role: 'INVESTOR', investorId: seatId }, data: { status: 'REVOKED' } });
      await this.audit(tx, tenant, dealId, accreditation ? 'spv.accreditation_updated' : 'spv.seat_updated', 'pact_investor', seatId, requestId);
      return { updated: true };
    });
  }

  /** Invite a person to one seat: they join this pact only, as that investor, and see only their seat and the published view. */
  async invite(tenant: TenantContext, dealId: string, seatId: string, body: InviteBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'spv.investor_invited', requestId });
    const seat = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSpv(tx, dealId);
      return tx.pactInvestor.findFirst({ where: { id: seatId, dealId, status: 'ACTIVE' }, select: { id: true } });
    });
    if (!seat) throw new NotFoundException();
    return this.invitations.create(tenant, dealId, { email: body.email, side: 'INVESTOR', role: 'INVESTOR', investorId: seat.id }, requestId);
  }

  /**
   * Run the SPV checks: the pack rules over the round and the vehicle's documents, and the
   * accreditation check over the seats. Drafts on Findings; a person decides each.
   */
  async runChecks(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'spv.checks_run', requestId });
    await withTenant(this.prisma, tenant, (tx) => this.requireSpv(tx, dealId));
    const packRun = await this.findings.runPackRules(tenant, dealId, requestId);
    const { pageRows, seats } = await withTenant(this.prisma, tenant, async (tx) => ({ ...(await this.inputs(tx, dealId)), seats: await this.allSeats(tx, dealId) }));
    const pages = pageRows.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text ?? '' }));
    const proposals = spvAccreditationCheck(
      pages,
      seats.map((seat) => ({ reference: seat.reference, status: seat.status, accreditation: seat.accreditationStatus })),
    );
    const index = new SourceIndex(pageRows.map((page) => ({ citationId: `${page.documentId}:${page.pageNumber}`, documentId: page.documentId, documentName: page.document.fileName, pageNumber: page.pageNumber, text: page.text ?? '', classification: page.document.dataClass })));
    const rule: FindingRule = { id: SPV_ACCREDITATION_CHECK_ID, version: SPV_ACCREDITATION_CHECK_VERSION, evidenceTypes: [], readsDocuments: true, detect: () => proposals };
    const run = ruleProposals(rule, { evidence: [], pages }, (quote) => {
      const check = index.verify({ citationId: `${quote.documentId}:${quote.pageNumber}`, quote: quote.quote });
      if (!check.ok) return null;
      const { citationId: _id, ...citation } = check.citation;
      return citation;
    });
    const recorded = await this.findings.recordProposals(tenant, dealId, run.proposals, { kind: 'SYSTEM', component: `${SPV_ACCREDITATION_CHECK_ID}@${SPV_ACCREDITATION_CHECK_VERSION}` }, requestId);
    return { created: packRun.created + recorded.created.length, existing: packRun.existing + recorded.existing, unresolvedQuotes: packRun.unresolvedQuotes + run.unresolved };
  }

  /**
   * The investor view's content, from the allow-list only: the round claims register, the
   * cap-table verification, the vehicle economics check and the return scenarios. It never reads
   * seats, side letters, findings, terms or notes, so none of them can reach an investor.
   */
  private async build(tx: TransactionClient, dealId: string): Promise<InvestorViewContent> {
    const a = await this.analysis(tx, dealId);
    if (!a.vehicle) throw new UnprocessableEntityException({ code: 'VEHICLE_REQUIRED', message: 'Name the vehicle before publishing' });
    // bounded: the pact's rule-settled claims (tens: one per round claim)
    const claims = await tx.dealClaim.findMany({ where: { dealId, origin: 'PACK_RULE' }, select: { statement: true, status: true, rationale: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const content: InvestorViewContent = {
      meta: {
        vehicleName: a.vehicle.vehicleName,
        company: a.deal.company,
        currency: a.currency,
        guardrail: SPV_GUARDRAIL,
        scenarioLabel: SPV_SCENARIO_LABEL,
        noInventedFigures: SPV_NO_INVENTED_FIGURES,
        sections: INVESTOR_VIEW_SECTION_LABELS,
      },
      claims: claims.map((claim) => ({ statement: claim.statement, status: claim.status, rationale: claim.rationale })),
      capTable: a.check,
      economics: a.economics,
      scenarios: { assumptions: a.assumptions, items: a.scenarios, unavailable: a.unavailable },
    };
    // The same allow-list the database enforces, checked before the write.
    if (Object.keys(content).some((key) => !(INVESTOR_VIEW_SECTIONS as readonly string[]).includes(key))) throw new UnprocessableEntityException({ code: 'NOT_ALLOWED' });
    return content;
  }

  async preview(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'spv.investor_view_previewed', requestId });
    return withTenant(this.prisma, tenant, (tx) => this.build(tx, dealId));
  }

  /** Freeze the current investor view as the next version. The deal lead's deliberate, audited act. */
  async publish(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canPublish, { action: 'spv.investor_view_published', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const content = await this.build(tx, dealId);
      const serialized = JSON.stringify(content);
      const latest = await tx.investorViewVersion.findFirst({ where: { dealId }, orderBy: { version: 'desc' }, select: { version: true } });
      const id = newId();
      const version = (latest?.version ?? 0) + 1;
      await tx.investorViewVersion.create({ data: { id, organizationId: tenant.organizationId, dealId, version, content: JSON.parse(serialized) as never, contentSha256: sha256(serialized), publishedBy: tenant.userId } });
      await this.audit(tx, tenant, dealId, 'spv.investor_view_published', 'investor_view_version', id, requestId);
      return { id, version };
    });
  }

  /** Published versions, newest first, keyset-paged (organizer side). */
  async versions(tenant: TenantContext, dealId: string, query: VersionsQuery, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'spv.investor_view_versions_read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSpv(tx, dealId);
      const [rows, total] = await Promise.all([
        tx.investorViewVersion.findMany({ where: { dealId, ...afterCursor('publishedAt', query.cursor, { asDate: true }) }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: { id: true, version: true, publishedAt: true, contentSha256: true } }),
        tx.investorViewVersion.count({ where: { dealId } }),
      ]);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({ id: row.id, version: row.version, publishedAt: row.publishedAt.toISOString(), contentSha256: row.contentSha256 })),
        nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify([last.publishedAt.toISOString(), last.id]), 'utf8').toString('base64url') : null,
        total,
        limit: query.limit,
      };
    });
  }

  /** An investor's own view: their seat and the latest published version. Nothing else of the pact; every read audited. */
  async mine(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, isInvestor, { action: 'spv.investor_view_read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      // RLS returns only the caller's own seat.
      const seat = await tx.pactInvestor.findFirst({ where: { dealId } });
      if (!seat) throw new ForbiddenException();
      const latest = await tx.investorViewVersion.findFirst({ where: { dealId }, orderBy: { version: 'desc' } });
      await this.audit(tx, tenant, dealId, 'spv.investor_view_read', 'investor_view_version', latest?.id ?? dealId, requestId);
      const status = seat.accreditationStatus as AccreditationStatus;
      return {
        guardrail: SPV_GUARDRAIL,
        seat: { reference: seat.reference, label: seat.label, commitment: seat.commitment ? seat.commitment.toFixed(2) : null, currency: seat.currency, status: seat.status, accreditationStatus: status, accreditationLabel: ACCREDITATION_STATUS_LABELS[status], accreditationProvider: seat.accreditationProvider },
        view: latest ? { version: latest.version, publishedAt: latest.publishedAt.toISOString(), contentSha256: latest.contentSha256, content: latest.content as unknown as InvestorViewContent } : null,
      };
    });
  }
}
