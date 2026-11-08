import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { PasskeyOptionsView, PasskeysView } from '@pactlab/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import { AllowUnscoped, Public, type Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from './client-address';
import { passkeyParamsSchema, passkeyRegisterBodySchema, passkeySignInBodySchema } from './email-login.schemas';
import type { IssuedSession } from './email-login.service';
import { PasskeysService } from './passkeys.service';

/** Passkey sign-in (T-108) for email-code organizations, and the signed-in user's passkeys. */
@Controller('v1')
export class PasskeysController {
  constructor(@Inject(PasskeysService) private readonly service: PasskeysService) {}

  @Public()
  @Post('auth/passkey/options')
  @HttpCode(200)
  signInOptions(@Req() request: FastifyRequest): Promise<PasskeyOptionsView> {
    return this.service.signInOptions(rateLimitAddress(request));
  }

  /** A session token, or a uniform 401 for any failure. */
  @Public()
  @Post('auth/passkey/verify')
  @HttpCode(200)
  signIn(@Body(new ZodValidationPipe(passkeySignInBodySchema)) body: { challengeId: string; response: unknown }): Promise<IssuedSession> {
    return this.service.signIn(body.challengeId, body.response as AuthenticationResponseJSON);
  }

  // Passkeys belong to the person, not an organization: unscoped sessions may manage them too.
  @AllowUnscoped()
  @Get('me/passkeys')
  list(@CurrentPrincipal() principal: Principal): Promise<PasskeysView> {
    return this.service.list(principal);
  }

  @AllowUnscoped()
  @Post('me/passkeys/options')
  @HttpCode(200)
  registrationOptions(@CurrentPrincipal() principal: Principal): Promise<PasskeyOptionsView> {
    return this.service.registrationOptions(principal);
  }

  @AllowUnscoped()
  @Post('me/passkeys')
  @HttpCode(201)
  register(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(passkeyRegisterBodySchema)) body: { challengeId: string; name: string; response: unknown },
  ): Promise<PasskeysView> {
    return this.service.register(principal, body.challengeId, body.response as RegistrationResponseJSON, body.name);
  }

  @AllowUnscoped()
  @Delete('me/passkeys/:passkeyId')
  remove(@CurrentPrincipal() principal: Principal, @Param(new ZodValidationPipe(passkeyParamsSchema)) params: { passkeyId: string }): Promise<PasskeysView> {
    return this.service.remove(principal, params.passkeyId);
  }

  /** "Not now" on the one-time offer after an email sign-in. */
  @AllowUnscoped()
  @Post('me/passkeys/offer/dismiss')
  @HttpCode(200)
  async dismissOffer(@CurrentPrincipal() principal: Principal): Promise<{ offer: false }> {
    await this.service.dismissOffer(principal);
    return { offer: false };
  }
}
