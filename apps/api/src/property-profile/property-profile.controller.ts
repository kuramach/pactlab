import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { acceptSchema, photoParamsSchema, populateSchema, type AcceptBody, type PopulateBody } from './property-profile.schemas';
import { PropertyProfileService } from './property-profile.service';

type DealParams = { dealId: string };

@Controller('v1/deals/:dealId/property-profile')
export class PropertyProfileController {
  constructor(@Inject(PropertyProfileService) private readonly service: PropertyProfileService) {}

  /** The profile: the accepted values, the proposed record, the gallery and any contradictions with imports. Audited (owner data). */
  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  /** Fill the profile from the address: fetch the public record (US only) and propose it; nothing is accepted yet. */
  @Post('populate')
  @HttpCode(200)
  populate(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(populateSchema)) body: PopulateBody) {
    return this.service.populate(tenant, params.dealId, body.address ?? null, requestId);
  }

  /** The reviewer accepts (and may edit) values; they become pact data with their provenance. */
  @Post('accept')
  @HttpCode(200)
  accept(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(acceptSchema)) body: AcceptBody) {
    return this.service.accept(tenant, params.dealId, body, requestId);
  }

  /** Compare accepted values with the imported rent roll; a contradiction becomes a claim (finding input), nothing is overwritten. */
  @Post('check')
  @HttpCode(200)
  check(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.check(tenant, params.dealId, requestId);
  }

  /** Find the Street View exterior and Places photos for the address. */
  @Post('photos')
  @HttpCode(200)
  photos(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.refreshPhotos(tenant, params.dealId, requestId);
  }

  /** One gallery photo's bytes, passed through from the provider (the key never leaves the server). */
  @Get('photos/:index/image')
  async image(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(photoParamsSchema)) params: { dealId: string; index: number }, @Res({ passthrough: true }) reply: FastifyReply) {
    const image = await this.service.photoImage(tenant, params.dealId, params.index, requestId);
    void reply
      .header('content-type', image.contentType)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('content-disposition', 'inline');
    return Buffer.from(image.bytes);
  }
}
