import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import {
  addMemberSchema,
  createDealSchema,
  updateDealSchema,
  type AddMemberCommand,
  type CreateDealCommand,
  type DealMemberView,
  type UpdateDealCommand,
} from './deals.schemas';
import { DealsService } from './deals.service';
import { RequestId } from './request-id.decorator';

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

  @Post()
  @HttpCode(201)
  async create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createDealSchema)) body: CreateDealCommand,
  ): Promise<DealSummary> {
    return this.dealsService.create(tenant, body, requestId);
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

  @Patch(':dealId')
  async update(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(updateDealSchema)) body: UpdateDealCommand,
  ): Promise<DealSummary> {
    return this.dealsService.update(tenant, params.dealId, body, requestId);
  }

  @Get(':dealId/members')
  async members(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<{ items: DealMemberView[] }> {
    return { items: await this.dealsService.members(tenant, params.dealId, requestId) };
  }

  @Post(':dealId/members')
  @HttpCode(201)
  async addMember(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberCommand,
  ): Promise<DealMemberView> {
    return this.dealsService.addMember(tenant, params.dealId, body, requestId);
  }
}
