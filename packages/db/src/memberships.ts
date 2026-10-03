import { newId, type DealId, type DealRole, type TenantContext } from '@pactlab/domain';
import type { PrismaClient, TransactionClient } from './client';
import type { DealRecord } from './repositories';
import { withTenant } from './tenant';

export interface DealMemberRecord {
  id: string;
  userId: string;
  displayName: string;
  role: DealRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  createdAt: Date;
}

export const dealMemberships = {
  /** The caller's active role on a deal, or null. Authorization starts here. */
  async roleOf(tx: TransactionClient, dealId: string, userId: string): Promise<DealRole | null> {
    const row = await tx.dealMembership.findFirst({
      where: { dealId, userId, status: 'ACTIVE' },
      select: { role: true },
    });
    return row?.role ?? null;
  },

  async list(tx: TransactionClient, dealId: string): Promise<DealMemberRecord[]> {
    const rows = await tx.dealMembership.findMany({
      where: { dealId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ user, ...row }) => ({ ...row, displayName: user.displayName }));
  },

  /**
   * Add or re-activate a member. Only users with an active membership in the
   * same organization can be added (organization membership RLS decides).
   */
  async upsert(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; userId: string; role: DealRole },
  ): Promise<DealMemberRecord | null> {
    const orgMember = await tx.organizationMembership.findFirst({
      where: { organizationId: input.organizationId, userId: input.userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!orgMember) return null;
    await tx.dealMembership.upsert({
      where: {
        organizationId_dealId_userId: {
          organizationId: input.organizationId,
          dealId: input.dealId,
          userId: input.userId,
        },
      },
      create: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        userId: input.userId,
        role: input.role,
      },
      update: { role: input.role, status: 'ACTIVE' },
    });
    const members = await dealMemberships.list(tx, input.dealId);
    return members.find((member) => member.userId === input.userId) ?? null;
  },
};

export interface CreateDealInput {
  name: string;
  targetName: string;
  transactionType: DealRecord['transactionType'];
  baseCurrency: string;
}

/**
 * Create a deal with the creator as DEAL_LEAD. The fresh deal id is added to
 * the permitted set for this one transaction only, so RLS admits the insert
 * and its RETURNING row; the insert policy still pins organization and creator.
 */
export async function createDealWithLead(
  prisma: PrismaClient,
  tenant: TenantContext,
  input: CreateDealInput,
  onCreated?: (tx: TransactionClient, deal: DealRecord) => Promise<void>,
): Promise<DealRecord> {
  const dealId = newId();
  const scoped: TenantContext = { ...tenant, dealIds: [...tenant.dealIds, dealId as DealId] };
  return withTenant(prisma, scoped, async (tx) => {
    const deal = await tx.deal.create({
      data: {
        id: dealId,
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        ...input,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        targetName: true,
        transactionType: true,
        stage: true,
        status: true,
        baseCurrency: true,
        createdAt: true,
      },
    });
    await tx.dealMembership.create({
      data: {
        organizationId: tenant.organizationId,
        dealId,
        userId: tenant.userId,
        role: 'DEAL_LEAD',
      },
    });
    await onCreated?.(tx, deal);
    return deal;
  });
}
