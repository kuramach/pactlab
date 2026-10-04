import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { FindingsController } from './findings.controller';
import { FINDINGS_REPOSITORY, type FindingsRepository } from './findings.repository';
import { FindingsService } from './findings.service';

/**
 * Findings and reviews as deal sub-resources. The repository is supplied by
 * the caller: the RLS-backed implementation needs the findings tables, which
 * are a separate schema task.
 */
@Module({})
export class FindingsModule {
  static register(repository: FindingsRepository): DynamicModule {
    return {
      module: FindingsModule,
      controllers: [FindingsController],
      providers: [
        FindingsService,
        DealAccess,
        { provide: FINDINGS_REPOSITORY, useValue: repository },
      ],
      exports: [FindingsService],
    };
  }
}
