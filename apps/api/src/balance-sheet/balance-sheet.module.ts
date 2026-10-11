import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { BalanceSheetController } from './balance-sheet.controller';
import { BalanceSheetService } from './balance-sheet.service';

@Module({
  controllers: [BalanceSheetController],
  providers: [BalanceSheetService, DealAccess],
  exports: [BalanceSheetService],
})
export class BalanceSheetModule {}
