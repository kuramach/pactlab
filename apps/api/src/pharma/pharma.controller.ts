import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { PharmaService } from './pharma.service';

type DealParams = { dealId: string };

/** Pharma and biotech (T-163): the Pipeline page — pipeline claims against the registry, the patent estate against the hold, obligations against the agreements, dependence and R&D burn against the timeline. */
@Controller('v1/deals/:dealId/pharma')
export class PharmaController {
  constructor(@Inject(PharmaService) private readonly service: PharmaService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
