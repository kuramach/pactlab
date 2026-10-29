import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post } from '@nestjs/common';
import { createRegulatoryEntrySchema, dealParamsSchema, type CreateRegulatoryEntry } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DealAccess } from '../deals/deal-access';
import { RequestId } from '../deals/request-id.decorator';
import { RegulatoryService } from './regulatory.service';

type DealParams = { dealId: string };

/** Regulatory & deal certainty (T-091): the screen, the workbench, covenants and cited entries. */
@Controller('v1/deals/:dealId/regulatory')
class RegulatoryController {
  constructor(@Inject(RegulatoryService) private readonly service: RegulatoryService) {}

  @Get()
  analyze(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.analyze(tenant, params.dealId, requestId);
  }

  @Post('entries')
  addEntry(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(createRegulatoryEntrySchema)) body: CreateRegulatoryEntry,
  ) {
    return this.service.addEntry(tenant, params.dealId, body, requestId);
  }

  /** Record the current results as DRAFT findings in the register. */
  @Post('findings')
  @HttpCode(200)
  propose(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.propose(tenant, params.dealId, requestId);
  }
}

@Module({ controllers: [RegulatoryController], providers: [RegulatoryService, DealAccess] })
export class RegulatoryModule {}
