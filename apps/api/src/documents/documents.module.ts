import { Module, type DynamicModule } from '@nestjs/common';
import type { ClaudeGateway } from '@pactlab/ai';
import { DealAccess } from '../deals/deal-access';
import { DocumentsController } from './documents.controller';
import {
  CLAUDE_GATEWAY,
  CONTEXT_BUDGET_CHARS,
  DOCUMENT_OBJECT_STORE,
  DOCUMENTS_REPOSITORY,
  MALWARE_SCANNER,
  type DocumentObjectStore,
  type DocumentsRepository,
} from './documents.repository';
import { DocumentConnectionsController } from './document-connections.controller';
import { DocumentConnectionsService } from './document-connections.service';
import { DocumentSourcesService } from './document-sources.service';
import { contextBudgetChars, DocumentsService } from './documents.service';
import { RinseProvenanceService } from './rinse-provenance.service';
import { VisionPass } from './vision-pass';
import type { MalwareScanner } from './upload-policy';

export interface DocumentsModuleDependencies {
  readonly repository: DocumentsRepository;
  readonly objectStore: DocumentObjectStore;
  readonly malwareScanner: MalwareScanner;
  readonly gateway: ClaudeGateway;
  /** Pact-wide jobs read every page up to this many characters, then retrieve (T-139); default from AI_CONTEXT_BUDGET_CHARS. */
  readonly contextBudgetChars?: number;
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
      controllers: [DocumentsController, DocumentConnectionsController],
      providers: [
        DocumentsService,
        DocumentSourcesService,
        RinseProvenanceService,
        DocumentConnectionsService,
        VisionPass,
        DealAccess,
        { provide: DOCUMENTS_REPOSITORY, useValue: deps.repository },
        { provide: DOCUMENT_OBJECT_STORE, useValue: deps.objectStore },
        { provide: MALWARE_SCANNER, useValue: deps.malwareScanner },
        { provide: CLAUDE_GATEWAY, useValue: deps.gateway },
        { provide: CONTEXT_BUDGET_CHARS, useValue: deps.contextBudgetChars ?? contextBudgetChars(process.env) },
      ],
      exports: [DocumentsService],
    };
  }
}
