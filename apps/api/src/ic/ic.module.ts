import { Module, type DynamicModule } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { IcController, OrganizationIcController } from './ic.controller';
import { IcService } from './ic.service';

/** The investment committee (T-118). Given the app's Reports module, so IC packs are reports. */
@Module({})
export class IcModule {
  static register(deps: { reports: DynamicModule }): DynamicModule {
    return {
      module: IcModule,
      imports: [deps.reports],
      controllers: [IcController, OrganizationIcController],
      providers: [IcService, DealAccess],
    };
  }
}
