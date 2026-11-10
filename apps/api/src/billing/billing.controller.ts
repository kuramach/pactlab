import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { checkoutBodySchema, createPromoCodeSchema, promoCodeBodySchema, type CreatePromoCodeInput } from '@pactlab/contracts';
import { isUuid, type TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { NoDemo, Public, RecentSignIn } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { rateLimitAddress } from '../email-login/client-address';
import { compSchema, fixtureSchema, organizationParams, promoParams } from './billing.schemas';
import { BillingService } from './billing.service';


/** The organization's billing (T-087): status, checkout, portal and promo codes. */
@Controller('v1/billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly service: BillingService) {}

  @Get()
  view(@Tenant() tenant: TenantContext) {
    return this.service.view(tenant);
  }

  @NoDemo()
  @RecentSignIn()
  @Post('checkout')
  @HttpCode(200)
  checkout(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(checkoutBodySchema)) body: { plan: z.infer<typeof checkoutBodySchema>['plan'] }) {
    return this.service.checkout(tenant, body.plan, null);
  }

  @NoDemo()
  @RecentSignIn()
  @Post('portal')
  @HttpCode(200)
  portal(@Tenant() tenant: TenantContext) {
    return this.service.portal(tenant);
  }

  @NoDemo()
  @Post('promo')
  @HttpCode(200)
  redeem(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(promoCodeBodySchema)) body: { code: string }, @Req() request: FastifyRequest) {
    return this.service.redeemPromo(tenant, body.code, rateLimitAddress(request));
  }

  /** Public, for the sign-up form: does this code work? Rate-limited per address. */
  @Public()
  @Post('promo/check')
  @HttpCode(200)
  check(@Body(new ZodValidationPipe(promoCodeBodySchema)) body: { code: string }, @Req() request: FastifyRequest) {
    return this.service.checkPromo(body.code, rateLimitAddress(request));
  }

  /** Local runs and tests only: "pay" a fixture checkout, through the real signed-webhook path. */
  @Post('fixture/complete')
  @HttpCode(200)
  async completeFixture(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(fixtureSchema)) body: { session: string }) {
    const provider = this.service.fixtureProvider();
    const session = provider?.session(body.session);
    if (!provider || !session || session.organizationId !== tenant.organizationId) throw new NotFoundException();
    for (const delivery of provider.complete(body.session)) await this.service.handleEvent(delivery.payload, delivery.signature);
    return { paid: true };
  }
}

/** Stripe webhooks. Public: Stripe's signature over the raw body is the proof. */
@Controller('v1/webhooks')
export class BillingWebhookController {
  constructor(@Inject(BillingService) private readonly service: BillingService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  async stripe(@Req() request: FastifyRequest, @Headers('stripe-signature') signature: string | undefined) {
    const body = request.body;
    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : '';
    try {
      return await this.service.handleEvent(raw, signature ?? '');
    } catch (error) {
      if (BillingService.isSignatureError(error)) throw new BadRequestException();
      throw error;
    }
  }
}

/** Operators (T-087): billing per organization, comps, resync and promo codes. */
@Controller('v1/admin')
export class BillingAdminController {
  constructor(@Inject(BillingService) private readonly service: BillingService) {}

  @Get('billing')
  accounts(@Tenant() tenant: TenantContext) {
    return this.service.adminAccounts(tenant);
  }

  @Post('organizations/:organizationId/billing/comp')
  @HttpCode(201)
  comp(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(organizationParams)) params: { organizationId: string }, @Body(new ZodValidationPipe(compSchema)) body: z.infer<typeof compSchema>) {
    return this.service.comp(tenant, params.organizationId, body.kind, body.packs);
  }

  @Post('organizations/:organizationId/billing/resync')
  @HttpCode(200)
  resync(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(organizationParams)) params: { organizationId: string }) {
    return this.service.resync(tenant, params.organizationId);
  }

  @Get('promo-codes')
  promoCodes(@Tenant() tenant: TenantContext) {
    return this.service.listPromoCodes(tenant);
  }

  @NoDemo()
  @RecentSignIn()
  @Post('promo-codes')
  @HttpCode(201)
  createPromoCode(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(createPromoCodeSchema)) body: CreatePromoCodeInput) {
    return this.service.createPromoCode(tenant, body);
  }

  @Post('promo-codes/:id/deactivate')
  @HttpCode(200)
  deactivate(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(promoParams)) params: { id: string }) {
    if (!isUuid(params.id)) throw new NotFoundException();
    return this.service.deactivatePromoCode(tenant, params.id);
  }
}
