import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  catalogQuerySchema,
  decisionBodySchema,
  extractBodySchema,
  itemBodySchema,
  itemParamsSchema,
  itemsQuerySchema,
  worksQuerySchema,
  type CatalogQuery,
  type DecisionBody,
  type ExtractBody,
  type ItemBody,
  type ItemsQuery,
  type WorksQuery,
} from './music.schemas';
import { MusicService } from './music.service';

type DealParams = { dealId: string };
type ItemParams = { dealId: string; itemId: string };

/** Music rights (T-140): the works and rights register, royalty income, termination exposure and the catalog checks. */
@Controller('v1/deals/:dealId/catalog')
export class MusicController {
  constructor(@Inject(MusicService) private readonly service: MusicService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(catalogQuerySchema)) query: CatalogQuery) {
    return this.service.view(tenant, params.dealId, query.holdYears, requestId);
  }

  @Get('works')
  works(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(worksQuerySchema)) query: WorksQuery) {
    return this.service.works(tenant, params.dealId, query, requestId);
  }

  @Get('items')
  items(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(itemsQuerySchema)) query: ItemsQuery) {
    return this.service.items(tenant, params.dealId, query, requestId);
  }

  /** AI reads a rights document; what it finds lands as drafts to confirm. */
  @Post('extract')
  @HttpCode(200)
  extract(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(extractBodySchema)) body: ExtractBody) {
    return this.service.extract(tenant, params.dealId, body, requestId);
  }

  @Post('items')
  @HttpCode(201)
  add(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(itemBodySchema)) body: ItemBody) {
    return this.service.addItem(tenant, params.dealId, body, requestId);
  }

  @Post('items/:itemId/decision')
  @HttpCode(200)
  decide(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(itemParamsSchema)) params: ItemParams, @Body(new ZodValidationPipe(decisionBodySchema)) body: DecisionBody) {
    return this.service.decide(tenant, params.dealId, params.itemId, body, requestId);
  }

  @Post('checks')
  @HttpCode(200)
  checks(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.runChecks(tenant, params.dealId, requestId);
  }
}
