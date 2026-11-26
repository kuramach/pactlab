import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { TelecomService } from './telecom.service';

type DealParams = { dealId: string };

/** Telecom and media (T-168): the Subscribers page — subscriber claims, the rights window, counterparty concentration, content cost against ARPU and the P&L trend. */
@Controller('v1/deals/:dealId/telecom')
export class TelecomController {
  constructor(@Inject(TelecomService) private readonly service: TelecomService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
