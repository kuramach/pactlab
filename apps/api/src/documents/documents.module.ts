import { Module, type DynamicModule } from '@nestjs/common';
import type { ClaudeGateway } from '@pactlab/ai';
import { DealAccess } from '../deals/deal-access';
import { DocumentsController } from './documents.controller';
import {
  CLAUDE_GATEWAY,
  DOCUMENT_OBJECT_STORE,
  DOCUMENTS_REPOSITORY,
  MALWARE_SCANNER,
  type DocumentObjectStore,
  type DocumentsRepository,
} from './documents.repository';
import { DocumentsService } from './documents.service';
import type { MalwareScanner } from './upload-policy';

export interface DocumentsModuleDependencies {
  readonly repository: DocumentsRepository;
  readonly objectStore: DocumentObjectStore;
  readonly malwareScanner: MalwareScanner;
  readonly gateway: ClaudeGateway;
}

/**
 * Documents, cited Q&A and document findings as deal sub-resources. The
 * caller supplies the adapters: `AppModule` mounts the RLS-backed
 * `PrismaDocumentsRepository` with fail-closed defaults for the rest.
 */
@Module({})
export class DocumentsModule {
  static register(deps: DocumentsModuleDependencies): DynamicModule {
    return {
      module: DocumentsModule,
      controllers: [DocumentsController],
      providers: [
        DocumentsService,
        DealAccess,
        { provide: DOCUMENTS_REPOSITORY, useValue: deps.repository },
        { provide: DOCUMENT_OBJECT_STORE, useValue: deps.objectStore },
        { provide: MALWARE_SCANNER, useValue: deps.malwareScanner },
        { provide: CLAUDE_GATEWAY, useValue: deps.gateway },
      ],
      exports: [DocumentsService],
    };
  }
}
