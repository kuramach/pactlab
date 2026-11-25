import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  decisionBodySchema,
  extractBodySchema,
  itemBodySchema,
  itemParamsSchema,
  offeringBodySchema,
  type DecisionBody,
  type ExtractBody,
  type ItemBody,
  type OfferingBody,
} from './syndication.schemas';
import { SyndicationService } from './syndication.service';

type DealParams = { dealId: string };
type ItemParams = { dealId: string; itemId: string };

/** Multifamily syndication, sponsor side (T-106): the offering, its terms and claims, and the checks. */
@Controller('v1/deals/:dealId/syndication')
export class SyndicationController {
  constructor(@Inject(SyndicationService) private readonly service: SyndicationService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Put('offering')
  save(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(offeringBodySchema)) body: OfferingBody) {
    return this.service.saveOffering(tenant, params.dealId, body, requestId);
  }

  /** AI reads a PPM, operating agreement or deck; what it finds lands as drafts to confirm. */
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
