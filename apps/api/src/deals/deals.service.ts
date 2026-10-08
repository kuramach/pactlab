import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DealSummary } from '@pactlab/contracts';
import {
  appendAuditEvent,
  createDealWithLead,
  dealMemberships,
  dealParties,
  deals,
  withTenant,
  type DealMemberRecord,
  type DealRecord,
  type PrismaClient,
} from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { PRISMA } from '../tokens';
import { DealAccess } from './deal-access';
import type {
  AddMemberCommand,
  CreateDealCommand,
  DealMemberView,
  UpdateDealCommand,
} from './deals.schemas';

function toSummary(deal: DealRecord): DealSummary {
  return { ...deal, createdAt: deal.createdAt.toISOString() };
}

function toMemberView(member: DealMemberRecord): DealMemberView {
  return { ...member, createdAt: member.createdAt.toISOString() };
}

/** Deal access. Scope comes only from the verified tenant context; RLS enforces it. */
@Injectable()
export class DealsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async list(tenant: TenantContext, query?: string): Promise<DealSummary[]> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const rows = await (query ? deals.search(tx, query) : deals.list(tx));
      const parties = await dealParties.forDeals(tx, rows.map((row) => row.id));
      return rows.map((row) => ({
        ...toSummary(row),
        parties: (parties.get(row.id) ?? []).map(({ role, name, ownership, ticker }) => ({ role, name, ownership, ticker })),
      }));
    });
  }

  async get(tenant: TenantContext, dealId: string): Promise<DealSummary | null> {
    const row = await withTenant(this.prisma, tenant, (tx) => deals.get(tx, dealId));
    return row ? toSummary(row) : null;
  }

  /** Any active organization member may open a deal; they become its DEAL_LEAD. */
  async create(
    tenant: TenantContext,
    command: CreateDealCommand,
    requestId: string,
  ): Promise<DealSummary> {
    const deal = await createDealWithLead(this.prisma, tenant, command, async (tx, created) => {
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId: created.id,
        actorUserId: tenant.userId,
        action: 'deal.created',
        targetType: 'deal',
        targetId: created.id,
        outcome: 'SUCCEEDED',
        requestId,
      });
    });
    return toSummary(deal);
  }

  async update(
    tenant: TenantContext,
    dealId: string,
    command: UpdateDealCommand,
    requestId: string,
  ): Promise<DealSummary> {
    await this.access.require(tenant, dealId, 'DEAL_WRITE', { action: 'deal.updated', requestId });
    const deal = await withTenant(this.prisma, tenant, async (tx) => {
      const updated = await deals.update(tx, dealId, command);
      if (updated) {
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'deal.updated',
          targetType: 'deal',
          targetId: dealId,
          outcome: 'SUCCEEDED',
          requestId,
        });
      }
      return updated;
    });
    if (!deal) throw new NotFoundException();
    return toSummary(deal);
  }

  async members(
    tenant: TenantContext,
    dealId: string,
    requestId: string,
  ): Promise<DealMemberView[]> {
    await this.access.require(tenant, dealId, 'DEAL_READ', {
      action: 'deal.members.list',
      requestId,
    });
    const rows = await withTenant(this.prisma, tenant, (tx) => dealMemberships.list(tx, dealId));
    return rows.map(toMemberView);
  }

  async addMember(
    tenant: TenantContext,
    dealId: string,
    command: AddMemberCommand,
    requestId: string,
  ): Promise<DealMemberView> {
    await this.access.require(tenant, dealId, 'DEAL_MEMBERS_MANAGE', {
      action: 'deal.member.added',
      requestId,
    });
    const member = await withTenant(this.prisma, tenant, async (tx) => {
      const added = await dealMemberships.upsert(tx, {
        organizationId: tenant.organizationId,
        dealId,
        ...command,
      });
      if (added) {
        await appendAuditEvent(tx, {
          organizationId: tenant.organizationId,
          dealId,
          actorUserId: tenant.userId,
          action: 'deal.member.added',
          targetType: 'user',
          targetId: command.userId,
          outcome: 'SUCCEEDED',
          requestId,
        });
      }
      return added;
    });
    // Users outside the organization are not addressable.
    if (!member) throw new NotFoundException();
    return toMemberView(member);
  }
}
