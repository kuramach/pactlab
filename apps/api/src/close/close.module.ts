import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { PhasesModule } from '../phases/phases.module';
import { CloseController, DocuSignConnectionController, SigningWebhookController } from './close.controller';
import { CLOSE_DEPENDENCIES, CloseService, type CloseDependencies } from './close.service';

/** The two-sided close and e-signature (T-107, ADR 0022). */
@Module({})
export class CloseModule {
  static register(deps: CloseDependencies & { documents: DocumentObjectStore }): DynamicModule {
    return {
      module: CloseModule,
      imports: [PhasesModule],
      controllers: [CloseController, DocuSignConnectionController, SigningWebhookController],
      providers: [CloseService, DealAccess, { provide: CLOSE_DEPENDENCIES, useValue: deps }, { provide: DOCUMENT_OBJECT_STORE, useValue: deps.documents }],
    };
  }
}
