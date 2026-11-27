import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { supportChatHandoffSchema, supportChatMessageSchema, type SupportChatHandoff, type SupportChatMessage } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { SupportChatService } from './support-chat.service';

/** Product-help chat (T-175): anonymous on the public site, signed in inside the app; the same service behind both. */
@Controller()
export class SupportChatController {
  constructor(@Inject(SupportChatService) private readonly chat: SupportChatService) {}

  @Public()
  @Post('v1/public/support-chat/messages')
  @HttpCode(200)
  askOnSite(@Req() request: FastifyRequest, @Body(new ZodValidationPipe(supportChatMessageSchema)) body: SupportChatMessage) {
    return this.chat.askOnSite(body, rateLimitAddress(request));
  }

  @Public()
  @Post('v1/public/support-chat/handoff')
  @HttpCode(200)
  handOffFromSite(@Req() request: FastifyRequest, @Body(new ZodValidationPipe(supportChatHandoffSchema)) body: SupportChatHandoff) {
    return this.chat.handOffFromSite(body, rateLimitAddress(request));
  }

  @Post('v1/support-chat/messages')
  @HttpCode(200)
  askInApp(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(supportChatMessageSchema)) body: SupportChatMessage) {
    return this.chat.askInApp(tenant, body);
  }

  @Post('v1/support-chat/handoff')
  @HttpCode(200)
  handOffInApp(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(supportChatHandoffSchema)) body: SupportChatHandoff) {
    return this.chat.handOffInApp(tenant, body);
  }
}
