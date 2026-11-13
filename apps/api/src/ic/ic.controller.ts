import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { dealParamsSchema, type IcSettingsView, type IcView } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { icAddressSchema, icConditionParams, icDecisionSchema, icMemberParams, icMemberSchema, icRequirementSchema, icSettingsSchema, icSubmissionParams, type IcDecisionInput } from './ic.schemas';
import { IcService } from './ic.service';

/** The investment committee on a pact (T-118). */
@Controller('v1/deals/:dealId/ic')
export class IcController {
  constructor(@Inject(IcService) private readonly service: IcService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }): Promise<IcView> {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Post('submissions')
  @HttpCode(201)
  submit(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string }): Promise<IcView> {
    return this.service.submit(tenant, params.dealId, requestId);
  }

  @Post('submissions/:submissionId/decision')
  @HttpCode(201)
  decide(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(icSubmissionParams)) params: { dealId: string; submissionId: string },
    @Body(new ZodValidationPipe(icDecisionSchema)) body: IcDecisionInput,
  ): Promise<IcView> {
    return this.service.decide(tenant, params.dealId, params.submissionId, body, requestId);
  }

  @Post('conditions/:conditionId/address')
  @HttpCode(200)
  address(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(icConditionParams)) params: { dealId: string; conditionId: string },
    @Body(new ZodValidationPipe(icAddressSchema)) body: { note: string | null },
  ): Promise<IcView> {
    return this.service.address(tenant, params.dealId, params.conditionId, body.note, requestId);
  }

  @Post('conditions/:conditionId/clear')
  @HttpCode(200)
  clear(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(icConditionParams)) params: { dealId: string; conditionId: string }): Promise<IcView> {
    return this.service.clear(tenant, params.dealId, params.conditionId, requestId);
  }

  @Put('requirement')
  setRequirement(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(icRequirementSchema)) body: { required: boolean | null },
  ): Promise<IcView> {
    return this.service.setRequirement(tenant, params.dealId, body.required, requestId);
  }
}

/** The organization's investment committee and its default requirement (T-118). Owners and admins edit. */
@Controller('v1/organization/ic')
export class OrganizationIcController {
  constructor(@Inject(IcService) private readonly service: IcService) {}

  @Get()
  settings(@Tenant() tenant: TenantContext): Promise<IcSettingsView> {
    return this.service.settings(tenant);
  }

  @Put()
  save(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(icSettingsSchema)) body: { required: boolean; clearsConditions: boolean }): Promise<IcSettingsView> {
    return this.service.saveSettings(tenant, body, requestId);
  }

  @Put('members/:userId')
  setMember(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(icMemberParams)) params: { userId: string },
    @Body(new ZodValidationPipe(icMemberSchema)) body: { member: boolean },
  ): Promise<IcSettingsView> {
    return this.service.setMember(tenant, params.userId, body.member, requestId);
  }
}
