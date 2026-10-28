import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  addBidSchema,
  answerSchema,
  askSchema,
  bidParamsSchema,
  inviteBidderSchema,
  offerSchema,
  passSchema,
  questionParamsSchema,
  saleParamsSchema,
  updateProcessSchema,
  type AddBidBody,
  type AnswerBody,
  type AskBody,
  type InviteBidderBody,
  type OfferBody,
  type PassBody,
  type UpdateProcessBody,
} from './sale.schemas';
import { SaleService } from './sale.service';

type DealParams = { dealId: string };
type BidParams = { dealId: string; bidId: string };

/** Seller-led sale (T-097): the seller's bidders board, and each bidder's own bid. */
@Controller('v1/deals/:dealId')
export class SaleController {
  constructor(@Inject(SaleService) private readonly sale: SaleService) {}

  @Get('sale')
  board(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams) {
    return this.sale.board(tenant, params.dealId, requestId);
  }

  @Put('sale')
  updateProcess(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(updateProcessSchema)) body: UpdateProcessBody,
  ) {
    return this.sale.updateProcess(tenant, params.dealId, body, requestId);
  }

  @Post('sale/next-round')
  @HttpCode(200)
  nextRound(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams) {
    return this.sale.nextRound(tenant, params.dealId, requestId);
  }

  @Post('bids')
  addBid(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(addBidSchema)) body: AddBidBody,
  ) {
    return this.sale.addBid(tenant, params.dealId, body, requestId);
  }

  @Post('bids/:bidId/invitations')
  invite(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(bidParamsSchema)) params: BidParams,
    @Body(new ZodValidationPipe(inviteBidderSchema)) body: InviteBidderBody,
  ) {
    return this.sale.inviteToBid(tenant, params.dealId, params.bidId, body, requestId);
  }

  @Post('bids/:bidId/shortlist')
  @HttpCode(200)
  shortlist(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(bidParamsSchema)) params: BidParams) {
    return this.sale.shortlist(tenant, params.dealId, params.bidId, requestId);
  }

  @Post('bids/:bidId/decline')
  @HttpCode(200)
  decline(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(bidParamsSchema)) params: BidParams) {
    return this.sale.decline(tenant, params.dealId, params.bidId, requestId);
  }

  @Post('bids/:bidId/award')
  @HttpCode(200)
  award(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(bidParamsSchema)) params: BidParams) {
    return this.sale.award(tenant, params.dealId, params.bidId, requestId);
  }

  @Post('bids/:bidId/round-model')
  addToRound(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(bidParamsSchema)) params: BidParams) {
    return this.sale.addToRound(tenant, params.dealId, params.bidId, requestId);
  }

  @Post('bid-questions/:questionId/answer')
  @HttpCode(200)
  answer(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(questionParamsSchema)) params: { dealId: string; questionId: string },
    @Body(new ZodValidationPipe(answerSchema)) body: AnswerBody,
  ) {
    return this.sale.answer(tenant, params.dealId, params.questionId, body, requestId);
  }

  // A bidder's own bid.

  @Get('my-bid')
  mine(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams) {
    return this.sale.mine(tenant, params.dealId, requestId);
  }

  @Post('my-bid/nda')
  @HttpCode(200)
  acceptNda(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams) {
    return this.sale.acceptNda(tenant, params.dealId, requestId);
  }

  @Post('my-bid/questions')
  ask(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(askSchema)) body: AskBody,
  ) {
    return this.sale.ask(tenant, params.dealId, body, requestId);
  }

  @Post('my-bid/offers')
  offer(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(offerSchema)) body: OfferBody,
  ) {
    return this.sale.offer(tenant, params.dealId, body, requestId);
  }

  @Post('my-bid/pass')
  @HttpCode(200)
  pass(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(saleParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(passSchema)) body: PassBody,
  ) {
    return this.sale.pass(tenant, params.dealId, body, requestId);
  }
}
