import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import {
  contactAdminQuerySchema,
  contactChannelParamsSchema,
  contactCodeSchema,
  contactEmailStartSchema,
  lineCallbackSchema,
  whatsappStartSchema,
  type ContactCodeBody,
  type ContactEmailStartBody,
  type LineCallbackBody,
  type PageQuery,
  type WhatsAppStartBody,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NoDemo, Public, type AuthenticatedRequest } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContactsService } from './contacts.service';

/** The request's headers as a WHATWG Headers (repeated headers joined). */
function headersOf(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return headers;
}

/** The caller's own bearer token, for the Auth0 `/userinfo` email claim. */
function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null;
}

/** "Your profile" (T-180): the signed-in person's own contact details, whichever organization is active. */
@Controller('v1/me/contact')
export class ContactsController {
  constructor(@Inject(ContactsService) private readonly service: ContactsService) {}

  @Get()
  profile(@Tenant() tenant: TenantContext, @Req() request: AuthenticatedRequest) {
    // Tenant-scoped routes always carry the principal the guard verified.
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException();
    return this.service.profile(tenant, principal, bearer(request));
  }

  @Post('email')
  @HttpCode(202)
  @NoDemo()
  startEmail(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(contactEmailStartSchema)) body: ContactEmailStartBody) {
    return this.service.startEmail(tenant, body.email);
  }

  @Post('email/confirm')
  @HttpCode(200)
  @NoDemo()
  confirmEmail(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(contactCodeSchema)) body: ContactCodeBody) {
    return this.service.confirmEmail(tenant, body.code);
  }

  @Post('telegram')
  @HttpCode(200)
  @NoDemo()
  telegram(@Tenant() tenant: TenantContext) {
    return this.service.telegramLink(tenant);
  }

  /** LINE (T-182): the LINE Login URL; it offers the account as a friend after consent. */
  @Post('line')
  @HttpCode(200)
  @NoDemo()
  line(@Tenant() tenant: TenantContext) {
    return this.service.lineLink(tenant);
  }

  /** Back from LINE Login: connected, or add the account as a friend to finish. */
  @Post('line/callback')
  @HttpCode(200)
  @NoDemo()
  lineCallback(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(lineCallbackSchema)) body: LineCallbackBody) {
    return this.service.lineCallback(tenant, body);
  }

  @Post('whatsapp')
  @HttpCode(202)
  @NoDemo()
  startWhatsApp(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(whatsappStartSchema)) body: WhatsAppStartBody) {
    return this.service.startWhatsApp(tenant, body);
  }

  @Post('whatsapp/confirm')
  @HttpCode(200)
  @NoDemo()
  confirmWhatsApp(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(contactCodeSchema)) body: ContactCodeBody) {
    return this.service.confirmWhatsApp(tenant, body.code);
  }

  @Post('channels/:channelId/test')
  @HttpCode(200)
  @NoDemo()
  test(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(contactChannelParamsSchema)) params: { channelId: string }) {
    return this.service.test(tenant, params.channelId);
  }

  @Delete('channels/:channelId')
  @HttpCode(200)
  disconnect(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(contactChannelParamsSchema)) params: { channelId: string }) {
    return this.service.disconnect(tenant, params.channelId);
  }
}

/** Organization owners and admins: members' contact details, masked, keyset-paged; each read audited. */
@Controller('v1/organization/contacts')
export class OrganizationContactsController {
  constructor(@Inject(ContactsService) private readonly service: ContactsService) {}

  @Get()
  page(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(contactAdminQuerySchema)) query: PageQuery) {
    return this.service.adminPage(tenant, query);
  }
}

const subscriptionQuery = z.object({ 'hub.mode': z.string().max(32).optional(), 'hub.verify_token': z.string().max(256).optional(), 'hub.challenge': z.string().max(128).optional() });

/** Platform operators (T-182): this month's LINE allowance. Counts only; anyone else gets 403. */
@Controller('v1/admin/line-allowance')
export class LineAllowanceController {
  constructor(@Inject(ContactsService) private readonly service: ContactsService) {}

  @Get()
  view(@Tenant() tenant: TenantContext) {
    return this.service.lineAllowanceView(tenant);
  }
}

/** Provider webhooks. Public: Telegram's secret-token header, and Meta's and LINE's body signatures, are the proof. */
@Controller('v1/webhooks')
export class ContactWebhooksController {
  constructor(@Inject(ContactsService) private readonly service: ContactsService) {}

  @Public()
  @Post('telegram')
  @HttpCode(200)
  telegram(@Req() request: FastifyRequest) {
    const body = request.body;
    let update: unknown;
    try {
      update = Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8')) : body;
    } catch {
      update = null;
    }
    return this.service.telegramWebhook(headersOf(request), update);
  }

  @Public()
  @Get('whatsapp')
  @Header('content-type', 'text/plain')
  subscribe(@Query(new ZodValidationPipe(subscriptionQuery)) query: z.infer<typeof subscriptionQuery>) {
    return this.service.whatsappSubscription({ mode: query['hub.mode'], token: query['hub.verify_token'], challenge: query['hub.challenge'] });
  }

  @Public()
  @Post('whatsapp')
  @HttpCode(200)
  whatsapp(@Req() request: FastifyRequest) {
    const body = request.body;
    return this.service.whatsappWebhook(Buffer.isBuffer(body) ? body : Buffer.alloc(0), headersOf(request));
  }

  @Public()
  @Post('line')
  @HttpCode(200)
  line(@Req() request: FastifyRequest) {
    const body = request.body;
    return this.service.lineWebhook(Buffer.isBuffer(body) ? body : Buffer.alloc(0), headersOf(request));
  }
}
