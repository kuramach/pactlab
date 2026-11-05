import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@pactlab/contracts';
import { Public } from '../auth/auth.guard';
import { ReleaseInfo } from './release-info';

@Controller('health')
export class HealthController {
  constructor(@Inject(ReleaseInfo) private readonly release: ReleaseInfo) {}

  /** Up, and which release it runs (T-100): the tag, or null when untagged, and the commit. */
  @Public()
  @Get()
  async health(): Promise<HealthResponse> {
    const { version, sha } = await this.release.get();
    return { status: 'ok', service: 'api', version, sha };
  }
}
