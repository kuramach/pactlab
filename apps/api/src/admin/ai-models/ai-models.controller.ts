import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../../auth/tenant.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AiModelsService } from './ai-models.service';

const alias = z.enum(['fast', 'balanced', 'deep_review']);
export const addModelSchema = z.strictObject({
  provider: z.enum(['bedrock', 'openai', 'google', 'fixture']),
  providerModelId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/),
  label: z.string().trim().min(1).max(80),
});
const providerParams = z.strictObject({ provider: z.enum(['openai', 'google']) });
export const providerTermsSchema = z.strictObject({
  dpaInPlace: z.boolean(),
  zeroRetention: z.boolean(),
  region: z.string().trim().max(80).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
const modelParams = z.strictObject({ modelId: z.uuid() });
const aliasParams = z.strictObject({ alias });
const organizationParams = z.strictObject({ organizationId: z.uuid() });
const routeBody = z.strictObject({ modelId: z.uuid() });
export const organizationModelsSchema = z.strictObject({
  allowed: z.array(z.uuid()).max(50),
  routes: z.strictObject({ fast: z.uuid().optional(), balanced: z.uuid().optional(), deep_review: z.uuid().optional() }),
});

/** AI models in the operator console (T-130). Every route answers 403 to anyone not a platform operator. */
@Controller('v1/admin/ai-models')
export class AiModelsController {
  constructor(@Inject(AiModelsService) private readonly service: AiModelsService) {}

  @Get()
  catalog(@Tenant() tenant: TenantContext) {
    return this.service.catalog(tenant);
  }

  @Post()
  add(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(addModelSchema)) body: z.infer<typeof addModelSchema>) {
    return this.service.add(tenant, body);
  }

  @Post(':modelId/evaluation')
  @HttpCode(202)
  evaluate(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(modelParams)) params: { modelId: string }) {
    return this.service.evaluate(tenant, params.modelId);
  }

  @Post(':modelId/retire')
  @HttpCode(200)
  retire(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(modelParams)) params: { modelId: string }) {
    return this.service.retire(tenant, params.modelId);
  }

  @Put('routes/:alias')
  setPlatformRoute(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(aliasParams)) params: { alias: z.infer<typeof alias> }, @Body(new ZodValidationPipe(routeBody)) body: { modelId: string }) {
    return this.service.setPlatformRoute(tenant, params.alias, body.modelId);
  }

  /** A provider outside AWS: its data terms, which gate its models (ADR 0029). */
  @Put('providers/:provider/terms')
  setProviderTerms(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(providerParams)) params: { provider: 'openai' | 'google' },
    @Body(new ZodValidationPipe(providerTermsSchema)) body: z.infer<typeof providerTermsSchema>,
  ) {
    return this.service.setProviderTerms(tenant, { provider: params.provider, ...body });
  }

  @Get('organizations/:organizationId')
  organizationModels(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(organizationParams)) params: { organizationId: string }) {
    return this.service.organizationModels(tenant, params.organizationId);
  }

  @Put('organizations/:organizationId')
  setOrganizationModels(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(organizationParams)) params: { organizationId: string },
    @Body(new ZodValidationPipe(organizationModelsSchema)) body: z.infer<typeof organizationModelsSchema>,
  ) {
    return this.service.setOrganizationModels(tenant, params.organizationId, body);
  }
}
