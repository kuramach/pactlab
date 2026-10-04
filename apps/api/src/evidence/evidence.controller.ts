import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  evidenceParamsSchema,
  listEvidenceQuerySchema,
  type ListEvidenceQuery,
} from './evidence.schemas';
import { EvidenceService } from './evidence.service';

type EvidenceParams = { dealId: string; evidenceId: string };

@Controller('v1/deals/:dealId/evidence')
export class EvidenceController {
  constructor(@Inject(EvidenceService) private readonly service: EvidenceService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(listEvidenceQuerySchema)) query: ListEvidenceQuery,
  ) {
    return this.service.list(tenant, params.dealId, query, requestId);
  }

  @Get(':evidenceId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(evidenceParamsSchema)) params: EvidenceParams,
  ) {
    return this.service.get(tenant, params.dealId, params.evidenceId, requestId);
  }

  @Get(':evidenceId/lineage')
  async lineage(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(evidenceParamsSchema)) params: EvidenceParams,
  ) {
    return this.service.lineage(tenant, params.dealId, params.evidenceId, requestId);
  }

  @Post(':evidenceId/share')
  @HttpCode(200)
  async share(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(evidenceParamsSchema)) params: EvidenceParams,
  ) {
    return this.service.share(tenant, params.dealId, params.evidenceId, requestId);
  }
}
