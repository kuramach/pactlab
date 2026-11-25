import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cardParamsSchema } from './feature-cards.schemas';
import { FeatureCardsService } from './feature-cards.service';

/** The signed-in person's feature cards (T-155): theirs alone, whichever organization is active. */
@Controller('v1/feature-cards')
export class FeatureCardsController {
  constructor(@Inject(FeatureCardsService) private readonly service: FeatureCardsService) {}

  @Get()
  list(@Tenant() tenant: TenantContext) {
    return this.service.list(tenant);
  }

  @Post('read')
  @HttpCode(200)
  read(@Tenant() tenant: TenantContext) {
    return this.service.markTrayRead(tenant);
  }

  @Post(':cardId/dismiss')
  @HttpCode(200)
  dismiss(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(cardParamsSchema)) params: { cardId: string }) {
    return this.service.dismiss(tenant, params.cardId);
  }
}
