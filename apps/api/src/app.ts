import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule, type AppDependencies } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';

export async function createApp(deps: AppDependencies, options: { webOrigin?: string } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // Request IDs are server-generated; client-supplied values are not trusted.
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    logger: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(deps), adapter, { logger: false });
  app.useGlobalFilters(new ProblemDetailsFilter(deps.logger));
  if (options.webOrigin) app.enableCors({ origin: options.webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
