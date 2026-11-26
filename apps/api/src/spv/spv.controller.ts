import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { NoDemo, RecentSignIn } from '../auth/auth.guard';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { inviteBodySchema, seatBodySchema, seatParamsSchema, seatsQuerySchema, seatUpdateSchema, vehicleBodySchema, versionsQuerySchema, type InviteBody, type SeatBody, type SeatsQuery, type SeatUpdate, type VehicleBody, type VersionsQuery } from './spv.schemas';
import { SpvService } from './spv.service';

type DealParams = { dealId: string };
type SeatParams = { dealId: string; seatId: string };

/** Startup equity SPV (T-141): the organizer's vehicle, seats and investor view; an investor's own view. */
@Controller('v1/deals/:dealId/spv')
export class SpvController {
  constructor(@Inject(SpvService) private readonly service: SpvService) {}

  @Get()
  view(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.view(tenant, params.dealId, requestId);
  }

  @Put('vehicle')
  saveVehicle(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(vehicleBodySchema)) body: VehicleBody) {
    return this.service.saveVehicle(tenant, params.dealId, body, requestId);
  }

  @Get('seats')
  seats(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(seatsQuerySchema)) query: SeatsQuery) {
    return this.service.seats(tenant, params.dealId, query, requestId);
  }

  @Post('seats')
  @HttpCode(201)
  addSeat(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Body(new ZodValidationPipe(seatBodySchema)) body: SeatBody) {
    return this.service.addSeat(tenant, params.dealId, body, requestId);
  }

  @Patch('seats/:seatId')
  updateSeat(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(seatParamsSchema)) params: SeatParams, @Body(new ZodValidationPipe(seatUpdateSchema)) body: SeatUpdate) {
    return this.service.updateSeat(tenant, params.dealId, params.seatId, body, requestId);
  }

  /** Inviting someone into the pact: an outward act, so a recent sign-in and never from a shared demo. */
  @Post('seats/:seatId/invite')
  @HttpCode(201)
  @RecentSignIn()
  @NoDemo()
  invite(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(seatParamsSchema)) params: SeatParams, @Body(new ZodValidationPipe(inviteBodySchema)) body: InviteBody) {
    return this.service.invite(tenant, params.dealId, params.seatId, body, requestId);
  }

  @Post('checks')
  @HttpCode(200)
  checks(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.runChecks(tenant, params.dealId, requestId);
  }

  @Get('investor-view/preview')
  preview(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.preview(tenant, params.dealId, requestId);
  }

  @Post('investor-view/publish')
  @HttpCode(201)
  publish(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.publish(tenant, params.dealId, requestId);
  }

  @Get('investor-view/versions')
  versions(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams, @Query(new ZodValidationPipe(versionsQuerySchema)) query: VersionsQuery) {
    return this.service.versions(tenant, params.dealId, query, requestId);
  }

  /** An investor's own seat and the latest published investor view. */
  @Get('mine')
  mine(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams) {
    return this.service.mine(tenant, params.dealId, requestId);
  }
}
