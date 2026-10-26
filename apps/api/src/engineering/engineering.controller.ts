import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { EngineeringService } from './engineering.service';

export const contributorParams = z.strictObject({ dealId: z.uuid(), contributorKey: z.string().regex(/^[0-9a-f]{16}$/) });
export const peopleAccessBody = z.strictObject({ enabled: z.boolean(), basis: z.string().trim().min(10).max(1000) });
export const peopleQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  tag: z.enum(['CRITICAL_OWNER', 'COORDINATOR', 'BUILDER', 'CROSS_AREA', 'RECENTLY_QUIET']).optional(),
  area: z.string().trim().min(1).max(200).optional(),
  keep: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  cursor: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller('v1/deals/:dealId')
export class EngineeringController {
  constructor(@Inject(EngineeringService) private readonly service: EngineeringService) {}

  @Get('engineering')
  overview(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.service.overview(tenant, params.dealId, requestId);
  }

  /** Full profiles, paged, with search (label, key, or name when shown) and tag, area and keep filters. */
  @Get('engineering/people')
  people(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(peopleQuery)) query: z.infer<typeof peopleQuery>,
  ) {
    return this.service.people(tenant, params.dealId, query, requestId);
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
