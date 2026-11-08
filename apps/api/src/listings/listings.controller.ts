import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  addListingImageSchema,
  addListingVideoSchema,
  listingMediaCaptionSchema,
  listingMediaOrderSchema,
  listingMediaParamsSchema,
  publicListingMediaParamsSchema,
  type AddListingImageBody,
  type AddListingVideoBody,
  confirmListingInterestSchema,
  declineListingInterestSchema,
  listingInterestParamsSchema,
  listingInterestSchema,
  listingParamsSchema,
  listingSlugParamsSchema,
  listingStatusSchema,
  saveListingSchema,
  propertyLookupSchema,
  savePropertySchema,
  type PropertyLookupBody,
  type SavePropertyBody,
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
type MediaParams = { dealId: string; mediaId: string };

function sendImage(reply: FastifyReply, image: { bytes: Uint8Array; contentType: string }, cache: string) {
  void reply.header('content-type', image.contentType).header('cache-control', cache).header('x-content-type-options', 'nosniff').header('content-disposition', 'inline');
  return Buffer.from(image.bytes);
}

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

  /** Propose the property's facts from its address (batch 2); nothing is stored. */
  @Post('property-lookup')
  @HttpCode(200)
  lookupProperty(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(propertyLookupSchema)) body: PropertyLookupBody) {
    return this.listings.lookupProperty(tenant, params.dealId, body, requestId);
  }

  @Put('property')
  saveProperty(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(savePropertySchema)) body: SavePropertyBody) {
    return this.listings.saveProperty(tenant, params.dealId, body, requestId);
  }

  @Put('status')
  setStatus(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(listingStatusSchema)) body: ListingStatusBody) {
    return this.listings.setStatus(tenant, params.dealId, body, requestId);
  }

  @Post('media/images')
  addImage(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(addListingImageSchema)) body: AddListingImageBody) {
    return this.listings.addImage(tenant, params.dealId, body, requestId);
  }

  @Post('media/videos')
  addVideo(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(addListingVideoSchema)) body: AddListingVideoBody) {
    return this.listings.addVideo(tenant, params.dealId, body, requestId);
  }

  @Put('media/order')
  orderMedia(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(listingMediaOrderSchema)) body: { ids: string[] }) {
    return this.listings.orderMedia(tenant, params.dealId, body.ids, requestId);
  }

  @Put('media/:mediaId')
  captionMedia(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingMediaParamsSchema)) params: MediaParams, @Body(new ZodValidationPipe(listingMediaCaptionSchema)) body: { caption: string | null }) {
    return this.listings.captionMedia(tenant, params.dealId, params.mediaId, body.caption, requestId);
  }

  @Delete('media/:mediaId')
  removeMedia(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingMediaParamsSchema)) params: MediaParams) {
    return this.listings.removeMedia(tenant, params.dealId, params.mediaId, requestId);
  }

  @Get('media/:mediaId/image')
  async ownImage(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(listingMediaParamsSchema)) params: MediaParams, @Res({ passthrough: true }) reply: FastifyReply) {
    return sendImage(reply, await this.listings.ownImage(tenant, params.dealId, params.mediaId, requestId), 'private, no-store');
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

  /** One picture of a published page. */
  @Public()
  @Get('listings/:slug/media/:mediaId')
  async image(@Param(new ZodValidationPipe(publicListingMediaParamsSchema)) params: { slug: string; mediaId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    return sendImage(reply, await this.listings.publicImage(params.slug, params.mediaId), 'public, max-age=300');
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
