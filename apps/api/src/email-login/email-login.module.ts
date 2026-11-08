import { Module, type DynamicModule } from '@nestjs/common';
import { EmailLoginController } from './email-login.controller';
import { EMAIL_LOGIN, EmailLoginService, type EmailLoginDependencies } from './email-login.service';
import { PasskeysController } from './passkeys.controller';
import { PasskeysService } from './passkeys.service';

@Module({})
export class EmailLoginModule {
  static register(deps: EmailLoginDependencies): DynamicModule {
    return {
      module: EmailLoginModule,
      controllers: [EmailLoginController, PasskeysController],
      providers: [EmailLoginService, PasskeysService, { provide: EMAIL_LOGIN, useValue: deps }],
    };
  }
}
