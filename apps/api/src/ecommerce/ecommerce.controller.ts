import { Controller, Get, Inject, Param } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { EcommerceService } from './ecommerce.service';

type DealParams = { dealId: string };

/** E-commerce and DTC (T-164): the Channels page — channel revenue, unit economics, platform accounts, returns, stock age and the P&L trend. */
@Controller('v1/deals/:dealId/ecommerce')
export class EcommerceController {
  constructor(@Inject(EcommerceService) private readonly service: EcommerceService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }
}
