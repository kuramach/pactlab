import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { ClinicsService } from './clinics.service';

type DealParams = { dealId: string };

/** Small clinics (T-161): the Clinic page — the owner-operator's share by service line, referral concentration and the clinic lease. */
@Controller('v1/deals/:dealId/clinics')
export class ClinicsController {
  constructor(@Inject(ClinicsService) private readonly service: ClinicsService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
