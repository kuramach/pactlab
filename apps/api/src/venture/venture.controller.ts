import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  createOfferSchema,
  dealParamsSchema,
  investorViewQuerySchema,
  offerParamsSchema,
  roundModelQuerySchema,
  updateOfferSchema,
  ventureSettingsSchema,
  type CreateOfferInput,
  type UpdateOfferInput,
  type VentureSettingsInput,
} from '@pactlab/contracts';
import { COUNTERPARTY_TYPES, type TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { VentureService } from './venture.service';

type DealParams = { dealId: string };
const readinessQuerySchema = z.strictObject({ counterparty: z.enum(COUNTERPARTY_TYPES).optional() });

/** Venture Raise (T-083): the round, competing offers, readiness, round model and investor view. */
@Controller('v1/deals/:dealId/venture')
export class VentureController {
  constructor(@Inject(VentureService) private readonly service: VentureService) {}

  @Get('settings')
  settings(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.settings(tenant, params.dealId, requestId);
  }

  @Put('settings')
  saveSettings(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(ventureSettingsSchema)) body: VentureSettingsInput,
  ) {
    return this.service.saveSettings(tenant, params.dealId, body, requestId);
  }

  @Get('offers')
  offers(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.offers(tenant, params.dealId, requestId);
  }

  @Post('offers')
  createOffer(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.service.createOffer(tenant, params.dealId, body, requestId);
  }

  @Get('offers/compare')
  compare(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.compare(tenant, params.dealId, requestId);
  }

  @Put('offers/:offerId')
  updateOffer(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(offerParamsSchema)) params: DealParams & { offerId: string },
    @Body(new ZodValidationPipe(updateOfferSchema)) body: UpdateOfferInput,
  ) {
    return this.service.updateOffer(tenant, params.dealId, params.offerId, body, requestId);
  }

  @Get('readiness')
  readiness(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Query(new ZodValidationPipe(readinessQuerySchema)) query: z.infer<typeof readinessQuerySchema>,
  ) {
    return this.service.readiness(tenant, params.dealId, query.counterparty, requestId);
  }

  @Get('round-model')
  roundModel(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Query(new ZodValidationPipe(roundModelQuerySchema)) query: z.infer<typeof roundModelQuerySchema>,
  ) {
    return this.service.roundModel(tenant, params.dealId, query.preMoney?.split(','), requestId);
  }

  @Get('investor-view')
  investorView(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Query(new ZodValidationPipe(investorViewQuerySchema)) query: z.infer<typeof investorViewQuerySchema>,
  ) {
    return this.service.investorView(tenant, params.dealId, query.offerId, requestId);
  }
}
