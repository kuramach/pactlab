import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { SigningChoice, TenantContext } from '@pactlab/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NoDemo, Public } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { SigningService } from './signing.service';

const envelopeParams = z.strictObject({ dealId: z.uuid(), envelopeId: z.uuid() });
const artifactParams = z.strictObject({ dealId: z.uuid(), envelopeId: z.uuid(), kind: z.enum(['signed', 'certificate']) });
const choiceBody = z.strictObject({ provider: z.enum(['PACTLAB', 'DOCUSIGN']) });
type EnvelopeParams = { dealId: string; envelopeId: string };

/** A pact's envelopes (T-136): status and timeline, embedded signing sessions, and the signed files. */
@Controller('v1/deals/:dealId/signing')
export class SigningController {
  constructor(@Inject(SigningService) private readonly service: SigningService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  // An embedded session reaches the provider; shared demos sign in the app only (T-113).
  @NoDemo()
  @Post(':envelopeId/session')
  @HttpCode(200)
  session(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(envelopeParams)) params: EnvelopeParams) {
    return this.service.session(tenant, params.dealId, params.envelopeId, requestId);
  }

  @Get(':envelopeId/artifacts/:kind')
  async artifact(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(artifactParams)) params: EnvelopeParams & { kind: 'signed' | 'certificate' }, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.service.artifact(tenant, params.dealId, params.envelopeId, params.kind === 'signed' ? 'SIGNED_DOCUMENT' : 'CERTIFICATE', requestId);
    await reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${file.fileName}"`).header('x-content-type-options', 'nosniff').send(Buffer.from(file.bytes));
  }
}

/** Settings → Signing (T-136 item 9): which provider new envelopes go out with. Owners and admins change it. */
@Controller('v1/organization/signing')
export class SigningSettingsController {
  constructor(@Inject(SigningService) private readonly service: SigningService) {}

  @Get()
  settings(@Tenant() tenant: TenantContext) {
    return this.service.settings(tenant);
  }

  @Put()
  choose(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(choiceBody)) body: { provider: SigningChoice }) {
    return this.service.choose(tenant, body.provider, requestId);
  }
}

/** Pactlab signing's provider webhooks. Public: the signature over the raw body is the proof. */
@Controller('v1/webhooks/signing')
export class BoldSignWebhookController {
  constructor(@Inject(SigningService) private readonly service: SigningService) {}

  @Public()
  @Post('boldsign')
  @HttpCode(200)
  boldsign(@Req() request: FastifyRequest, @Headers() headers: Record<string, string | string[] | undefined>) {
    const body = request.body;
    return this.service.webhook('BOLDSIGN', Buffer.isBuffer(body) ? body : Buffer.alloc(0), headers);
  }
}
