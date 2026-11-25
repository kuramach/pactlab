import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../../auth/tenant.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AiModelsService } from './ai-models.service';

/** The three roles, and the job types of best-of-breed routing (T-132). */
const ROUTE_KEYS = ['fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'] as const;
const alias = z.enum(ROUTE_KEYS);
export const addModelSchema = z.strictObject({
  provider: z.enum(['bedrock', 'anthropic', 'openai', 'google', 'fixture']),
  providerModelId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/),
  label: z.string().trim().min(1).max(80),
});
const providerParams = z.strictObject({ provider: z.enum(['anthropic', 'openai', 'google']) });
export const providerTermsSchema = z.strictObject({
  dpaInPlace: z.boolean(),
  zeroRetention: z.boolean(),
  region: z.string().trim().max(80).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
const modelParams = z.strictObject({ modelId: z.uuid() });
const bedrockUseSchema = z.strictObject({ modelId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/) });
const aliasParams = z.strictObject({ alias });
const organizationParams = z.strictObject({ organizationId: z.uuid() });
const routeBody = z.strictObject({ modelId: z.uuid() });
export const organizationModelsSchema = z.strictObject({
  allowed: z.array(z.uuid()).max(50),
  routes: z.strictObject(Object.fromEntries(ROUTE_KEYS.map((key) => [key, z.uuid().optional()])) as Record<(typeof ROUTE_KEYS)[number], z.ZodOptional<z.ZodUUID>>),
});

/** AI models in the operator console (T-131). Every route answers 403 to anyone not a platform operator. */
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

  /** Add from Bedrock: the models this account can use there (minus those in the catalog). */
  @Get('bedrock')
  bedrock(@Tenant() tenant: TenantContext) {
    return this.service.bedrockModels(tenant);
  }

  /** Use a Bedrock model: added, and its health check started. */
  @Post('bedrock')
  @HttpCode(202)
  useBedrock(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(bedrockUseSchema)) body: { modelId: string }) {
    return this.service.useBedrockModel(tenant, body.modelId);
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

  /** A provider outside AWS: its data terms, which gate its models (ADR 0034). */
  @Put('providers/:provider/terms')
  setProviderTerms(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(providerParams)) params: { provider: 'anthropic' | 'openai' | 'google' },
    @Body(new ZodValidationPipe(providerTermsSchema)) body: z.infer<typeof providerTermsSchema>,
  ) {
    return this.service.setProviderTerms(tenant, { provider: params.provider, ...body });
  }

  /** A job type's platform route removed: the job follows its lane chain (T-132). Refused for the three roles. */
  @Delete('routes/:alias')
  clearPlatformRoute(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(aliasParams)) params: { alias: z.infer<typeof alias> }) {
    return this.service.clearPlatformRoute(tenant, params.alias);
  }

  /** The platform routing diagram: every job's lanes, where each choice comes from, and the evaluated models. */
  @Get('routing')
  routing(@Tenant() tenant: TenantContext) {
    return this.service.routing(tenant);
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
