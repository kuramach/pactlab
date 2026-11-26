import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { FintechService } from './fintech.service';

type DealParams = { dealId: string };

/** Fintech (T-159): the Payments page — volume and take rate recomputed, claims, loss rates, licences, compliance evidence and the P&L trend. */
@Controller('v1/deals/:dealId/fintech')
export class FintechController {
  constructor(@Inject(FintechService) private readonly service: FintechService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
