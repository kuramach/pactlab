import type { CompanyType, Ownership, PartyRole } from '@pactlab/domain';
import type { TransactionClient } from './client';

export interface DealPartyRecord {
  role: PartyRole;
  name: string;
  ownership: Ownership;
  ticker: string | null;
  exchange: string | null;
  website: string | null;
  companyType: CompanyType | null;
  updatedAt: Date;
}

export interface DealPartyInput {
  name: string;
  ownership: Ownership;
  ticker: string | null;
  exchange: string | null;
  website: string | null;
  companyType: CompanyType | null;
}

const partySelect = {
  role: true,
  name: true,
  ownership: true,
  ticker: true,
  exchange: true,
  website: true,
  companyType: true,
  updatedAt: true,
} as const;

const ROLE_ORDER: Record<PartyRole, number> = { BUYER: 0, SELLER: 1 };

/** The buying and selling entities of a deal. RLS scopes reads; writes need the buyer side. */
export const dealParties = {
  async list(tx: TransactionClient, dealId: string): Promise<DealPartyRecord[]> {
    const rows = await tx.dealParty.findMany({ where: { dealId }, select: partySelect });
    return rows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  },

  /** Parties for many deals at once, for the deals list. */
  async forDeals(tx: TransactionClient, dealIds: readonly string[]): Promise<Map<string, DealPartyRecord[]>> {
    const byDeal = new Map<string, DealPartyRecord[]>();
    if (dealIds.length === 0) return byDeal;
    const rows = await tx.dealParty.findMany({
      where: { dealId: { in: [...dealIds] } },
      select: { ...partySelect, dealId: true },
    });
    for (const { dealId, ...party } of rows) byDeal.set(dealId, [...(byDeal.get(dealId) ?? []), party]);
    for (const parties of byDeal.values()) parties.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    return byDeal;
  },

  async create(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; role: PartyRole } & DealPartyInput,
  ): Promise<DealPartyRecord> {
    return tx.dealParty.create({ data: input, select: partySelect });
  },

  /** Correct a party. Returns null when the deal has no such party (or it is not visible). */
  async update(
    tx: TransactionClient,
    dealId: string,
    role: PartyRole,
    input: Partial<DealPartyInput>,
  ): Promise<DealPartyRecord | null> {
    const updated = await tx.dealParty.updateMany({ where: { dealId, role }, data: input });
    if (updated.count === 0) return null;
    return tx.dealParty.findFirst({ where: { dealId, role }, select: partySelect });
  },
};
