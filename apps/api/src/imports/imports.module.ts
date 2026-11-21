import { Module, type DynamicModule } from '@nestjs/common';
import type { ClaudeGateway } from '@pactlab/ai';
import { CLAUDE_GATEWAY, DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from '../documents/documents.repository';
import { DealAccess } from '../deals/deal-access';
import type { MalwareScanner } from '../documents/upload-policy';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { IMPORT_QUEUE, UPLOAD_MALWARE_SCANNER, UPLOAD_OBJECT_STORE, type ImportQueue, type UploadObjectStore } from './upload-store';

export interface ImportsModuleDependencies {
  readonly objectStore: UploadObjectStore;
  readonly malwareScanner: MalwareScanner;
  /** Background imports for large files; absent, every import runs inline. */
  readonly importQueue?: ImportQueue | null;
  /** The mapping assistant (`import.map@1`); without it, columns are matched by name only. */
  readonly gateway?: ClaudeGateway | null;
  /** Filed documents' originals, for importing a spreadsheet already in the pact's documents. */
  readonly documentStore?: DocumentObjectStore | null;
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
        { provide: IMPORT_QUEUE, useValue: deps.importQueue ?? null },
        { provide: CLAUDE_GATEWAY, useValue: deps.gateway ?? null },
        { provide: DOCUMENT_OBJECT_STORE, useValue: deps.documentStore ?? null },
      ],
    };
  }
}
