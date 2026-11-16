import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { pageQuerySchema, type ApiAccessView, type AuthorizeCheckView, type ConnectedAppView, type DeviceCheckView, type PageQuery } from '@pactlab/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AllowUnscoped, NoDemo, type Principal, Public, RecentSignIn } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { apiAccessSchema, checkSchema, decisionSchema, deviceCheckSchema, deviceDecisionSchema, grantParamsSchema } from './oauth.schemas';
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

/** Pactlab's OAuth authorization server for the MCP server (T-084) and the REST API (T-128), ADR 0024. */
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

  /** RFC 8628 §3.1: a script asks for a code to show its person. Form-encoded (JSON accepted). */
  @Public()
  @Post('oauth/device_authorization')
  @HttpCode(200)
  deviceAuthorization(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.deviceAuthorization((body ?? {}) as Record<string, unknown>, rateLimitAddress(request), `${this.service.issuer}/device`));
  }

  /** The device approval page asks what the code is for (as the signed-in person). */
  @AllowUnscoped()
  @Post('oauth/device/check')
  @HttpCode(200)
  deviceCheck(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(deviceCheckSchema)) body: { userCode: string }): Promise<DeviceCheckView> {
    return this.service.deviceCheck(principal, body.userCode);
  }

  @AllowUnscoped()
  @NoDemo()
  @RecentSignIn()
  @Post('oauth/device/decide')
  @HttpCode(200)
  deviceDecide(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(deviceDecisionSchema)) body: { userCode: string; approve: boolean }, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.deviceDecide(principal, body.userCode, body.approve));
  }

  /** The Developers pages: whether the API and MCP are on here (T-128). */
  @Get('me/developer-access')
  developerAccess(@CurrentPrincipal() principal: Principal) {
    return this.service.developerAccess(principal);
  }

  /** Settings → API access (organization owners and admins): the switch and every member's grants. */
  @Get('organization/api-access')
  apiAccess(@CurrentPrincipal() principal: Principal, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery, @Res({ passthrough: true }) reply: FastifyReply): Promise<ApiAccessView | { error: string; error_description: string }> {
    return protocol(reply, () => this.service.apiAccess(principal, query.cursor, query.limit));
  }

  @NoDemo()
  @RecentSignIn()
  @Put('organization/api-access')
  setApiAccess(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(apiAccessSchema)) body: { enabled: boolean }, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.setApiAccess(principal, body.enabled));
  }

  @NoDemo()
  @Delete('organization/api-access/grants/:grantId')
  revokeMemberGrant(@CurrentPrincipal() principal: Principal, @Param(new ZodValidationPipe(grantParamsSchema)) params: { grantId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    return protocol(reply, () => this.service.revokeMemberGrant(principal, params.grantId));
  }
}
