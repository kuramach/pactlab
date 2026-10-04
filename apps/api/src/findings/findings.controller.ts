import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  createFindingSchema,
  findingParamsSchema,
  listFindingsQuerySchema,
  reviewFindingSchema,
  updateFindingSchema,
  type CreateFindingBody,
  type ListFindingsQuery,
  type ReviewFindingBody,
  type UpdateFindingBody,
} from './findings.schemas';
import { FindingsService } from './findings.service';

type FindingParams = { dealId: string; findingId: string };

@Controller('v1/deals/:dealId/findings')
export class FindingsController {
  constructor(@Inject(FindingsService) private readonly service: FindingsService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(listFindingsQuerySchema)) query: ListFindingsQuery,
  ) {
    return this.service.list(tenant, params.dealId, query, requestId);
  }

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(createFindingSchema)) body: CreateFindingBody,
  ) {
    return this.service.create(tenant, params.dealId, body, requestId);
  }

  @Get(':findingId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(findingParamsSchema)) params: FindingParams,
  ) {
    return this.service.get(tenant, params.dealId, params.findingId, requestId);
  }

  @Patch(':findingId')
  async update(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(findingParamsSchema)) params: FindingParams,
    @Body(new ZodValidationPipe(updateFindingSchema)) body: UpdateFindingBody,
  ) {
    return this.service.update(tenant, params.dealId, params.findingId, body, requestId);
  }

  @Post(':findingId/reviews')
  @HttpCode(201)
  async review(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(findingParamsSchema)) params: FindingParams,
    @Body(new ZodValidationPipe(reviewFindingSchema)) body: ReviewFindingBody,
  ) {
    return this.service.review(tenant, params.dealId, params.findingId, body, requestId);
  }
}
