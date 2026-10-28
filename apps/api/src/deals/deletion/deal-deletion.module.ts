import { Body, Controller, Delete, HttpCode, Inject, Module, Param, type DynamicModule } from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../../auth/tenant.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DealAccess } from '../deal-access';
import { RequestId } from '../request-id.decorator';
import { DealDeletionService, DELETION_STORES, type DeletionStores } from './deal-deletion.service';

const deleteDealSchema = z.strictObject({ confirmName: z.string().min(1).max(200) });

@Controller('v1/deals/:dealId')
class DealDeletionController {
  constructor(@Inject(DealDeletionService) private readonly service: DealDeletionService) {}

  /** Delete the deal. The lead types its name to confirm; one-way. */
  @Delete()
  @HttpCode(200)
  remove(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(deleteDealSchema)) body: { confirmName: string },
  ) {
    return this.service.delete(tenant, params.dealId, body.confirmName, requestId);
  }
}

/** Deleting a deal (deal lead only). */
@Module({})
export class DealDeletionModule {
  static register(stores: DeletionStores): DynamicModule {
    return {
      module: DealDeletionModule,
      controllers: [DealDeletionController],
      providers: [DealDeletionService, DealAccess, { provide: DELETION_STORES, useValue: stores }],
    };
  }
}
