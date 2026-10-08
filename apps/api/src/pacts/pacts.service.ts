import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DealPartiesResponse,
  DealPartyView,
  DealSummary,
  SourcePlanResponse,
  StartPactCommand,
  UpdatePartyCommand,
} from '@pactlab/contracts';
import {
  appendAuditEvent,
  connections,
  createDealWithLead,
  dealParties,
  deals,
  withTenant,
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
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

function toPartyView(party: DealPartyRecord): DealPartyView {
  return { ...party, updatedAt: party.updatedAt.toISOString() };
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
    const transactionType = deriveTransactionType(command.buyer, command.seller);
    const deal = await createDealWithLead(
      this.prisma,
      tenant,
      { name: command.name, targetName: command.seller.name, transactionType, baseCurrency: command.baseCurrency },
      async (tx, created) => {
        const scope = { organizationId: tenant.organizationId, dealId: created.id };
        await dealParties.create(tx, { ...scope, role: 'BUYER', ...command.buyer });
        await dealParties.create(tx, { ...scope, role: 'SELLER', ...command.seller });
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
    return { ...deal, createdAt: deal.createdAt.toISOString() };
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
            methods: CONNECT_METHODS.map((method) => ({ method, availability: source.availability[method] })),
            connections: feeding,
            status: feeding.length > 0 ? ('CONNECTED' as const) : ('NOT_CONNECTED' as const),
          };
        }),
      };
    });
  }
}
