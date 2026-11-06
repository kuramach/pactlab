import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  batchParamsSchema,
  evaluateBodySchema,
  evaluationParamsSchema,
  personaBodySchema,
  sellerNotesBodySchema,
  type EvaluateBody,
  type PersonaBody,
  type SellerNotesBody,
} from './pricing.schemas';
import { PricingService } from './pricing.service';

type DealParams = { dealId: string };
type EvaluationParams = { dealId: string; evaluationId: string };
type BatchParams = { dealId: string; batchId: string };

/** Buyer personas (T-105): persona pricing, adoption, term proposals and the brief. */
@Controller('v1/deals/:dealId/pricing')
export class PricingController {
  constructor(@Inject(PricingService) private readonly service: PricingService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Put('persona')
  setPersona(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(personaBodySchema)) body: PersonaBody,
  ) {
    return this.service.setPactPersona(tenant, params.dealId, body, requestId);
  }

  @Post('evaluations')
  @HttpCode(201)
  evaluate(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(evaluateBodySchema)) body: EvaluateBody,
  ) {
    return this.service.evaluate(tenant, params.dealId, body, requestId);
  }

  @Post('evaluations/:evaluationId/adopt')
  @HttpCode(201)
  adopt(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(evaluationParamsSchema)) params: EvaluationParams) {
    return this.service.adopt(tenant, params.dealId, params.evaluationId, requestId);
  }

  @Post('evaluations/:evaluationId/brief')
  @HttpCode(201)
  brief(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(evaluationParamsSchema)) params: EvaluationParams) {
    return this.service.brief(tenant, params.dealId, params.evaluationId, requestId);
  }

  @Post('terms')
  @HttpCode(201)
  draftTerms(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.draftTerms(tenant, params.dealId, requestId);
  }

  @Put('terms/:batchId/notes')
  notes(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(batchParamsSchema)) params: BatchParams,
    @Body(new ZodValidationPipe(sellerNotesBodySchema)) body: SellerNotesBody,
  ) {
    return this.service.updateSellerNotes(tenant, params.dealId, params.batchId, body, requestId);
  }

  @Post('terms/:batchId/propose')
  @HttpCode(201)
  propose(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(batchParamsSchema)) params: BatchParams) {
    return this.service.propose(tenant, params.dealId, params.batchId, requestId);
  }
}

/** What the seller's side sees: the latest proposed terms, and nothing about how they were priced. */
@Controller('v1/deals/:dealId/terms')
export class ProposedTermsController {
  constructor(@Inject(PricingService) private readonly service: PricingService) {}

  @Get('proposed')
  proposed(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.proposedTerms(tenant, params.dealId, requestId);
  }
}
