import { Body, Controller, ForbiddenException, HttpCode, Inject, Post } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { EmailEventsService } from './email-events.service';

/** SNS delivers SES events here (T-109). Public: the SNS signature is the authentication. */
@Controller('v1/email-events')
export class EmailEventsController {
  constructor(@Inject(EmailEventsService) private readonly service: EmailEventsService) {}

  @Public()
  @Post('sns')
  @HttpCode(200)
  async sns(@Body() body: Buffer | undefined): Promise<{ ok: true }> {
    if (!Buffer.isBuffer(body) || !(await this.service.receive(body.toString('utf8')))) throw new ForbiddenException();
    return { ok: true };
  }
}
