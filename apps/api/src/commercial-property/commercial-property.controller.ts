import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { CommercialPropertyService } from './commercial-property.service';

type DealParams = { dealId: string };

/** Commercial property (T-165): the Leases page — the rent roll against the leases, recoveries, obligations, the expiry cliff, condition items and the P&L trend. */
@Controller('v1/deals/:dealId/commercial-property')
export class CommercialPropertyController {
  constructor(@Inject(CommercialPropertyService) private readonly service: CommercialPropertyService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
