import { BadRequestException, Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type {
  AskingPriceInput,
  AskingPriceView,
  DealPartiesResponse,
  DealPartyView,
  DealSummary,
  SourcePlanResponse,
  StartPactCommand,
  UpdatePartyCommand,
} from '@pactlab/contracts';
import {
  appendAuditEvent,
  askingPrices,
  connections,
  createDealWithLead,
  dealParties,
  deals,
  withTenant,
  type AskingPriceRecord,
  type DealPartyRecord,
  type PrismaClient,
} from '@pactlab/db';
import {
  CONNECT_METHODS,
  deriveTransactionType,
  sourceKindForProvider,
  sourcesFor,
  type PartyRole,
  type SourceKind,
  type TenantContext,
  phaseOf,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

function toPartyView(party: DealPartyRecord): DealPartyView {
  return { ...party, updatedAt: party.updatedAt.toISOString() };
}

function toAskingView(record: AskingPriceRecord): AskingPriceView {
  return { ...record, recordedAt: record.recordedAt.toISOString() };
}

function derivedFrom(parties: readonly DealPartyRecord[]) {
  const buyer = parties.find((party) => party.role === 'BUYER');
  const seller = parties.find((party) => party.role === 'SELLER');
  return buyer && seller ? deriveTransactionType(buyer, seller) : null;
}

/**
 * Pacts: a deal created together with its buying and selling entities. The
 * transaction type is derived from their ownership once, at creation.
 */
@Injectable()
export class PactsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  /** Any active organization member may start a Pact; they become its DEAL_LEAD. */
  async start(tenant: TenantContext, command: StartPactCommand, requestId: string): Promise<DealSummary> {
    // A seller-led pact has no single buyer yet: it is typed as a private acquisition until one is chosen.
    const transactionType = deriveTransactionType(command.buyer ?? { ownership: 'PRIVATE' }, command.seller);
    // Guests work inside the pacts they were invited to; they never start one in another organization (ADR 0014).
    if (tenant.organizationRole === 'GUEST') throw new ForbiddenException();
    const deal = await createDealWithLead(
      this.prisma,
      tenant,
      { name: command.name, targetName: command.seller.name, transactionType, baseCurrency: command.baseCurrency, initiatedBy: command.initiatedBy },
      async (tx, created) => {
        const scope = { organizationId: tenant.organizationId, dealId: created.id };
        if (command.buyer) await dealParties.create(tx, { ...scope, role: 'BUYER', ...command.buyer });
        await dealParties.create(tx, { ...scope, role: 'SELLER', ...command.seller });
        // A seller-led pact runs a bid process (T-097, ADR 0015).
        if (command.initiatedBy === 'SELLER') {
          await tx.saleProcess.create({ data: { ...scope, updatedBy: tenant.userId } });
        }
        if (command.askingPrice) {
          await askingPrices.record(tx, { ...scope, ...command.askingPrice, recordedBy: tenant.userId });
          await appendAuditEvent(tx, {
            organizationId: tenant.organizationId,
            dealId: created.id,
            actorUserId: tenant.userId,
            action: 'asking_price.recorded',
            targetType: 'deal',
            targetId: created.id,
            outcome: 'SUCCEEDED',
            requestId,
          });
        }
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId: created.id,
          actorUserId: tenant.userId,
          action: 'pact.started',
          targetType: 'deal',
          targetId: created.id,
          outcome: 'SUCCEEDED',
          requestId,
        });
      },
    );
    return { ...deal, phase: phaseOf(deal.stage), createdAt: deal.createdAt.toISOString() };
  }

  /** The current asking price and its history. Buyer-side analysis only. */
  async askingPrice(
    tenant: TenantContext,
    dealId: string,
    requestId: string,
  ): Promise<{ current: AskingPriceView | null; history: AskingPriceView[] }> {
    await this.access.require(tenant, dealId, 'BUYER_ANALYSIS_READ', { action: 'asking_price.read', requestId });
    const history = (await withTenant(this.prisma, tenant, (tx) => askingPrices.history(tx, dealId))).map(toAskingView);
    return { current: history[0] ?? null, history };
  }

  /** Record the seller's (revised) asking price as the next version. */
  async recordAskingPrice(
    tenant: TenantContext,
    dealId: string,
    input: AskingPriceInput,
    requestId: string,
  ): Promise<{ current: AskingPriceView | null; history: AskingPriceView[] }> {
    await this.access.require(tenant, dealId, 'DEAL_WRITE', { action: 'asking_price.recorded', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const { created } = await askingPrices.record(tx, {
        ...input,
        organizationId: tenant.organizationId,
        dealId,
        recordedBy: tenant.userId,
      });
      if (created) {
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'asking_price.recorded',
          targetType: 'deal',
          targetId: dealId,
          outcome: 'SUCCEEDED',
          requestId,
        });
      }
    });
    return this.askingPrice(tenant, dealId, requestId);
  }

  async parties(tenant: TenantContext, dealId: string, requestId: string): Promise<DealPartiesResponse> {
    await this.access.require(tenant, dealId, 'DEAL_READ', { action: 'deal.parties.list', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await deals.get(tx, dealId);
      if (!deal) throw new NotFoundException();
      const rows = await dealParties.list(tx, dealId);
      return {
        items: rows.map(toPartyView),
        derivedTransactionType: derivedFrom(rows),
        transactionType: deal.transactionType,
      };
    });
  }

  /**
   * Correct a party. The deal's transaction type stays as created; a change
   * in ownership shows up as `derivedTransactionType` differing from it.
   * Renaming the seller keeps the deal's target name in step.
   */
  async updateParty(
    tenant: TenantContext,
    dealId: string,
    role: PartyRole,
    command: UpdatePartyCommand,
    requestId: string,
  ): Promise<DealPartiesResponse> {
    await this.access.require(tenant, dealId, 'DEAL_WRITE', { action: 'deal.party.updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const current = (await dealParties.list(tx, dealId)).find((party) => party.role === role);
      if (!current) throw new NotFoundException();
      const ownership = command.ownership ?? current.ownership;
      const listing =
        ownership === 'PRIVATE'
          ? { ticker: null, exchange: null }
          : { ticker: command.ticker ?? current.ticker, exchange: command.exchange ?? current.exchange };
      // A public company is named by its ticker.
      if (ownership === 'PUBLIC' && !listing.ticker) throw new BadRequestException('A public company needs its ticker');
      await dealParties.update(tx, dealId, role, { ...command, ownership, ...listing });
      if (role === 'SELLER' && command.name) await deals.update(tx, dealId, { targetName: command.name });
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'deal.party.updated',
        targetType: role === 'BUYER' ? 'deal_buyer' : 'deal_seller',
        targetId: dealId,
        outcome: 'SUCCEEDED',
        requestId,
      });
    });
    return this.parties(tenant, dealId, requestId);
  }

  /**
   * The sources to collect for this deal, from the seller's company type,
   * merged with the connections that already feed each one. Deals that
   * predate Pacts fall back to the software sources.
   */
  async sourcePlan(tenant: TenantContext, dealId: string, requestId: string): Promise<SourcePlanResponse> {
    await this.access.require(tenant, dealId, 'DEAL_READ', { action: 'deal.source_plan.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const seller = (await dealParties.list(tx, dealId)).find((party) => party.role === 'SELLER');
      const plan = sourcesFor(seller?.companyType ?? 'SOFTWARE_SAAS');
      const rows = await connections.list(tx, dealId);
      const attached: { kind: SourceKind | null; view: SourcePlanResponse['sources'][number]['connections'][number] }[] = [];
      for (const row of rows) {
        const run = await tx.syncRun.findFirst({
          where: { dealId, connectionId: row.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { status: true },
        });
        attached.push({
          kind: sourceKindForProvider(row.provider),
          view: {
            id: row.id,
            provider: row.provider,
            displayName: row.displayName,
            mode: row.mode,
            lastSyncStatus: run?.status ?? null,
          },
        });
      }
      return {
        companyType: seller?.companyType ?? null,
        packAvailable: plan.packAvailable,
        note: plan.note,
        sources: plan.sources.map((source) => {
          const feeding = attached.filter((entry) => entry.kind === source.kind).map((entry) => entry.view);
          return {
            kind: source.kind,
            label: source.label,
            provider: source.provider,
            providerLabel: source.providerLabel,
            why: source.why,
            produces: source.produces,
            upload: source.upload,
            methods: CONNECT_METHODS.flatMap((method) => {
              const availability = source.availability[method];
              return availability ? [{ method, availability }] : [];
            }),
            connections: feeding,
            status: feeding.length > 0 ? ('CONNECTED' as const) : ('NOT_CONNECTED' as const),
          };
        }),
      };
    });
  }
}
