import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { chatInstallCallbackSchema, chatMembersQuerySchema, chatProviderParamsSchema, type ChatInstallCallbackBody, type ChatProviderParam, type PageQuery } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { NoDemo, Public, RecentSignIn } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChatService } from './chat.service';

function headersOf(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return headers;
}

type ProviderParams = { provider: ChatProviderParam };

/** Settings → Connected apps → Slack / Microsoft Teams (T-181): an organization admin installs Pactlab once. */
@Controller('v1/organization/chat-apps')
export class ChatAppsController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}

  @Get()
  apps(@Tenant() tenant: TenantContext) {
    return this.service.apps(tenant);
  }

  @Post(':provider/install')
  @HttpCode(200)
  @NoDemo()
  @RecentSignIn()
  install(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(chatProviderParamsSchema)) params: ProviderParams) {
    return this.service.startInstall(tenant, params.provider);
  }

  @Post(':provider/callback')
  @HttpCode(200)
  @NoDemo()
  @RecentSignIn()
  callback(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(chatProviderParamsSchema)) params: ProviderParams, @Body(new ZodValidationPipe(chatInstallCallbackSchema)) body: ChatInstallCallbackBody) {
    return this.service.finishInstall(tenant, params.provider, body);
  }

  @Delete(':provider')
  @HttpCode(200)
  @NoDemo()
  uninstall(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(chatProviderParamsSchema)) params: ProviderParams) {
    return this.service.uninstall(tenant, params.provider);
  }

  @Get(':provider/members')
  members(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(chatProviderParamsSchema)) params: ProviderParams, @Query(new ZodValidationPipe(chatMembersQuerySchema)) query: PageQuery) {
    return this.service.members(tenant, params.provider, query);
  }
}

/** "Your profile" (T-181): Connect Slack / Connect Teams. Disconnect and test go through /v1/me/contact/channels. */
@Controller('v1/me/contact')
export class MyChatController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}

  @Post('chat/:provider')
  @HttpCode(202)
  @NoDemo()
  connect(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(chatProviderParamsSchema)) params: ProviderParams) {
    return this.service.connect(tenant, params.provider);
  }
}

/** Slack and Teams call these. Public: Slack's signing secret and the Bot Framework JWT are the proof. */
@Controller('v1/webhooks')
export class ChatWebhooksController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}

  private raw(request: FastifyRequest): Uint8Array {
    return Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  }

  @Public()
  @Post('slack/events')
  @HttpCode(200)
  slackEvents(@Req() request: FastifyRequest) {
    // Events API bodies are JSON (the raw-body hook has replaced the content type).
    return this.service.slackInbound(this.raw(request), headersOf(request), 'application/json');
  }

  @Public()
  @Post('slack/interactions')
  @HttpCode(200)
  slackInteractions(@Req() request: FastifyRequest) {
    // Interactivity posts a form with one `payload` field.
    return this.service.slackInbound(this.raw(request), headersOf(request), 'application/x-www-form-urlencoded');
  }

  @Public()
  @Post('teams/messages')
  @HttpCode(200)
  teams(@Req() request: FastifyRequest) {
    let activity: unknown;
    try {
      activity = JSON.parse(Buffer.from(this.raw(request)).toString('utf8'));
    } catch {
      activity = null;
    }
    const authorization = request.headers.authorization;
    return this.service.teamsInbound(typeof authorization === 'string' ? authorization : null, activity);
  }
}
