import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { SaleController } from './sale.controller';
import { SaleService } from './sale.service';

/** Seller-led sale (T-097, ADR 0015). Shares the app's invitations module for bidder invitations. */
@Module({})
export class SaleModule {
  static register(invitations: DynamicModule): DynamicModule {
    return { module: SaleModule, imports: [invitations], controllers: [SaleController], providers: [SaleService, DealAccess] };
  }
}
