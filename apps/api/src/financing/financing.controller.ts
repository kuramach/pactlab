import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  dealParamsSchema,
  depositSchema,
  dispositionSchema,
  disputeSchema,
  documentParamsSchema,
  escrowSchema,
  financingDocumentSchema,
  planParamsSchema,
  planSchema,
  shareSchema,
  trancheParamsSchema,
  trancheSchema,
  type DepositBody,
  type EscrowBody,
  type FinancingDocumentBody,
  type PlanBody,
  type TrancheBody,
} from './financing.schemas';
import { FinancingService } from './financing.service';

type Disposition = 'APPLIED_AT_CLOSE' | 'RELEASED_TO_SELLER' | 'REFUNDED_TO_BUYER';

/** Buyer financing (T-117): the buyer's plan, its documents and the earnest deposit; the seller's view of them. */
@Controller('v1/deals/:dealId/financing')
export class FinancingController {
  constructor(@Inject(FinancingService) private readonly financing: FinancingService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }) {
    return this.financing.view(tenant, params.dealId, requestId);
  }

  @Put()
  plan(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(planSchema)) body: PlanBody) {
    return this.financing.updatePlan(tenant, params.dealId, body, requestId);
  }

  @Post('tranches')
  @HttpCode(200)
  addTranche(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(trancheSchema)) body: TrancheBody) {
    return this.financing.addTranche(tenant, params.dealId, body, requestId);
  }

  @Put('tranches/:trancheId')
  updateTranche(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(trancheParamsSchema)) params: { dealId: string; trancheId: string }, @Body(new ZodValidationPipe(trancheSchema)) body: TrancheBody) {
    return this.financing.updateTranche(tenant, params.dealId, params.trancheId, body, requestId);
  }

  @Delete('tranches/:trancheId')
  removeTranche(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(trancheParamsSchema)) params: { dealId: string; trancheId: string }) {
    return this.financing.removeTranche(tenant, params.dealId, params.trancheId, requestId);
  }

  @Post('documents')
  @HttpCode(200)
  attach(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(financingDocumentSchema)) body: FinancingDocumentBody) {
    return this.financing.attach(tenant, params.dealId, body, requestId);
  }

  @Put('documents/:documentId/sharing')
  share(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(documentParamsSchema)) params: { dealId: string; documentId: string }, @Body(new ZodValidationPipe(shareSchema)) body: { shared: boolean }) {
    return this.financing.share(tenant, params.dealId, params.documentId, body.shared, requestId);
  }

  @Get('documents/:documentId')
  async download(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(documentParamsSchema)) params: { dealId: string; documentId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    const file = await this.financing.download(tenant, params.dealId, params.documentId, requestId);
    void reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store');
    return Buffer.from(file.bytes);
  }

  @Put('escrow')
  escrow(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(escrowSchema)) body: EscrowBody) {
    return this.financing.setEscrow(tenant, params.dealId, body, requestId);
  }

  @Post('escrow/deposit')
  @HttpCode(200)
  deposit(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(depositSchema)) body: DepositBody) {
    return this.financing.recordDeposit(tenant, params.dealId, body, requestId);
  }

  /** The buyer records where their deposit went (refunded, or applied at close). */
  @Post('escrow/disposition')
  @HttpCode(200)
  buyerDisposition(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(dispositionSchema)) body: { disposition: Disposition }) {
    return this.financing.disposition(tenant, params.dealId, null, body.disposition, requestId);
  }

  // The seller answers a buyer's deposit: per plan, since a seller-led pact has one per bid.
  @Post('plans/:planId/escrow/confirm')
  @HttpCode(200)
  confirm(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(planParamsSchema)) params: { dealId: string; planId: string }) {
    return this.financing.confirmDeposit(tenant, params.dealId, params.planId, requestId);
  }

  @Post('plans/:planId/escrow/dispute')
  @HttpCode(200)
  dispute(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(planParamsSchema)) params: { dealId: string; planId: string }, @Body(new ZodValidationPipe(disputeSchema)) body: { note: string }) {
    return this.financing.disputeDeposit(tenant, params.dealId, params.planId, body.note, requestId);
  }

  @Post('plans/:planId/escrow/disposition')
  @HttpCode(200)
  sellerDisposition(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(planParamsSchema)) params: { dealId: string; planId: string }, @Body(new ZodValidationPipe(dispositionSchema)) body: { disposition: Disposition }) {
    return this.financing.disposition(tenant, params.dealId, params.planId, body.disposition, requestId);
  }
}
