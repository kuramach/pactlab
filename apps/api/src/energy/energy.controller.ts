import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  energyQuerySchema,
  decisionBodySchema,
  extractBodySchema,
  itemBodySchema,
  itemParamsSchema,
  itemsQuerySchema,
  assetsQuerySchema,
  type EnergyQuery,
  type DecisionBody,
  type ExtractBody,
  type ItemBody,
  type ItemsQuery,
  type AssetsQuery,
} from './energy.schemas';
import { EnergyService } from './energy.service';

type DealParams = { dealId: string };
type ItemParams = { dealId: string; itemId: string };

/** Energy generation & rights (T-142): the asset and interest register, production and reserves, the liability model and the checks. */
@Controller('v1/deals/:dealId/energy')
export class EnergyController {
  constructor(@Inject(EnergyService) private readonly service: EnergyService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(energyQuerySchema)) query: EnergyQuery) {
    return this.service.view(tenant, params.dealId, query.holdYears, requestId);
  }

  @Get('assets')
  assets(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(assetsQuerySchema)) query: AssetsQuery) {
    return this.service.assets(tenant, params.dealId, query, requestId);
  }

  @Get('items')
  items(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(itemsQuerySchema)) query: ItemsQuery) {
    return this.service.items(tenant, params.dealId, query, requestId);
  }

  /** AI reads a reserve report or an environmental report; what it finds lands as drafts to confirm. */
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
