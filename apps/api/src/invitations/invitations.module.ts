import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { DealInvitationsController, InvitationLinkController } from './invitations.controller';
import { INVITATIONS, InvitationsService, type InvitationDependencies } from './invitations.service';

/** Pact invitations and guests (T-094 B12, ADR 0014). */
@Module({})
export class InvitationsModule {
  static register(deps: InvitationDependencies): DynamicModule {
    return {
      module: InvitationsModule,
      controllers: [DealInvitationsController, InvitationLinkController],
      providers: [InvitationsService, DealAccess, { provide: INVITATIONS, useValue: deps }],
      exports: [InvitationsService],
    };
  }
}
