import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { SessionPolicyView, SignedInDevicesView } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { AllowUnscoped, RecentSignIn, type Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { sessionParamsSchema, sessionPolicyBodySchema } from './email-login.schemas';
import { SessionsService } from './sessions.service';

/** Where the person is signed in, and the organization's trusted sign-in cap (T-112). */
@Controller('v1')
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly service: SessionsService) {}

  // Sessions belong to the person, not an organization: unscoped sessions may manage them too.
  @AllowUnscoped()
  @Get('me/sessions')
  devices(@CurrentPrincipal() principal: Principal): Promise<SignedInDevicesView> {
    return this.service.devices(principal);
  }

  @AllowUnscoped()
  @Delete('me/sessions/:sessionId')
  @HttpCode(200)
  async signOut(@CurrentPrincipal() principal: Principal, @Param(new ZodValidationPipe(sessionParamsSchema)) params: { sessionId: string }): Promise<{ signedOut: true }> {
    await this.service.signOut(principal, params.sessionId);
    return { signedOut: true };
  }

  @AllowUnscoped()
  @Post('me/sessions/revoke-others')
  @HttpCode(200)
  signOutOthers(@CurrentPrincipal() principal: Principal): Promise<{ signedOut: number }> {
    return this.service.signOutOthers(principal);
  }

  @Get('organization/session-policy')
  policy(@Tenant() tenant: TenantContext): Promise<SessionPolicyView> {
    return this.service.policy(tenant);
  }

  @RecentSignIn()
  @Put('organization/session-policy')
  setPolicy(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(sessionPolicyBodySchema)) body: { maxTrustedHours: SessionPolicyView['maxTrustedHours'] },
  ): Promise<SessionPolicyView> {
    return this.service.setPolicy(tenant, body.maxTrustedHours, requestId);
  }
}
