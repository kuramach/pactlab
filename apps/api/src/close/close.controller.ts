import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public, RecentSignIn } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  closeBatchParamsSchema,
  closingItemBodySchema,
  disputeBodySchema,
  docusignCallbackSchema,
  esignBodySchema,
  itemParamsSchema,
  paidBodySchema,
  sideParamsSchema,
  signatoryBodySchema,
  type ClosingItemBody,
  type DisputeBody,
  type EsignBody,
  type PaidBody,
  type SignatoryBody,
} from './close.schemas';
import { CloseService } from './close.service';

type DealParams = { dealId: string };
type BatchParams = { dealId: string; batchId: string };
type ItemParams = { dealId: string; itemId: string };

/** The two-sided close (T-107): signatories, sign-off, e-signature, checklist and close. */
@Controller('v1/deals/:dealId')
export class CloseController {
  constructor(@Inject(CloseService) private readonly service: CloseService) {}

  @Get('close')
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Put('signatories/:side')
  nameSignatory(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(sideParamsSchema)) params: { dealId: string; side: 'BUYER' | 'SELLER' },
    @Body(new ZodValidationPipe(signatoryBodySchema)) body: SignatoryBody,
  ) {
    return this.service.nameSignatory(tenant, params.dealId, params.side, body, requestId);
  }

  @Post('terms/:batchId/signoff')
  @HttpCode(201)
  signOff(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(closeBatchParamsSchema)) params: BatchParams) {
    return this.service.signOff(tenant, params.dealId, params.batchId, requestId);
  }

  @Post('terms/:batchId/decline')
  @HttpCode(201)
  decline(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(closeBatchParamsSchema)) params: BatchParams) {
    return this.service.decline(tenant, params.dealId, params.batchId, requestId);
  }

  @Post('terms/:batchId/esign')
  @HttpCode(201)
  esign(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(closeBatchParamsSchema)) params: BatchParams,
    @Body(new ZodValidationPipe(esignBodySchema)) body: EsignBody,
  ) {
    return this.service.sendForSignature(tenant, params.dealId, params.batchId, body, requestId);
  }

  @Post('terms/:batchId/esign/fixture-sign')
  @HttpCode(201)
  fixtureSign(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(closeBatchParamsSchema)) params: BatchParams) {
    return this.service.fixtureSign(tenant, params.dealId, params.batchId, requestId);
  }

  /** The agreed version's term sheet, as both sides sign it. */
  @Get('terms/:batchId/term-sheet.pdf')
  async termSheet(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(closeBatchParamsSchema)) params: BatchParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const sheet = await this.service.termSheet(tenant, params.dealId, params.batchId, requestId);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${sheet.fileName}"`)
      .header('etag', `"sha256-${sheet.sha256}"`)
      .header('cache-control', 'no-store');
    return Buffer.from(sheet.bytes);
  }

  @Post('closing-items')
  @HttpCode(201)
  addItem(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(closingItemBodySchema)) body: ClosingItemBody,
  ) {
    return this.service.addItem(tenant, params.dealId, body, requestId);
  }

  @Post('closing-items/:itemId/done')
  @HttpCode(201)
  tick(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(itemParamsSchema)) params: ItemParams) {
    return this.service.tick(tenant, params.dealId, params.itemId, requestId);
  }

  @Post('closing-items/:itemId/paid')
  @HttpCode(201)
  paid(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(itemParamsSchema)) params: ItemParams,
    @Body(new ZodValidationPipe(paidBodySchema)) body: PaidBody,
  ) {
    return this.service.recordPayment(tenant, params.dealId, params.itemId, body, requestId);
  }

  @Post('closing-items/:itemId/dispute')
  @HttpCode(201)
  dispute(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(itemParamsSchema)) params: ItemParams,
    @Body(new ZodValidationPipe(disputeBodySchema)) body: DisputeBody,
  ) {
    return this.service.disputePayment(tenant, params.dealId, params.itemId, body, requestId);
  }

  @Post('close')
  @HttpCode(201)
  close(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.close(tenant, params.dealId, requestId);
  }
}

/** The organization's own DocuSign account (T-107): connect, see, disconnect. Owners and admins. */
@Controller('v1/organization/docusign')
export class DocuSignConnectionController {
  constructor(@Inject(CloseService) private readonly service: CloseService) {}

  @Get()
  status(@Tenant() tenant: TenantContext) {
    return this.service.docusignStatus(tenant);
  }

  @RecentSignIn()
  @Post('start')
  @HttpCode(200)
  start(@Tenant() tenant: TenantContext) {
    return this.service.docusignStart(tenant);
  }

  @RecentSignIn()
  @Post('callback')
  @HttpCode(200)
  callback(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(docusignCallbackSchema)) body: { code: string; state: string }) {
    return this.service.docusignCallback(tenant, body.code, body.state, requestId);
  }

  @Delete()
  disconnect(@Tenant() tenant: TenantContext, @RequestId() requestId: string) {
    return this.service.docusignDisconnect(tenant, requestId);
  }
}

/** DocuSign Connect events. Public: the HMAC signature over the raw body is the proof. */
@Controller('v1/webhooks/signing')
export class SigningWebhookController {
  constructor(@Inject(CloseService) private readonly service: CloseService) {}

  @Public()
  @Post('docusign')
  @HttpCode(200)
  docusign(@Req() request: FastifyRequest, @Headers() headers: Record<string, string | string[] | undefined>) {
    const body = request.body;
    return this.service.docusignEvent(Buffer.isBuffer(body) ? body : Buffer.alloc(0), headers);
  }
}
