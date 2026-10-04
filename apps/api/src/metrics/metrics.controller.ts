import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  approvalParamsSchema,
  approveSchema,
  metricsQuerySchema,
  reconcileSchema,
  type ApproveCommand,
  type MetricsQuery,
  type ReconcileCommand,
} from './metrics.schemas';
import { MetricsService } from './metrics.service';

@Controller('v1/deals/:dealId/metrics')
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly service: MetricsService) {}

  @Get('summary')
  async summary(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(metricsQuerySchema)) query: MetricsQuery,
  ) {
    return this.service.summary(tenant, params.dealId, query.asOf, requestId);
  }

  @Get('cohorts')
  async cohorts(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(metricsQuerySchema)) query: MetricsQuery,
  ) {
    return this.service.cohorts(tenant, params.dealId, query.asOf, requestId);
  }

  @Post('reconcile')
  @HttpCode(200)
  async reconcile(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(reconcileSchema)) body: ReconcileCommand,
  ) {
    return this.service.reconcile(tenant, params.dealId, body.asOf, requestId);
  }

  @Post('reconcile/:reconciliationId/approve')
  @HttpCode(200)
  async approve(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(approvalParamsSchema))
    params: { dealId: string; reconciliationId: string },
    @Body(new ZodValidationPipe(approveSchema)) body: ApproveCommand,
  ) {
    return this.service.approve(tenant, params.dealId, params.reconciliationId, body, requestId);
  }
}
