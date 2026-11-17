import { Controller, Get, Inject } from '@nestjs/common';
import type { ModelAlias } from '@pactlab/ai';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import type { AiModelsRuntime, AiStatusView } from './ai-provider';

export const AI_STATUS = Symbol('AI_STATUS');
export const AI_ROUTES = Symbol('AI_ROUTES');

/**
 * Whether document AI is on, and which models it uses for the caller's organization (T-131: the
 * admin console's choice for it, or the defaults). A role its allow-list does not cover is left
 * out. Signed-in users only; no secrets.
 */
@Controller('v1/ai')
export class AiController {
  constructor(
    @Inject(AI_STATUS) private readonly status: AiStatusView,
    @Inject(AI_ROUTES) private readonly models: AiModelsRuntime | null,
  ) {}

  @Get('status')
  async get(@Tenant() tenant: TenantContext): Promise<AiStatusView> {
    if (!this.status.enabled || !this.models) return this.status;
    const routes: AiStatusView['routes'] = [];
    for (const route of this.status.routes) {
      const chosen = await this.models.resolver.describe(tenant.organizationId, route.alias as ModelAlias);
      if (chosen === 'BLOCKED') continue;
      routes.push(chosen ? { alias: route.alias, modelId: chosen.route.modelId, label: chosen.label } : route);
    }
    return { ...this.status, routes };
  }
}
