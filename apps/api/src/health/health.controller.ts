import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@pactlab/contracts';
import { Public } from '../auth/auth.guard';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health(): HealthResponse {
    return { status: 'ok', service: 'api', version: process.env['npm_package_version'] ?? '0.0.0' };
  }
}
