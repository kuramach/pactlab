import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { pageQuerySchema } from '@pactlab/contracts';
import { COST_RATE_KINDS, METERED_DIMENSIONS } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../../auth/tenant.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { HostingCostService } from './hosting-cost.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'a date');
const viewQuery = z
  .strictObject({ from: day, to: day, environment: z.string().regex(/^[a-z0-9-]{1,100}$/).optional() })
  .refine((query) => query.from < query.to, 'from before to')
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= 400 * 86_400_000, 'at most about 13 months');
const meteredParams = z.strictObject({ dimension: z.enum(METERED_DIMENSIONS) });
const meteredQuery = pageQuerySchema
  .extend({ from: day, to: day })
  .strict()
  .refine((query) => query.from < query.to, 'from before to');
const rateBody = z.strictObject({
  kind: z.enum(COST_RATE_KINDS),
  key: z.string().trim().min(1).max(200),
  unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,8})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  effectiveFrom: day,
  sourceNote: z.string().trim().max(500).default(''),
});

/** Hosting cost (operator console): real spend, metered estimates and the rates behind them. */
@Controller('v1/admin/cost')
export class HostingCostController {
  constructor(@Inject(HostingCostService) private readonly cost: HostingCostService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(viewQuery)) query: z.infer<typeof viewQuery>) {
    return this.cost.view(tenant, query);
  }

  /** One breakdown of the metered estimate, most expensive first, a page at a time (T-126). */
  @Get('metered/:dimension')
  metered(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(meteredParams)) params: z.infer<typeof meteredParams>, @Query(new ZodValidationPipe(meteredQuery)) query: z.infer<typeof meteredQuery>) {
    return this.cost.metered(tenant, { ...query, dimension: params.dimension });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Tenant() tenant: TenantContext) {
    return this.cost.refresh(tenant);
  }

  @Get('rates')
  rates(@Tenant() tenant: TenantContext) {
    return this.cost.rates(tenant);
  }

  @Post('rates')
  @HttpCode(201)
  setRate(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(rateBody)) body: z.infer<typeof rateBody>) {
    return this.cost.setRate(tenant, body);
  }

  @Delete('rates/:rateId')
  deleteRate(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(z.strictObject({ rateId: z.uuid() }))) params: { rateId: string }) {
    return this.cost.deleteRate(tenant, params.rateId);
  }
}
