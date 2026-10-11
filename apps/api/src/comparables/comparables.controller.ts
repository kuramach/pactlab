import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  benchmarkQuerySchema,
  comparableInputSchema,
  comparableParamsSchema,
  dealParamsSchema,
  multipleJudgementInputSchema,
  type BenchmarkQuery,
  type BenchmarkView,
  type ComparableEntry,
  type ComparableView,
  type MultipleJudgementInput,
  type MultipleJudgementView,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { ComparablesService } from './comparables.service';

@Controller('v1')
export class ComparablesController {
  constructor(@Inject(ComparablesService) private readonly service: ComparablesService) {}

  @Get('comparables')
  list(@Tenant() tenant: TenantContext, @RequestId() requestId: string) {
    return this.service.list(tenant, requestId);
  }

  @Post('comparables')
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(comparableInputSchema)) body: ComparableEntry,
  ): Promise<ComparableView> {
    return this.service.create(tenant, body, requestId);
  }

  @Post('comparables/:comparableId/retire')
  @HttpCode(200)
  retire(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(comparableParamsSchema)) params: { comparableId: string },
  ): Promise<ComparableView> {
    return this.service.retire(tenant, params.comparableId, requestId);
  }

  @Post('deals/:dealId/comparables/from-deal')
  @HttpCode(201)
  fromDeal(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<ComparableView> {
    return this.service.addFromDeal(tenant, params.dealId, requestId);
  }

  @Get('deals/:dealId/benchmark')
  benchmark(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(benchmarkQuerySchema)) query: BenchmarkQuery,
  ): Promise<BenchmarkView> {
    return this.service.benchmark(tenant, params.dealId, query, requestId);
  }

  @Get('deals/:dealId/multiple-judgements')
  judgements(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<{ items: MultipleJudgementView[] }> {
    return this.service.judgements(tenant, params.dealId, requestId);
  }

  @Post('deals/:dealId/multiple-judgements')
  @HttpCode(201)
  recordJudgement(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(multipleJudgementInputSchema)) body: MultipleJudgementInput,
  ): Promise<MultipleJudgementView> {
    return this.service.recordJudgement(tenant, params.dealId, body, requestId);
  }
}
