import { Body, Controller, ForbiddenException, Get, Inject, Param, Put, UnprocessableEntityException } from '@nestjs/common';
import { aiModels, prismaExecutor, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PRISMA } from '../tokens';
import { AI_ROUTES } from './ai.controller';
import type { AiModelsRuntime } from './ai-provider';

const ROUTE_KEYS = ['fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'] as const;
const keyParams = z.strictObject({ key: z.enum(ROUTE_KEYS) });
const routeBody = z.strictObject({ modelId: z.uuid().nullable() });
const isAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';

/**
 * Settings → AI models (the routing diagram, Kumar 2026-11-19): how this organization's AI work is
 * routed, job by job, and, for its owners and admins, which Pactlab-approved model each job uses.
 * Every member may look; only owners and admins change it (re-checked in the database).
 */
@Controller('v1/ai/routing')
export class AiRoutingController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AI_ROUTES) private readonly models: AiModelsRuntime | null,
  ) {}

  @Get()
  async view(@Tenant() tenant: TenantContext) {
    if (!this.models) return { enabled: false, canEdit: false, choices: [], routing: null };
    const [routing, choices] = await Promise.all([this.models.resolver.describeJobs(tenant.organizationId), aiModels.organizationChoices(prismaExecutor(this.prisma), tenant.organizationId)]);
    return { enabled: true, canEdit: isAdmin(tenant), choices, routing };
  }

  @Put(':key')
  async set(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(keyParams)) params: z.infer<typeof keyParams>, @Body(new ZodValidationPipe(routeBody)) body: z.infer<typeof routeBody>) {
    if (!isAdmin(tenant)) throw new ForbiddenException();
    const outcome = await aiModels.setOrganizationRoute(prismaExecutor(this.prisma), tenant.userId, tenant.organizationId, params.key, body.modelId);
    if (outcome === 'NOT_ADMIN') throw new ForbiddenException();
    // Refusals are 422 with a stable code (the problem-details filter passes those through).
    if (outcome === 'NOT_ALLOWED' || outcome === 'BAD_KEY') throw new UnprocessableEntityException({ code: outcome });
    this.models?.resolver.invalidate();
    return this.view(tenant);
  }
}
