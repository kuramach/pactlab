import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AllowUnscoped, Public, type Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from './client-address';
import { selectOrganizationBodySchema, startBodySchema, verifyBodySchema } from './email-login.schemas';
import { EmailLoginService, type IssuedSession } from './email-login.service';

/** Email one-time-code sign-in for organizations that do not use Auth0. */
@Controller('v1/auth')
export class EmailLoginController {
  constructor(@Inject(EmailLoginService) private readonly service: EmailLoginService) {}

  /** Always 202 with the same body, whether or not a code was sent. */
  @Public()
  @Post('email/start')
  @HttpCode(202)
  async start(
    @Body(new ZodValidationPipe(startBodySchema)) body: { email: string },
    @Req() request: FastifyRequest,
  ): Promise<{ sent: true }> {
    await this.service.start(body.email, rateLimitAddress(request));
    return { sent: true };
  }

  /** A session token, or a uniform 401 for any failure. */
  @Public()
  @Post('email/verify')
  @HttpCode(200)
  verify(@Body(new ZodValidationPipe(verifyBodySchema)) body: { email: string; code: string }): Promise<IssuedSession> {
    return this.service.verify(body.email, body.code);
  }

  @AllowUnscoped()
  @Post('session/organization')
  @HttpCode(200)
  selectOrganization(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(selectOrganizationBodySchema)) body: { organizationId: string },
  ): Promise<IssuedSession> {
    return this.service.selectOrganization(principal, body.organizationId);
  }

  /** Revokes an email-code session immediately; a no-op for Auth0 tokens. */
  @AllowUnscoped()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.service.logout(principal);
  }
}
