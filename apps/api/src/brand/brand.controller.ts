import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { BrandFont, TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { brandLogoQuerySchema, brandLogoSchema, brandSlugSchema, brandUpdateSchema, brandWebsiteSchema } from './brand.schemas';
import { BrandService } from './brand.service';

/**
 * A logo is served as an image and nothing else: an SVG cannot run script or load anything,
 * and no browser may guess another type.
 */
async function sendLogo(reply: FastifyReply, logo: { bytes: Uint8Array; contentType: string }, cache: string) {
  await reply
    .header('content-type', logo.contentType)
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', cache)
    .send(Buffer.from(logo.bytes));
}

/** The organization's brand kit (T-123): members read it, owners and admins change it. */
@Controller('v1/organization/brand')
export class BrandController {
  constructor(@Inject(BrandService) private readonly service: BrandService) {}

  @Get()
  get(@Tenant() tenant: TenantContext) {
    return this.service.get(tenant);
  }

  @Put('website')
  website(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(brandWebsiteSchema)) body: { websiteUrl: string | null }) {
    return this.service.setWebsite(tenant, body.websiteUrl, requestId);
  }

  @Post('extract')
  @HttpCode(202)
  extract(@Tenant() tenant: TenantContext, @RequestId() requestId: string) {
    return this.service.extract(tenant, requestId);
  }

  @Post('apply-draft')
  @HttpCode(200)
  applyDraft(@Tenant() tenant: TenantContext, @RequestId() requestId: string) {
    return this.service.applyDraft(tenant, requestId);
  }

  @Put()
  update(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(brandUpdateSchema)) body: { accentColor: string | null; primaryColor: string | null; font: BrandFont }) {
    return this.service.update(tenant, body, requestId);
  }

  @Post('logo')
  @HttpCode(200)
  uploadLogo(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(brandLogoSchema)) body: { contentBase64: string }) {
    return this.service.uploadLogo(tenant, body.contentBase64, requestId);
  }

  @Delete()
  revert(@Tenant() tenant: TenantContext, @RequestId() requestId: string) {
    return this.service.revert(tenant, requestId);
  }

  @Get('logo')
  async logo(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(brandLogoQuerySchema)) query: { which: 'current' | 'draft' }, @Res() reply: FastifyReply) {
    await sendLogo(reply, await this.service.logo(tenant, query.which), 'private, max-age=300');
  }
}

/** The organization's sign-in page brand, before sign-in: name, colors, font and logo only. */
@Controller('v1/brand')
export class PublicBrandController {
  constructor(@Inject(BrandService) private readonly service: BrandService) {}

  @Public()
  @Get(':slug')
  get(@Param(new ZodValidationPipe(brandSlugSchema)) params: { slug: string }) {
    return this.service.publicBrand(params.slug);
  }

  @Public()
  @Get(':slug/logo')
  async logo(@Param(new ZodValidationPipe(brandSlugSchema)) params: { slug: string }, @Res() reply: FastifyReply) {
    await sendLogo(reply, await this.service.publicLogo(params.slug), 'public, max-age=300');
  }
}
