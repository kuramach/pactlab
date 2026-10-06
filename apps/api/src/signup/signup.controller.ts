import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { startSignupSchema, verifySignupSchema, type StartSignupBody } from './signup.schemas';
import { SignupService, type SignupResult } from './signup.service';

@Controller('v1/signup')
export class SignupController {
  constructor(@Inject(SignupService) private readonly service: SignupService) {}

  /** Always 202 with the same body for valid work addresses, new or not. */
  @Public()
  @Post('start')
  @HttpCode(202)
  async start(
    @Body(new ZodValidationPipe(startSignupSchema)) body: StartSignupBody,
    @Req() request: FastifyRequest,
  ): Promise<{ sent: true }> {
    await this.service.start(body, rateLimitAddress(request));
    return { sent: true };
  }

  /** Creates the organization and owner, or a uniform 401. */
  @Public()
  @Post('verify')
  @HttpCode(201)
  verify(@Body(new ZodValidationPipe(verifySignupSchema)) body: { email: string; code: string }): Promise<SignupResult> {
    return this.service.verify(body.email, body.code);
  }
}
