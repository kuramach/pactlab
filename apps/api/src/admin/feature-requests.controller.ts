import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  approveFeatureRequestSchema,
  decideFeatureRequestSchema,
  featureRequestParamsSchema,
  featureRequestsQuerySchema,
  featureSupporterParamsSchema,
  featureSupportersQuerySchema,
  linkFeatureRequestSchema,
  myFeatureRequestParamsSchema,
  myFeatureRequestsQuerySchema,
  replyFeatureRequestSchema,
  type ApproveFeatureRequestInput,
  type DecideFeatureRequestInput,
  type LinkFeatureRequestInput,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FeatureRequestsService } from './feature-requests.service';

const confirmSchema = z.strictObject({ confirm: z.boolean() });

/** Kumar's triage queue for feature requests (T-176). Every route answers 403 to anyone who is not a platform operator. */
@Controller('v1/admin/feature-requests')
export class FeatureRequestsAdminController {
  constructor(@Inject(FeatureRequestsService) private readonly requests: FeatureRequestsService) {}

  @Get()
  queue(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(featureRequestsQuerySchema)) query: z.infer<typeof featureRequestsQuerySchema>) {
    return this.requests.queue(tenant, query);
  }

  @Get(':requestId')
  detail(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(featureRequestParamsSchema)) params: { requestId: string }) {
    return this.requests.detail(tenant, params.requestId);
  }

  @Get(':requestId/supporters')
  supporters(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(featureRequestParamsSchema)) params: { requestId: string },
    @Query(new ZodValidationPipe(featureSupportersQuerySchema)) query: z.infer<typeof featureSupportersQuerySchema>,
  ) {
    return this.requests.supporters(tenant, params.requestId, query);
  }

  @Post(':requestId/supporters/:supporterId/group')
  @HttpCode(200)
  group(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(featureSupporterParamsSchema)) params: { supporterId: string },
    @Body(new ZodValidationPipe(confirmSchema)) body: { confirm: boolean },
  ) {
    return this.requests.group(tenant, params.supporterId, body.confirm);
  }

  @Post(':requestId/decision')
  @HttpCode(200)
  decide(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(featureRequestParamsSchema)) params: { requestId: string }, @Body(new ZodValidationPipe(decideFeatureRequestSchema)) body: DecideFeatureRequestInput) {
    return this.requests.decide(tenant, params.requestId, body);
  }

  @Post(':requestId/approve')
  @HttpCode(200)
  approve(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(featureRequestParamsSchema)) params: { requestId: string }, @Body(new ZodValidationPipe(approveFeatureRequestSchema)) body: ApproveFeatureRequestInput) {
    return this.requests.approve(tenant, params.requestId, body);
  }

  @Put(':requestId/links')
  link(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(featureRequestParamsSchema)) params: { requestId: string }, @Body(new ZodValidationPipe(linkFeatureRequestSchema)) body: LinkFeatureRequestInput) {
    return this.requests.link(tenant, params.requestId, body);
  }
}

/** A signed-in user's own feature requests and where each stands. Scoped to them in SQL. */
@Controller('v1/feature-requests')
export class FeatureRequestsMineController {
  constructor(@Inject(FeatureRequestsService) private readonly requests: FeatureRequestsService) {}

  @Get('mine')
  mine(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(myFeatureRequestsQuerySchema)) query: z.infer<typeof myFeatureRequestsQuerySchema>) {
    return this.requests.mine(tenant, query);
  }

  @Post('mine/:requestId/reply')
  @HttpCode(200)
  reply(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(myFeatureRequestParamsSchema)) params: { requestId: string }, @Body(new ZodValidationPipe(replyFeatureRequestSchema)) body: { reply: string }) {
    return this.requests.reply(tenant, params.requestId, body.reply);
  }
}
