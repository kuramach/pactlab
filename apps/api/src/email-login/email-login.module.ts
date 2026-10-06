import { Module, type DynamicModule } from '@nestjs/common';
import { EmailLoginController } from './email-login.controller';
import { EMAIL_LOGIN, EmailLoginService, type EmailLoginDependencies } from './email-login.service';

@Module({})
export class EmailLoginModule {
  static register(deps: EmailLoginDependencies): DynamicModule {
    return {
      module: EmailLoginModule,
      controllers: [EmailLoginController],
      providers: [EmailLoginService, { provide: EMAIL_LOGIN, useValue: deps }],
    };
  }
}
