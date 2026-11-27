import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  confirmCriticalBodySchema,
  createCriticalBodySchema,
  createOrgCriticalBodySchema,
  criticalParamsSchema,
  criticalsLibraryQuerySchema,
  dealCriticalParamsSchema,
  dealParamsSchema,
  overrideCriticalBodySchema,
  retireCriticalBodySchema,
  reviseCriticalBodySchema,
  type ConfirmCriticalBody,
  type CreateCriticalBody,
  type CreateOrgCriticalBody,
  type CriticalsLibraryQuery,
  type OverrideCriticalBody,
  type RetireCriticalBody,
  type ReviseCriticalBody,
} from '@pactlab/contracts';
import { COMPANY_TYPES, type CompanyType, type TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { CriticalsService } from './criticals.service';

type DealParams = { dealId: string };
type KeyParams = { criticalKey: string };
type DealKeyParams = { dealId: string; criticalKey: string };
const vocabularyQuerySchema = z.strictObject({ companyType: z.enum([...COMPANY_TYPES, 'ALL']).optional() });

/** The organization's library of criticals (T-179): standards by company type, written once as policy. */
@Controller('v1/criticals')
export class CriticalsLibraryController {
  constructor(@Inject(CriticalsService) private readonly service: CriticalsService) {}

  @Get()
  list(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Query(new ZodValidationPipe(criticalsLibraryQuerySchema)) query: CriticalsLibraryQuery) {
    return this.service.library(tenant, query, requestId);
  }

  /** The metrics a critical scoped to a company type (or all types) may target. */
  @Get('metrics')
  metrics(@Query(new ZodValidationPipe(vocabularyQuerySchema)) query: { companyType?: CompanyType | 'ALL' }) {
    return { items: this.service.vocabulary(!query.companyType || query.companyType === 'ALL' ? null : query.companyType) };
  }

  @Post()
  @HttpCode(201)
  create(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(createOrgCriticalBodySchema)) body: CreateOrgCriticalBody) {
    return this.service.createStandard(tenant, body, requestId);
  }

  @Put(':criticalKey')
  revise(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(criticalParamsSchema)) params: KeyParams, @Body(new ZodValidationPipe(reviseCriticalBodySchema)) body: ReviseCriticalBody) {
    return this.service.reviseStandard(tenant, params.criticalKey, body, requestId);
  }

  @Post(':criticalKey/confirm')
  @HttpCode(200)
  confirm(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(criticalParamsSchema)) params: KeyParams, @Body(new ZodValidationPipe(confirmCriticalBodySchema)) body: ConfirmCriticalBody) {
    return this.service.confirmStandard(tenant, params.criticalKey, body, requestId);
  }

  @Post(':criticalKey/retire')
  @HttpCode(200)
  retire(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(criticalParamsSchema)) params: KeyParams, @Body(new ZodValidationPipe(retireCriticalBodySchema)) body: RetireCriticalBody) {
    return this.service.retireStandard(tenant, params.criticalKey, body, requestId);
  }
}

/** A pact's Criticals panel (T-179): the org standards as overridden, plus the pact's own. Buyer-confidential. */
@Controller('v1/deals/:dealId/criticals')
export class CriticalsController {
  constructor(@Inject(CriticalsService) private readonly service: CriticalsService) {}

  @Get()
  panel(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.panel(tenant, params.dealId, requestId);
  }

  @Post()
  @HttpCode(201)
  create(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(createCriticalBodySchema)) body: CreateCriticalBody) {
    return this.service.createPactCritical(tenant, params.dealId, body, requestId);
  }

  /** Explicit re-evaluation: new documents or imports mark ratings stale, never re-run them silently. */
  @Post('evaluate')
  @HttpCode(200)
  evaluate(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.evaluate(tenant, params.dealId, requestId);
  }

  @Post('overrides')
  @HttpCode(201)
  override(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(overrideCriticalBodySchema)) body: OverrideCriticalBody) {
    return this.service.override(tenant, params.dealId, body, requestId);
  }

  @Put(':criticalKey')
  revise(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealCriticalParamsSchema)) params: DealKeyParams, @Body(new ZodValidationPipe(reviseCriticalBodySchema)) body: ReviseCriticalBody) {
    return this.service.revisePactCritical(tenant, params.dealId, params.criticalKey, body, requestId);
  }

  @Post(':criticalKey/confirm')
  @HttpCode(200)
  confirm(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealCriticalParamsSchema)) params: DealKeyParams, @Body(new ZodValidationPipe(confirmCriticalBodySchema)) body: ConfirmCriticalBody) {
    return this.service.confirmPactCritical(tenant, params.dealId, params.criticalKey, body, requestId);
  }

  @Post(':criticalKey/retire')
  @HttpCode(200)
  retire(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealCriticalParamsSchema)) params: DealKeyParams, @Body(new ZodValidationPipe(retireCriticalBodySchema)) body: RetireCriticalBody) {
    return this.service.retirePactCritical(tenant, params.dealId, params.criticalKey, body, requestId);
  }

  /** "Make this an org critical": the confirmed structure goes into the library for the pact's type. */
  @Post(':criticalKey/promote')
  @HttpCode(201)
  promote(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealCriticalParamsSchema)) params: DealKeyParams) {
    return this.service.promote(tenant, params.dealId, params.criticalKey, requestId);
  }
}
