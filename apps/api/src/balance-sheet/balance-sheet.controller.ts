import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  balanceSheetItemInputSchema,
  balanceSheetItemParamsSchema,
  dealParamsSchema,
  reviseBalanceSheetItemSchema,
  withdrawBalanceSheetItemSchema,
  type BalanceSheetItemInput,
  type BalanceSheetView,
  type ReviseBalanceSheetItem,
  type WithdrawBalanceSheetItem,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { BalanceSheetService } from './balance-sheet.service';

@Controller('v1/deals/:dealId/balance-sheet-items')
export class BalanceSheetController {
  constructor(@Inject(BalanceSheetService) private readonly service: BalanceSheetService) {}

  @Get()
  list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<BalanceSheetView> {
    return this.service.list(tenant, params.dealId, requestId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(balanceSheetItemInputSchema)) body: BalanceSheetItemInput,
  ): Promise<BalanceSheetView> {
    return this.service.create(tenant, params.dealId, body, requestId);
  }

  @Put(':itemId')
  revise(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(balanceSheetItemParamsSchema)) params: { dealId: string; itemId: string },
    @Body(new ZodValidationPipe(reviseBalanceSheetItemSchema)) body: ReviseBalanceSheetItem,
  ): Promise<BalanceSheetView> {
    return this.service.revise(tenant, params.dealId, params.itemId, body, requestId);
  }

  @Post(':itemId/withdraw')
  @HttpCode(200)
  withdraw(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(balanceSheetItemParamsSchema)) params: { dealId: string; itemId: string },
    @Body(new ZodValidationPipe(withdrawBalanceSheetItemSchema)) body: WithdrawBalanceSheetItem,
  ): Promise<BalanceSheetView> {
    return this.service.withdraw(tenant, params.dealId, params.itemId, body, requestId);
  }
}
