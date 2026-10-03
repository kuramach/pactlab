import { Inject, Injectable } from '@nestjs/common';
import type { DealSummary } from '@pactlab/contracts';
import { deals, withTenant, type DealRecord, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { PRISMA } from '../tokens';

function toSummary(deal: DealRecord): DealSummary {
  return { ...deal, createdAt: deal.createdAt.toISOString() };
}

/** Read-side deal access. Scope comes only from the verified tenant context; RLS enforces it. */
@Injectable()
export class DealsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(tenant: TenantContext, query?: string): Promise<DealSummary[]> {
    const rows = await withTenant(this.prisma, tenant, (tx) => (query ? deals.search(tx, query) : deals.list(tx)));
    return rows.map(toSummary);
  }

  async get(tenant: TenantContext, dealId: string): Promise<DealSummary | null> {
    const row = await withTenant(this.prisma, tenant, (tx) => deals.get(tx, dealId));
    return row ? toSummary(row) : null;
  }
}
