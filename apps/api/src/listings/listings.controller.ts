import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  confirmListingInterestSchema,
  declineListingInterestSchema,
  listingInterestParamsSchema,
  listingInterestSchema,
  listingParamsSchema,
  listingSlugParamsSchema,
  listingStatusSchema,
  saveListingSchema,
  type DeclineListingInterestBody,
  type ListingInterestBody,
  type ListingStatusBody,
  type SaveListingBody,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Public } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { rateLimitAddress } from '../email-login/client-address';
import { ListingsService } from './listings.service';

type DealParams = { dealId: string };
type InterestParams = { dealId: string; interestId: string };

/** The seller's public page for a pact, and the requests for access left on it. */
@Controller('v1/deals/:dealId/listing')
export class ListingsController {
  constructor(@Inject(ListingsService) private readonly listings: ListingsService) {}

  @Get()
  get(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams) {
    return this.listings.get(tenant, params.dealId, requestId);
  }

  @Put()
  save(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(saveListingSchema)) body: SaveListingBody) {
    return this.listings.save(tenant, params.dealId, body, requestId);
  }

  @Put('status')
  setStatus(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(listingStatusSchema)) body: ListingStatusBody) {
    return this.listings.setStatus(tenant, params.dealId, body, requestId);
  }

  @Get('interests')
  interests(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams) {
    return this.listings.interests(tenant, params.dealId, requestId);
  }

  @Post('interests/:interestId/approve')
  @HttpCode(200)
  approve(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingInterestParamsSchema)) params: InterestParams) {
    return this.listings.approve(tenant, params.dealId, params.interestId, requestId);
  }

  @Post('interests/:interestId/decline')
  @HttpCode(200)
  decline(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(listingInterestParamsSchema)) params: InterestParams,
    @Body(new ZodValidationPipe(declineListingInterestSchema)) body: DeclineListingInterestBody,
  ) {
    return this.listings.decline(tenant, params.dealId, params.interestId, body, requestId);
  }
}

/** What anyone with a page's link may see and do, signed out. */
@Controller('v1/public')
export class PublicListingsController {
  constructor(@Inject(ListingsService) private readonly listings: ListingsService) {}

  @Public()
  @Get('listings/:slug')
  view(@Param(new ZodValidationPipe(listingSlugParamsSchema)) params: { slug: string }) {
    return this.listings.publicView(params.slug);
  }

  /** Always 202 "check your email" for a published page, whatever happened to the request. */
  @Public()
  @Post('listings/:slug/interest')
  @HttpCode(202)
  requestAccess(@Param(new ZodValidationPipe(listingSlugParamsSchema)) params: { slug: string }, @Body(new ZodValidationPipe(listingInterestSchema)) body: ListingInterestBody, @Req() request: FastifyRequest) {
    return this.listings.requestAccess(params.slug, body, rateLimitAddress(request));
  }

  @Public()
  @Post('listing-interest/confirm')
  @HttpCode(200)
  confirm(@Body(new ZodValidationPipe(confirmListingInterestSchema)) body: { token: string }) {
    return this.listings.confirm(body.token);
  }
}
