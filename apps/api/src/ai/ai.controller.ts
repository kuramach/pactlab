import { Controller, Get, Inject } from '@nestjs/common';
import type { AiStatusView } from './ai-provider';

export const AI_STATUS = Symbol('AI_STATUS');

/** Whether document AI is on, and which models it uses. Signed-in users only; no secrets. */
@Controller('v1/ai')
export class AiController {
  constructor(@Inject(AI_STATUS) private readonly status: AiStatusView) {}

  @Get('status')
  get(): AiStatusView {
    return this.status;
  }
}
