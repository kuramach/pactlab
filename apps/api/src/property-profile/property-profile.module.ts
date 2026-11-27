import { Module, type DynamicModule } from '@nestjs/common';
import type { PropertyPhotoProvider, PropertyRecordProvider } from '@pactlab/connectors';
import { DealAccess } from '../deals/deal-access';
import { PropertyProfileController } from './property-profile.controller';
import { PROPERTY_PHOTO_PROVIDER, PROPERTY_RECORD_PROVIDER, PropertyProfileService } from './property-profile.service';

/** The multifamily property profile (T-188): RentCast records and Google photos live; fixtures outside production; null turns a source off. */
@Module({})
export class PropertyProfileModule {
  static register(providers: { record: PropertyRecordProvider | null; photos: PropertyPhotoProvider | null }): DynamicModule {
    return {
      module: PropertyProfileModule,
      controllers: [PropertyProfileController],
      providers: [
        PropertyProfileService,
        DealAccess,
        { provide: PROPERTY_RECORD_PROVIDER, useValue: providers.record },
        { provide: PROPERTY_PHOTO_PROVIDER, useValue: providers.photos },
      ],
    };
  }
}
