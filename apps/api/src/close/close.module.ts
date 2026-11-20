import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { PhasesModule } from '../phases/phases.module';
import { CloseController, DocuSignConnectionController, SigningWebhookController } from './close.controller';
import { BoldSignWebhookController, SigningController, SigningSettingsController } from '../signing/signing.controller';
import { SigningService } from '../signing/signing.service';
import { CLOSE_DEPENDENCIES, type CloseDependencies } from './close.dependencies';
import { CloseService } from './close.service';
import { LoiController } from './loi.controller';
import { LoiService } from './loi.service';

/** The two-sided close and e-signature (T-107, ADR 0022), on the signing seam (T-136, ADR 0036). */
@Module({})
export class CloseModule {
  static register(deps: CloseDependencies & { documents: DocumentObjectStore }): DynamicModule {
    return {
      module: CloseModule,
      imports: [PhasesModule],
      controllers: [CloseController, DocuSignConnectionController, SigningWebhookController, LoiController, SigningController, SigningSettingsController, BoldSignWebhookController],
      providers: [SigningService, CloseService, LoiService, DealAccess, { provide: CLOSE_DEPENDENCIES, useValue: deps }, { provide: DOCUMENT_OBJECT_STORE, useValue: deps.documents }],
    };
  }
}
