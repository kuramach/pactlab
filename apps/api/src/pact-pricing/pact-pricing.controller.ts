import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  consolePageQuerySchema,
  createPriceBookDraftSchema,
  createPricingPromoSchema,
  pactQuoteCreateSchema,
  previewPriceBookSchema,
  priceBooksQuerySchema,
  publishPriceBookSchema,
  updatePriceBookDraftSchema,
  updatePricingPromoSchema,
  type CreatePriceBookDraft,
  type CreatePricingPromo,
  type PactQuoteCreate,
  type UpdatePricingPromo,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NoDemo, RecentSignIn } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { PactPricingService } from './pact-pricing.service';

const currencyParams = z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/) });
const idParams = z.strictObject({ id: z.uuid() });

/** Pact pricing for organizations (T-177a): the live book per market, and stored quotes. */
@Controller('v1/pricing')
export class PactPricingController {
  constructor(@Inject(PactPricingService) private readonly service: PactPricingService) {}

  @Get('books/:currency')
  liveBook(@Param(new ZodValidationPipe(currencyParams)) params: { currency: string }) {
    return this.service.liveBook(params.currency);
  }

  @NoDemo()
  @Post('quotes')
  @HttpCode(201)
  quote(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(pactQuoteCreateSchema)) body: PactQuoteCreate, @Req() request: FastifyRequest) {
    return this.service.quote(tenant, body, rateLimitAddress(request));
  }

  @Get('quotes/:id')
  storedQuote(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.storedQuote(tenant, params.id);
  }
}

/** Platform operators (T-177a): price book versions and pact promo codes. Every write is audited. */
@Controller('v1/admin/pricing')
export class PactPricingAdminController {
  constructor(@Inject(PactPricingService) private readonly service: PactPricingService) {}

  @Get('books')
  books(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(priceBooksQuerySchema)) query: z.infer<typeof priceBooksQuerySchema>) {
    return this.service.books(tenant, query.currency ?? null, query);
  }

  @NoDemo()
  @Post('books/drafts')
  @HttpCode(201)
  createDraft(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(createPriceBookDraftSchema)) body: CreatePriceBookDraft) {
    return this.service.createDraft(tenant, body);
  }

  @NoDemo()
  @Put('books/drafts/:id')
  updateDraft(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }, @Body(new ZodValidationPipe(updatePriceBookDraftSchema)) body: z.infer<typeof updatePriceBookDraftSchema>) {
    return this.service.updateDraft(tenant, params.id, body.book);
  }

  @NoDemo()
  @Delete('books/drafts/:id')
  discardDraft(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.discardDraft(tenant, params.id);
  }

  @NoDemo()
  @RecentSignIn()
  @Post('books/drafts/:id/publish')
  @HttpCode(200)
  publish(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }, @Body(new ZodValidationPipe(publishPriceBookSchema)) body: z.infer<typeof publishPriceBookSchema>) {
    return this.service.publish(tenant, params.id, body.effectiveFrom);
  }

  @Post('books/drafts/:id/preview')
  @HttpCode(200)
  preview(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }, @Body(new ZodValidationPipe(previewPriceBookSchema)) body: z.infer<typeof previewPriceBookSchema>) {
    return this.service.preview(tenant, params.id, body.enterpriseValues);
  }

  @Get('promos')
  promos(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(consolePageQuerySchema)) query: z.infer<typeof consolePageQuerySchema>) {
    return this.service.promos(tenant, query);
  }

  @NoDemo()
  @RecentSignIn()
  @Post('promos')
  @HttpCode(201)
  createPromo(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(createPricingPromoSchema)) body: CreatePricingPromo) {
    return this.service.createPromo(tenant, body);
  }

  @NoDemo()
  @Patch('promos/:id')
  updatePromo(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }, @Body(new ZodValidationPipe(updatePricingPromoSchema)) body: UpdatePricingPromo) {
    return this.service.updatePromo(tenant, params.id, body);
  }

  @Get('promos/:id/redemptions')
  redemptions(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(idParams)) params: { id: string }, @Query(new ZodValidationPipe(consolePageQuerySchema)) query: z.infer<typeof consolePageQuerySchema>) {
    return this.service.redemptions(tenant, params.id, query);
  }
}
