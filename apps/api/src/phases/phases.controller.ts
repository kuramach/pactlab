import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  claimParamsSchema,
  createClaimSchema,
  dealParamsSchema,
  postCloseParamsSchema,
  screeningInputSchema,
  screeningVerdictSchema,
  updateClaimSchema,
  updatePostCloseItemSchema,
  type CreateClaimInput,
  type ScreeningInput,
  type ScreeningVerdictInput,
  type UpdateClaimInput,
  type UpdatePostCloseItemInput,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { PhasesService } from './phases.service';

type DealParams = { dealId: string };

/** Pre-Diligence screening, the Diligence claims register and the Post-Close registers (T-071). */
@Controller('v1/deals/:dealId')
export class PhasesController {
  constructor(@Inject(PhasesService) private readonly service: PhasesService) {}

  @Get('screening')
  screening(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.screening(tenant, params.dealId, requestId);
  }

  @Put('screening')
  saveScreening(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(screeningInputSchema)) body: ScreeningInput,
  ) {
    return this.service.saveScreening(tenant, params.dealId, body, requestId);
  }

  @Post('screening/verdict')
  @HttpCode(200)
  decide(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(screeningVerdictSchema)) body: ScreeningVerdictInput,
  ) {
    return this.service.decide(tenant, params.dealId, body, requestId);
  }

  @Get('claims')
  claims(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.claims(tenant, params.dealId, requestId);
  }

  @Post('claims')
  createClaim(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(createClaimSchema)) body: CreateClaimInput,
  ) {
    return this.service.createClaim(tenant, params.dealId, body, requestId);
  }

  @Put('claims/:claimId')
  updateClaim(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(claimParamsSchema)) params: DealParams & { claimId: string },
    @Body(new ZodValidationPipe(updateClaimSchema)) body: UpdateClaimInput,
  ) {
    return this.service.updateClaim(tenant, params.dealId, params.claimId, body, requestId);
  }

  @Get('post-close')
  postClose(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.postClose(tenant, params.dealId, requestId);
  }

  /** Re-derive the registers from diligence output (idempotent); closing a deal does this too. */
  @Post('post-close/generate')
  @HttpCode(200)
  generate(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.generatePostClose(tenant, params.dealId, requestId);
  }

  @Put('post-close/:itemId')
  updateItem(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(postCloseParamsSchema)) params: DealParams & { itemId: string },
    @Body(new ZodValidationPipe(updatePostCloseItemSchema)) body: UpdatePostCloseItemInput,
  ) {
    return this.service.updatePostCloseItem(tenant, params.dealId, params.itemId, body, requestId);
  }
}
