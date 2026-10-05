import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';
import { AllowUnscoped, type Principal } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/principal.decorator';
import type { MeResponse } from './me.schemas';
import { MeService } from './me.service';

@Controller('v1/me')
export class MeController {
  constructor(@Inject(MeService) private readonly meService: MeService) {}

  /** The caller and their organizations. Accepts tokens issued before an organization is picked. */
  @AllowUnscoped()
  @Get()
  async get(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    const me = await this.meService.resolve(principal.subject);
    if (!me) throw new UnauthorizedException();
    return me;
  }
}
