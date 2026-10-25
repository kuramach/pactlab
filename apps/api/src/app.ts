import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_UPLOAD_BYTES } from '@pactlab/contracts';
import { AppModule, type AppDependencies } from './app.module';
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
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(deps), adapter, { logger: false });
  app.useGlobalFilters(new ProblemDetailsFilter(deps.logger));
  if (options.webOrigin) app.enableCors({ origin: options.webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
