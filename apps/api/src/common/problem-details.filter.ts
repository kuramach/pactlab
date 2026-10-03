import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ProblemDetails } from '@pactlab/contracts';
import type { Logger } from '@pactlab/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

const CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

/** RFC 9457 problem details with stable codes; internals never leak to clients. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) {
      this.logger.error({ requestId: request.id, errorName: exception instanceof Error ? exception.name : 'unknown' }, 'request failed');
    }
    const body: ProblemDetails = {
      type: 'about:blank',
      title: status >= 500 ? 'Internal Server Error' : (HttpStatus[status] ?? 'Error').replaceAll('_', ' '),
      status,
      code: CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR'),
      requestId: request.id,
    };
    void reply.status(status).header('content-type', 'application/problem+json').send(body);
  }
}
