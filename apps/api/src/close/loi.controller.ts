import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Res, UnprocessableEntityException } from '@nestjs/common';
import { dealParamsSchema, type LoiView } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { loiFieldsSchema, type LoiFields } from './loi-content';
import { LoiService } from './loi.service';

const loiParams = z.strictObject({ dealId: z.uuid(), loiId: z.uuid() });
const sendSchema = z.strictObject({ method: z.enum(['IN_APP', 'ESIGN']) });
const requirementSchema = z.strictObject({ required: z.boolean() });
type LoiParams = { dealId: string; loiId: string };

/** Letters of intent (T-119). */
@Controller('v1/deals/:dealId/loi')
export class LoiController {
  constructor(@Inject(LoiService) private readonly service: LoiService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }): Promise<LoiView> {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Post()
  @HttpCode(201)
  draft(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }): Promise<LoiView> {
    return this.service.draft(tenant, params.dealId, requestId);
  }

  @Put(':loiId/fields')
  fields(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(loiParams)) params: LoiParams, @Body(new ZodValidationPipe(loiFieldsSchema)) body: LoiFields): Promise<LoiView> {
    return this.service.saveFields(tenant, params.dealId, params.loiId, body, requestId);
  }

  // E-signature reaches outside Pactlab; a shared demo signs in the app only (T-113).
  @Post(':loiId/send')
  @HttpCode(200)
  async send(
    @Tenant() tenant: TenantContext,
    @CurrentPrincipal() principal: Principal,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(loiParams)) params: LoiParams,
    @Body(new ZodValidationPipe(sendSchema)) body: { method: 'IN_APP' | 'ESIGN' },
  ): Promise<LoiView> {
    if (principal.demo && body.method === 'ESIGN') throw new UnprocessableEntityException({ code: 'DEMO_NOT_AVAILABLE' });
    return this.service.send(tenant, params.dealId, params.loiId, body.method, requestId);
  }

  @Post(':loiId/sign')
  @HttpCode(200)
  sign(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(loiParams)) params: LoiParams): Promise<LoiView> {
    return this.service.sign(tenant, params.dealId, params.loiId, requestId);
  }

  @Post(':loiId/decline')
  @HttpCode(200)
  decline(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(loiParams)) params: LoiParams): Promise<LoiView> {
    return this.service.decline(tenant, params.dealId, params.loiId, requestId);
  }

  @Post(':loiId/fixture-sign')
  @HttpCode(200)
  fixtureSign(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(loiParams)) params: LoiParams): Promise<LoiView> {
    return this.service.fixtureSign(tenant, params.dealId, params.loiId, requestId);
  }

  @Put('requirement')
  requirement(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }, @Body(new ZodValidationPipe(requirementSchema)) body: { required: boolean }): Promise<LoiView> {
    return this.service.setRequirement(tenant, params.dealId, body.required, requestId);
  }

  @Get(':loiId/pdf')
  async pdf(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(loiParams)) params: LoiParams, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.service.pdf(tenant, params.dealId, params.loiId, requestId);
    await reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${file.fileName}"`).send(Buffer.from(file.bytes));
  }
}
