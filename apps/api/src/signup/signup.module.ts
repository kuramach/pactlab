import { Module, type DynamicModule } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SIGNUP, SignupService, type SignupDependencies } from './signup.service';

@Module({})
export class SignupModule {
  static register(deps: SignupDependencies): DynamicModule {
    return {
      module: SignupModule,
      controllers: [SignupController],
      providers: [SignupService, { provide: SIGNUP, useValue: deps }],
    };
  }
}
