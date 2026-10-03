import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createPrismaClientWithAdapter, type PrismaClient } from '../client';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

export interface TestDatabase {
  /** Prisma client bound to the in-process database. */
  prisma: PrismaClient;
  /** Superuser session for fixtures and privilege assertions. */
  owner: PGlite;
  stop(): Promise<void>;
}

export async function applyMigrations(db: PGlite): Promise<void> {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, migration, 'migration.sql'), 'utf8'));
  }
}

/**
 * Hermetic in-process PostgreSQL (PGlite) with every production migration and
 * RLS policy applied. The session is a superuser; `withTenant` drops to
 * `pactlab_app` per transaction, so RLS applies exactly as in production.
 * `pnpm test:integration` repeats the proof against a real PostgreSQL server
 * through the production `pg` driver adapter.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const owner = await PGlite.create();
  // All timestamps are UTC (matches the production pool's session setting).
  await owner.exec(`SET TIME ZONE 'UTC'`);
  await applyMigrations(owner);
  const prisma = createPrismaClientWithAdapter(new PrismaPGlite(owner));
  return {
    prisma,
    owner,
    async stop() {
      await prisma.$disconnect();
      await owner.close();
    },
  };
}
