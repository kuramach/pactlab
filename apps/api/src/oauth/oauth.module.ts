import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { OpenApiController } from '../openapi/openapi.controller';
import { OAuthController } from './oauth.controller';
import { OAUTH, OAuthService, type OAuthDependencies } from './oauth.service';

@Module({})
export class OAuthModule {
  static register(deps: OAuthDependencies): DynamicModule {
    return {
      module: OAuthModule,
      imports: [DiscoveryModule],
      controllers: [OAuthController, OpenApiController],
      providers: [OAuthService, { provide: OAUTH, useValue: deps }],
      exports: [OAuthService, OAUTH],
    };
  }
}
