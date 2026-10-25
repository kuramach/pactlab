import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FindingsController } from './findings.controller';
import { FINDINGS_REPOSITORY, type FindingsRepository } from './findings.repository';
import { FindingsService } from './findings.service';
import { DEFAULT_PACK_REGISTRY, PACK_REGISTRY, type PackRegistry } from './pack-rules';

/**
 * Findings and reviews as deal sub-resources. The repository is supplied by
 * the caller: `AppModule` mounts the RLS-backed `PrismaFindingsRepository`.
 */
@Module({})
export class FindingsModule {
  static register(repository: FindingsRepository, packs: PackRegistry = DEFAULT_PACK_REGISTRY): DynamicModule {
    return {
      module: FindingsModule,
      // Global: accepting a document-review finding brings it into the register (DocumentsService).
      global: true,
      controllers: [FindingsController],
      providers: [
        FindingsService,
        DealAccess,
        { provide: FINDINGS_REPOSITORY, useValue: repository },
        { provide: PACK_REGISTRY, useValue: packs },
      ],
      exports: [FindingsService],
    };
  }
}
