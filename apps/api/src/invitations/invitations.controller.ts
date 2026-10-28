import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Public } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { createInvitationSchema, invitationParamsSchema, invitationTokenSchema, type CreateInvitationBody } from './invitations.schemas';
import { InvitationsService } from './invitations.service';

/** The pact's lead manages invitations to it (T-094 B12). */
@Controller('v1/deals/:dealId/invitations')
export class DealInvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Get()
  list(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.invitations.list(tenant, params.dealId, requestId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationBody,
  ) {
    return this.invitations.create(tenant, params.dealId, body, requestId);
  }

  @Post(':invitationId/revoke')
  @HttpCode(204)
  async revoke(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(invitationParamsSchema)) params: { dealId: string; invitationId: string }) {
    await this.invitations.revoke(tenant, params.dealId, params.invitationId, requestId);
  }
}

/** The invitee's side of a link (T-094 B12). */
@Controller('v1/invitations/:token')
export class InvitationLinkController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  /** Shown before sign-in: whose pact, which side and role, for which address. */
  @Public()
  @Get()
  preview(@Param(new ZodValidationPipe(invitationTokenSchema)) params: { token: string }) {
    return this.invitations.preview(params.token);
  }

  @Post('accept')
  @HttpCode(200)
  accept(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(invitationTokenSchema)) params: { token: string }) {
    return this.invitations.accept(tenant, params.token, requestId);
  }
}
