import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  dealParamsSchema,
  foresightQuestionSchema,
  foresightScenarioInputSchema,
  foresightScenarioParamsSchema,
  foresightVoiceQuestionSchema,
  updateForesightScenarioSchema,
  type ForesightQuestionInput,
  type ForesightScenarioInput,
  type ForesightVoiceQuestionInput,
  type UpdateForesightScenarioInput,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { ForesightService } from './foresight.service';

type DealParams = { dealId: string };

/** Foresight (T-073): five-year trend lines, scenarios, projected value, and Q&A by text or voice. */
@Controller('v1/deals/:dealId/foresight')
export class ForesightController {
  constructor(@Inject(ForesightService) private readonly foresight: ForesightService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.foresight.view(tenant, params.dealId, requestId);
  }

  @Post('trend-sets')
  generate(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.foresight.generate(tenant, params.dealId, requestId);
  }

  @Post('scenarios')
  createScenario(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(foresightScenarioInputSchema)) body: ForesightScenarioInput,
  ) {
    return this.foresight.createScenario(tenant, params.dealId, body, requestId);
  }

  @Put('scenarios/:scenarioId')
  updateScenario(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(foresightScenarioParamsSchema)) params: DealParams & { scenarioId: string },
    @Body(new ZodValidationPipe(updateForesightScenarioSchema)) body: UpdateForesightScenarioInput,
  ) {
    return this.foresight.updateScenario(tenant, params.dealId, params.scenarioId, body, requestId);
  }

  @Post('questions')
  @HttpCode(200)
  ask(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(foresightQuestionSchema)) body: ForesightQuestionInput,
  ) {
    return this.foresight.ask(tenant, params.dealId, body, requestId);
  }

  @Post('voice-questions')
  @HttpCode(200)
  askByVoice(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(foresightVoiceQuestionSchema)) body: ForesightVoiceQuestionInput,
  ) {
    return this.foresight.askByVoice(tenant, params.dealId, body, requestId);
  }
}
