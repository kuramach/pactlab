import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Server-generated request id, recorded on audit events. */
export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext): string =>
  String(context.switchToHttp().getRequest<FastifyRequest>().id),
);
