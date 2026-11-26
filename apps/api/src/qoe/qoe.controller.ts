import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  qoeDecisionBodySchema,
  qoeEntryBodySchema,
  qoeEntryParamsSchema,
  qoeReviseBodySchema,
  qoeWithdrawBodySchema,
  type QoeDecisionBody,
  type QoeEntryBody,
  type QoeReviseBody,
  type QoeWithdrawBody,
} from './qoe.schemas';
import { QoeService } from './qoe.service';

type DealParams = { dealId: string };
type EntryParams = { dealId: string; entryKey: string };

/** Quality of earnings (T-135): the schedule, the add-back register and the working-capital peg. */
@Controller('v1/deals/:dealId/qoe')
export class QoeController {
  constructor(@Inject(QoeService) private readonly service: QoeService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Post('entries')
  @HttpCode(201)
  record(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(qoeEntryBodySchema)) body: QoeEntryBody) {
    return this.service.record(tenant, params.dealId, body, requestId);
  }

  @Put('entries/:entryKey')
  revise(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(qoeEntryParamsSchema)) params: EntryParams, @Body(new ZodValidationPipe(qoeReviseBodySchema)) body: QoeReviseBody) {
    return this.service.revise(tenant, params.dealId, params.entryKey, body, requestId);
  }

  @Post('entries/:entryKey/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(qoeEntryParamsSchema)) params: EntryParams, @Body(new ZodValidationPipe(qoeWithdrawBodySchema)) body: QoeWithdrawBody) {
    return this.service.withdraw(tenant, params.dealId, params.entryKey, body, requestId);
  }

  /** A reviewer includes or excludes an add-back, with the reason (the only way an unverified one counts). */
  @Post('entries/:entryKey/decision')
  @HttpCode(200)
  decide(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(qoeEntryParamsSchema)) params: EntryParams, @Body(new ZodValidationPipe(qoeDecisionBodySchema)) body: QoeDecisionBody) {
    return this.service.decide(tenant, params.dealId, params.entryKey, body, requestId);
  }

  /** Draft a finding for each period where the imported P&L and a filed statement disagree (T-149). */
  @Post('pnl-conflicts')
  @HttpCode(200)
  raisePnlConflicts(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.raisePnlConflicts(tenant, params.dealId, requestId);
  }

  /** The proposed peg onto the buyer's open draft terms. */
  @Post('peg-term')
  @HttpCode(201)
  pegTerm(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.addPegTerm(tenant, params.dealId, requestId);
  }
}
