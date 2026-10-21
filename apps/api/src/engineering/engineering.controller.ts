import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { EngineeringService } from './engineering.service';

export const contributorParams = z.strictObject({ dealId: z.uuid(), contributorKey: z.string().regex(/^[0-9a-f]{16}$/) });
export const peopleAccessBody = z.strictObject({ enabled: z.boolean(), basis: z.string().trim().min(10).max(1000) });

@Controller('v1/deals/:dealId')
export class EngineeringController {
  constructor(@Inject(EngineeringService) private readonly service: EngineeringService) {}

  @Get('engineering')
  overview(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.service.overview(tenant, params.dealId, requestId);
  }

  @Get('engineering/contributors/:contributorKey')
  contributor(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(contributorParams)) params: { dealId: string; contributorKey: string },
  ) {
    return this.service.contributor(tenant, params.dealId, params.contributorKey, requestId);
  }

  @Post('people-access')
  @HttpCode(200)
  setPeopleAccess(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(peopleAccessBody)) body: { enabled: boolean; basis: string },
  ) {
    return this.service.setPeopleAccess(tenant, params.dealId, body, requestId);
  }
}
