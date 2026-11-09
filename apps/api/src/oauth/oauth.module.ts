import { Module, type DynamicModule } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAUTH, OAuthService, type OAuthDependencies } from './oauth.service';

@Module({})
export class OAuthModule {
  static register(deps: OAuthDependencies): DynamicModule {
    return {
      module: OAuthModule,
      controllers: [OAuthController],
      providers: [OAuthService, { provide: OAUTH, useValue: deps }],
      exports: [OAuthService, OAUTH],
    };
  }
}
