import { Module } from '@nestjs/common';
import { FeatureCardsController } from './feature-cards.controller';
import { FeatureCardsService } from './feature-cards.service';

/** Feature cards on the home (T-155). */
@Module({ controllers: [FeatureCardsController], providers: [FeatureCardsService] })
export class FeatureCardsModule {}
