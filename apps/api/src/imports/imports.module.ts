import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import type { MalwareScanner } from '../documents/upload-policy';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { UPLOAD_MALWARE_SCANNER, UPLOAD_OBJECT_STORE, type UploadObjectStore } from './upload-store';

export interface ImportsModuleDependencies {
  readonly objectStore: UploadObjectStore;
  readonly malwareScanner: MalwareScanner;
}

/** Billing CSV import. Adapters are supplied by `AppModule`, failing closed by default. */
@Module({})
export class ImportsModule {
  static register(deps: ImportsModuleDependencies): DynamicModule {
    return {
      module: ImportsModule,
      controllers: [ImportsController],
      providers: [
        ImportsService,
        DealAccess,
        { provide: UPLOAD_OBJECT_STORE, useValue: deps.objectStore },
        { provide: UPLOAD_MALWARE_SCANNER, useValue: deps.malwareScanner },
      ],
    };
  }
}
