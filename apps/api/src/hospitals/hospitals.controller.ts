import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { HospitalsService } from './hospitals.service';

type DealParams = { dealId: string };

/** Hospitals (T-162): the Hospital page — cost-report reconciliation, payer contracts, medical staff, the plant and capex trend and quality claims. */
@Controller('v1/deals/:dealId/hospitals')
export class HospitalsController {
  constructor(@Inject(HospitalsService) private readonly service: HospitalsService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
