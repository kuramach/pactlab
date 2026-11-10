import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { AuthorizeCheckView, ConnectedAppView } from '@pactlab/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AllowUnscoped, NoDemo, type Principal, Public, RecentSignIn } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { checkSchema, decisionSchema, grantParamsSchema } from './oauth.schemas';
import { OAuthProtocolError, OAuthService } from './oauth.service';


/** RFC 6749 §5.2 bodies, with no-store as the token endpoint requires. */
async function protocol<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | { error: string; error_description: string }> {
  reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof OAuthProtocolError)) throw error;
    reply.status(error.status);
    return { error: error.error, error_description: error.description };
  }
}

/** Pactlab's OAuth authorization server for the MCP server (T-084, ADR 0024). */
@Controller('v1')
export class OAuthController {
  constructor(@Inject(OAuthService) private readonly service: OAuthService) {}

  @Public()
  @Post('oauth/register')
  @HttpCode(201)
  register(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.register(body, rateLimitAddress(request)));
  }

  /** Form-encoded, as OAuth requires (JSON is accepted too). */
  @Public()
  @Post('oauth/token')
  @HttpCode(200)
  token(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.token((body ?? {}) as Record<string, unknown>));
  }

  @Public()
  @Post('oauth/revoke')
  @HttpCode(200)
  async revoke(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, async () => {
      await this.service.revoke((body ?? {}) as Record<string, unknown>);
      return {};
    });
  }

  /** The consent page asks what to show (as the signed-in person). */
  @AllowUnscoped()
  @Post('oauth/authorize/check')
  @HttpCode(200)
  check(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(checkSchema)) body: { params: Record<string, string> }): Promise<AuthorizeCheckView> {
    return this.service.check(principal, body.params);
  }

  /** Approve or decline: where to send the browser next. */
  @AllowUnscoped()
  @NoDemo()
  @RecentSignIn()
  @Post('oauth/authorize')
  @HttpCode(200)
  async decide(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(decisionSchema)) body: { params: Record<string, string>; approve: boolean }, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.decide(principal, body.params, body.approve));
  }

  @AllowUnscoped()
  @Get('me/connected-apps')
  connectedApps(@CurrentPrincipal() principal: Principal, @Res({ passthrough: true }) reply: FastifyReply): Promise<{ apps: ConnectedAppView[] } | { error: string; error_description: string }> {
    return protocol(reply, () => this.service.connectedApps(principal));
  }

  @AllowUnscoped()
  @Delete('me/connected-apps/:grantId')
  disconnect(@CurrentPrincipal() principal: Principal, @Param(new ZodValidationPipe(grantParamsSchema)) params: { grantId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.disconnect(principal, params.grantId));
  }
}
