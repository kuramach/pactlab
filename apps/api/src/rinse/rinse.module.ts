import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { PrepInvitesService } from './prep-invites.service';
import { PreparerService } from './preparer.service';
import { PrepInvitesController, PreparerController } from './rinse.controller';
import { RINSE_DEPENDENCIES, type RinseDependencies } from './rinse.tokens';

/** Pactlab Rinse preparers (T-178b, ADR 0059): prep invites, desktop sign-in and AI rinse jobs. */
@Module({})
export class RinseModule {
  static register(deps: RinseDependencies): DynamicModule {
    return {
      module: RinseModule,
      controllers: [PrepInvitesController, PreparerController],
      providers: [PrepInvitesService, PreparerService, DealAccess, { provide: RINSE_DEPENDENCIES, useValue: deps }],
    };
  }
}
