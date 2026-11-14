import { Module, type DynamicModule } from '@nestjs/common';
import type { WebFetcher } from '../common/safe-fetch';
import type { DocumentObjectStore } from '../documents/documents.repository';
import { BrandController, PublicBrandController } from './brand.controller';
import { BRAND_FETCHER, BRAND_STORE, BrandService } from './brand.service';

/** Organization brand kits (T-123, ADR 0031). */
@Module({})
export class BrandModule {
  static register(deps: { store: DocumentObjectStore; fetcher: WebFetcher }): DynamicModule {
    return {
      module: BrandModule,
      controllers: [BrandController, PublicBrandController],
      providers: [BrandService, { provide: BRAND_STORE, useValue: deps.store }, { provide: BRAND_FETCHER, useValue: deps.fetcher }],
      exports: [BrandService],
    };
  }
}
