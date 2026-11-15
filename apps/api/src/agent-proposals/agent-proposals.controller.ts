import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { decideProposalBodySchema, listProposalsQuerySchema, proposalParamsSchema, type AgentProposalStatus, type DecideProposalBody } from './agent-proposals.schemas';
import { AgentProposalsService } from './agent-proposals.service';

/**
 * Suggestions from connected AI apps, decided in the app (T-084b). A session principal only:
 * MCP tokens never reach these routes, so a connected app can never approve its own suggestion.
 */
@Controller('v1/deals/:dealId/agent-proposals')
export class AgentProposalsController {
  constructor(@Inject(AgentProposalsService) private readonly service: AgentProposalsService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(listProposalsQuerySchema)) query: { status?: AgentProposalStatus },
  ) {
    return this.service.list(tenant, params.dealId, query, requestId);
  }

  @Post(':proposalId/decision')
  @HttpCode(200)
  async decide(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(proposalParamsSchema)) params: { dealId: string; proposalId: string },
    @Body(new ZodValidationPipe(decideProposalBodySchema)) body: DecideProposalBody,
  ) {
    return this.service.decide(tenant, params.dealId, params.proposalId, body, requestId);
  }
}
