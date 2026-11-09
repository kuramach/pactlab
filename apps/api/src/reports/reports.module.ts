import { Module, type DynamicModule } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { DealsModule } from '../deals/deals.module';
import type { DocumentObjectStore } from '../documents/documents.repository';
import { ReportsController } from './reports.controller';
import { REPORT_STORE, ReportsService } from './reports.service';

/** Reports (T-110). Given the app's own module instances, so reports read what the app shows. */
@Module({})
export class ReportsModule {
  static register(deps: { store: DocumentObjectStore; shared: DynamicModule[] }): DynamicModule {
    return {
      module: ReportsModule,
      imports: [DealsModule, ConnectionsModule, ...deps.shared],
      controllers: [ReportsController],
      providers: [ReportsService, { provide: REPORT_STORE, useValue: deps.store }],
      exports: [ReportsService],
    };
  }
}
