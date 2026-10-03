import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import {
  dealParamsSchema,
  listDealsQuerySchema,
  type DealSummary,
  type ListDealsQuery,
  type ListDealsResponse,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DealsService } from './deals.service';

@Controller('v1/deals')
export class DealsController {
  constructor(@Inject(DealsService) private readonly dealsService: DealsService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listDealsQuerySchema)) query: ListDealsQuery,
  ): Promise<ListDealsResponse> {
    return { items: await this.dealsService.list(tenant, query.q) };
  }

  @Get(':dealId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<DealSummary> {
    // Another tenant's deal and a nonexistent deal are indistinguishable.
    const deal = await this.dealsService.get(tenant, params.dealId);
    if (!deal) throw new NotFoundException();
    return deal;
  }
}
