import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  createScenarioSchema,
  decideSubmissionSchema,
  scenarioParamsSchema,
  submissionParamsSchema,
  updateAssumptionsSchema,
  versionedCommandSchema,
  type CreateScenarioBody,
  type DecideSubmissionBody,
  type UpdateAssumptionsBody,
  type VersionedCommandBody,
} from './valuation.schemas';
import { ValuationService } from './valuation.service';

type ScenarioParams = { dealId: string; scenarioId: string };
type SubmissionParams = ScenarioParams & { submissionId: string };

@Controller('v1/deals/:dealId/valuation/scenarios')
export class ValuationController {
  constructor(@Inject(ValuationService) private readonly service: ValuationService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ) {
    return this.service.list(tenant, params.dealId, requestId);
  }

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(createScenarioSchema)) body: CreateScenarioBody,
  ) {
    return this.service.create(tenant, params.dealId, body, requestId);
  }

  @Get(':scenarioId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(scenarioParamsSchema)) params: ScenarioParams,
  ) {
    return this.service.get(tenant, params.dealId, params.scenarioId, requestId);
  }

  @Put(':scenarioId/assumptions')
  async updateAssumptions(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(scenarioParamsSchema)) params: ScenarioParams,
    @Body(new ZodValidationPipe(updateAssumptionsSchema)) body: UpdateAssumptionsBody,
  ) {
    return this.service.updateAssumptions(
      tenant,
      params.dealId,
      params.scenarioId,
      body,
      requestId,
    );
  }

  @Post(':scenarioId/runs')
  @HttpCode(201)
  async run(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(scenarioParamsSchema)) params: ScenarioParams,
    @Body(new ZodValidationPipe(versionedCommandSchema)) body: VersionedCommandBody,
  ) {
    return this.service.run(tenant, params.dealId, params.scenarioId, body, requestId);
  }

  @Post(':scenarioId/submissions')
  @HttpCode(201)
  async submit(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(scenarioParamsSchema)) params: ScenarioParams,
    @Body(new ZodValidationPipe(versionedCommandSchema)) body: VersionedCommandBody,
  ) {
    return this.service.submit(tenant, params.dealId, params.scenarioId, body, requestId);
  }

  /** The frozen submission bytes as stored; the ETag carries their SHA-256. */
  @Get(':scenarioId/submissions/:submissionId')
  async readSubmission(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(submissionParamsSchema)) params: SubmissionParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const frozen = await this.service.readSubmission(
      tenant,
      params.dealId,
      params.scenarioId,
      params.submissionId,
      requestId,
    );
    void reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('etag', `"sha256-${frozen.digest}"`)
      .header('cache-control', 'no-store');
    return frozen.canonical;
  }

  @Post(':scenarioId/submissions/:submissionId/decisions')
  @HttpCode(201)
  async decide(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(submissionParamsSchema)) params: SubmissionParams,
    @Body(new ZodValidationPipe(decideSubmissionSchema)) body: DecideSubmissionBody,
  ) {
    return this.service.decide(
      tenant,
      params.dealId,
      params.scenarioId,
      params.submissionId,
      body,
      requestId,
    );
  }
}
