import { ApiAccess } from '../auth/auth.guard';
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

  @ApiAccess({ tag: 'Evidence', summary: 'List evidence', description: 'Normalized evidence on the pact, with its source.' })
  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(listEvidenceQuerySchema)) query: ListEvidenceQuery,
  ) {
    return this.service.list(tenant, params.dealId, query, requestId);
  }

  @ApiAccess({ tag: 'Evidence', summary: 'Get evidence', description: 'One piece of evidence and its citation.' })
  @Get(':evidenceId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(evidenceParamsSchema)) params: EvidenceParams,
  ) {
    return this.service.get(tenant, params.dealId, params.evidenceId, requestId);
  }

  @ApiAccess({ tag: 'Evidence', summary: 'Evidence lineage', description: 'What this evidence supports: findings, assumptions, scenarios and terms.' })
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
