import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { SourceHealthService } from './source-health.service';

/** Admin → Health: whether live can reach the public data it uses (T-137 follow-up). Operators only. */
@Controller('v1/admin/source-status')
export class SourceHealthController {
  constructor(@Inject(SourceHealthService) private readonly sources: SourceHealthService) {}

  @Get()
  list(@Tenant() tenant: TenantContext) {
    return this.sources.list(tenant);
  }

  @Post('check')
  @HttpCode(200)
  check(@Tenant() tenant: TenantContext) {
    return this.sources.checkNow(tenant);
  }
}
