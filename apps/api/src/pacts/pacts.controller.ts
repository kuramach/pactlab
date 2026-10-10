import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  askingPriceInputSchema,
  dealParamsSchema,
  partyParamsSchema,
  startPactSchema,
  updatePartySchema,
  type AskingPriceInput,
  type AskingPriceView,
  type DealPartiesResponse,
  type DealSummary,
  type SourcePlanResponse,
  type StartPactCommand,
  type UpdatePartyCommand,
} from '@pactlab/contracts';
import type { PartyRole, TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { PactsService } from './pacts.service';

@Controller('v1')
export class PactsController {
  constructor(@Inject(PactsService) private readonly pacts: PactsService) {}

  @Post('pacts')
  @HttpCode(201)
  async start(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(startPactSchema)) body: StartPactCommand,
  ): Promise<DealSummary> {
    return this.pacts.start(tenant, body, requestId);
  }

  @Get('deals/:dealId/asking-price')
  async askingPrice(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<{ current: AskingPriceView | null; history: AskingPriceView[] }> {
    return this.pacts.askingPrice(tenant, params.dealId, requestId);
  }

  @Post('deals/:dealId/asking-price')
  @HttpCode(201)
  async recordAskingPrice(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(askingPriceInputSchema)) body: AskingPriceInput,
  ): Promise<{ current: AskingPriceView | null; history: AskingPriceView[] }> {
    return this.pacts.recordAskingPrice(tenant, params.dealId, body, requestId);
  }

  @Get('deals/:dealId/parties')
  async parties(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<DealPartiesResponse> {
    return this.pacts.parties(tenant, params.dealId, requestId);
  }

  @Patch('deals/:dealId/parties/:role')
  async updateParty(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(partyParamsSchema)) params: { dealId: string; role: PartyRole },
    @Body(new ZodValidationPipe(updatePartySchema)) body: UpdatePartyCommand,
  ): Promise<DealPartiesResponse> {
    return this.pacts.updateParty(tenant, params.dealId, params.role, body, requestId);
  }

  @Get('deals/:dealId/source-plan')
  async sourcePlan(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<SourcePlanResponse> {
    return this.pacts.sourcePlan(tenant, params.dealId, requestId);
  }
}
