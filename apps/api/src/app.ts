import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_UPLOAD_BYTES } from '@pactlab/contracts';
import { AppModule, type AppDependencies } from './app.module';
import { HttpException } from '@nestjs/common';
import { AdminService } from './admin/admin.service';
import type { AuthenticatedRequest } from './auth/auth.guard';
import { ProblemDetailsFilter } from './common/problem-details.filter';

export async function createApp(deps: AppDependencies, options: { webOrigin?: string } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // Request IDs are server-generated; client-supplied values are not trusted.
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    logger: false,
  });
  // Import uploads (CSV, TSV or Excel) arrive as the raw file with their own, larger limit; every other body stays at 1 MB.
  adapter
    .getInstance()
    .addContentTypeParser(
      ['text/csv', 'text/tab-separated-values', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
    );
  // Document uploads (PDF and Word up to 10 MB, sent as base64 JSON) get a larger limit on that route only.
  adapter.getInstance().addHook('onRoute', (route) => {
    if (route.method === 'POST' && /^\/v1\/deals\/:dealId\/documents\/?$/.test(route.url)) route.bodyLimit = 15 * 1_048_576;
    // Bug reports may carry a masked screenshot of the app view (≤ 1 MB, base64 in JSON).
    if (route.method === 'POST' && route.url === '/v1/bug-reports') route.bodyLimit = 2 * 1_048_576;
    // A spoken Foresight question: about a minute of 16 kHz PCM, base64 in JSON.
    if (route.method === 'POST' && route.url === '/v1/deals/:dealId/foresight/voice-questions') route.bodyLimit = 4 * 1_048_576;
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(deps), adapter, { logger: false });
  // Unexpected server errors (5xx) become deduplicated bug reports (T-072). Expected
  // unavailability (a dependency down, 503 with a code) is reported only once it is logged.
  const bugs = app.get(AdminService, { strict: false });
  app.useGlobalFilters(
    new ProblemDetailsFilter(deps.logger, ({ request, exception }) => {
      const tenant = (request as AuthenticatedRequest).tenant;
      if (!tenant || (exception instanceof HttpException && exception.getStatus() === 503)) return;
      void bugs.fileServerError({
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        route: `${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0] ?? ''}`,
        errorName: exception instanceof Error ? exception.name : 'Unknown',
        stack: exception instanceof Error ? (exception.stack ?? null) : null,
        requestId: String(request.id),
      });
    }),
  );
  if (options.webOrigin) app.enableCors({ origin: options.webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
