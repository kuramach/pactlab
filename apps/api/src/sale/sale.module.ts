import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { ListingsController, PublicListingsController } from '../listings/listings.controller';
import { LISTINGS, ListingsService, type ListingDependencies } from '../listings/listings.service';
import { SaleController } from './sale.controller';
import { SALE_FILES, SaleService, type SaleFileDependencies } from './sale.service';

/**
 * Seller-led sale (T-097, ADR 0015), with its public page (listing) whose approved requests
 * become bidders. Shares the app's invitations module for bidder invitations.
 */
@Module({})
export class SaleModule {
  static register(invitations: DynamicModule, files: SaleFileDependencies, listings: ListingDependencies): DynamicModule {
    return {
      module: SaleModule,
      imports: [invitations],
      controllers: [SaleController, ListingsController, PublicListingsController],
      providers: [SaleService, ListingsService, DealAccess, { provide: SALE_FILES, useValue: files }, { provide: LISTINGS, useValue: listings }],
    };
  }
}
