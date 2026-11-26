import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { propertyAddressSchema, type PropertyAddressBody } from './market-rents.schemas';
import { MarketRentsService } from './market-rents.service';

@Controller('v1/deals/:dealId/market-rents')
export class MarketRentsController {
  constructor(@Inject(MarketRentsService) private readonly service: MarketRentsService) {}

  /** The pact's floor plans, the address they are checked at and the latest estimate for each. */
  @Get()
  async status(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.service.status(tenant, params.dealId, requestId);
  }

  /** Store the property's address on the pact (asked once when no listing names it); audited. */
  @Put('address')
  async setAddress(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(propertyAddressSchema)) body: PropertyAddressBody,
  ) {
    return this.service.setAddress(tenant, params.dealId, body.address, requestId);
  }

  /** Check rents against the market: one estimate per floor plan, capped; a same-day re-run adds nothing. */
  @Post('retrieve')
  @HttpCode(200)
  async retrieve(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.service.retrieve(tenant, params.dealId, requestId);
  }
}
