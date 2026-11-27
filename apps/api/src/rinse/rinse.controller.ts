import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  createPrepInviteSchema,
  pageQuerySchema,
  preparerStartSchema,
  preparerVerifySchema,
  prepInviteTokenBodySchema,
  rinseClassifySchema,
  rinseVisionSchema,
  type CreatePrepInviteBody,
  type PageQuery,
  type RinseClassifyBody,
  type RinseVisionBody,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AllowUnscoped, NoDemo, Public, RecentSignIn, type Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { rateLimitAddress } from '../email-login/client-address';
import { PrepInvitesService } from './prep-invites.service';
import { PreparerService } from './preparer.service';

const dealParams = z.strictObject({ dealId: z.uuid() });
const inviteParams = z.strictObject({ dealId: z.uuid(), inviteId: z.uuid() });

/** Prep invites from the pact (T-178b): the pact's own side invites, lists and revokes. */
@Controller('v1/deals/:dealId/rinse/prep-invites')
export class PrepInvitesController {
  constructor(@Inject(PrepInvitesService) private readonly service: PrepInvitesService) {}

  @Post()
  @HttpCode(201)
  @RecentSignIn()
  @NoDemo()
  create(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParams)) params: { dealId: string }, @Body(new ZodValidationPipe(createPrepInviteSchema)) body: CreatePrepInviteBody) {
    return this.service.create(tenant, params.dealId, body.email, requestId);
  }

  @Get()
  list(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParams)) params: { dealId: string }, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery) {
    return this.service.list(tenant, params.dealId, query, requestId);
  }

  @Post(':inviteId/revoke')
  @HttpCode(200)
  revoke(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(inviteParams)) params: { dealId: string; inviteId: string }) {
    return this.service.revoke(tenant, params.dealId, params.inviteId, requestId);
  }
}

/** The Rinse desktop's API (T-178b): sign-in from an invite, the preparer's bindings, and AI rinse jobs. */
@Controller('v1/rinse')
export class PreparerController {
  constructor(@Inject(PreparerService) private readonly service: PreparerService) {}

  @Public()
  @Post('invites/preview')
  @HttpCode(200)
  preview(@Body(new ZodValidationPipe(prepInviteTokenBodySchema)) body: { token: string }) {
    return this.service.preview(body.token);
  }

  /** Always 202 with the same body, whether or not a code was sent. */
  @Public()
  @Post('sign-in/start')
  @HttpCode(202)
  async start(@Body(new ZodValidationPipe(preparerStartSchema)) body: { token: string; email: string; displayName: string }, @Req() request: FastifyRequest): Promise<{ sent: true }> {
    await this.service.start(body, rateLimitAddress(request));
    return { sent: true };
  }

  @Public()
  @Post('sign-in/verify')
  @HttpCode(200)
  verify(@Body(new ZodValidationPipe(preparerVerifySchema)) body: z.infer<typeof preparerVerifySchema>) {
    return this.service.verify(body);
  }

  @AllowUnscoped()
  @NoDemo()
  @Post('invites/accept')
  @HttpCode(200)
  async accept(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(prepInviteTokenBodySchema)) body: { token: string }) {
    return { bindings: await this.service.accept(principal.sessionId, body.token) };
  }

  /** The preparer's own: which pacts they are bound to. Never anything of those pacts. */
  @AllowUnscoped()
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    return { bindings: await this.service.bindings(principal.sessionId) };
  }

  @AllowUnscoped()
  @NoDemo()
  @Post('ai/classify')
  @HttpCode(200)
  classify(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(rinseClassifySchema)) body: RinseClassifyBody) {
    return this.service.classify(principal.sessionId, principal.subject, body);
  }

  @AllowUnscoped()
  @NoDemo()
  @Post('ai/vision')
  @HttpCode(200)
  vision(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(rinseVisionSchema)) body: RinseVisionBody) {
    return this.service.vision(principal.sessionId, principal.subject, body);
  }
}
