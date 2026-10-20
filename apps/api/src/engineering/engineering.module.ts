import { Module } from '@nestjs/common';
import { DealAccess } from '../deals/deal-access';
import { EngineeringController } from './engineering.controller';
import { EngineeringService } from './engineering.service';

@Module({ controllers: [EngineeringController], providers: [EngineeringService, DealAccess] })
export class EngineeringModule {}
