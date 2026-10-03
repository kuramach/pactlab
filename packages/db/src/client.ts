import { PrismaPg } from '@prisma/adapter-pg';
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client';
import { PrismaClient } from './generated/prisma/client';

export interface DatabaseOptions {
  connectionString: string;
  /** Pool size; keep small per process and rely on RDS Proxy in deployed envs. */
  maxConnections?: number;
}

export function createPrismaClient(options: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    // All timestamps are UTC; a non-UTC session timezone skews timestamptz reads.
    options: '-c TimeZone=UTC',
  });
  return new PrismaClient({ adapter });
}

/** For test harnesses that supply their own driver adapter (e.g. in-process PGlite). */
export function createPrismaClientWithAdapter(adapter: SqlDriverAdapterFactory): PrismaClient {
  return new PrismaClient({ adapter });
}

export { PrismaClient };
export type { Prisma } from './generated/prisma/client';
export type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
