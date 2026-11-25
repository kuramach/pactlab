import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * A migrated-but-empty database, snapshotted once and restored by every
 * later startTestDatabase instead of replaying every migration. Replaying
 * the full migration set into a WASM Postgres takes ~15s uncontended and
 * far longer when ~90 test files do it in parallel on a shared CI runner —
 * that contention, not any single test, is what kept timing out setup
 * hooks (demo-org, mcp) as the migration count grew. The snapshot holds
 * schema only (it is taken before any test data exists), so per-test
 * isolation is unchanged. It is keyed by a hash of the migration files,
 * so it invalidates itself the moment a migration changes, and restoring
 * takes ~1s. Set PACTLAB_TEST_DB_NO_CACHE=1 to bypass it and always
 * replay — the debugging path, and what a corrupt snapshot falls back to.
 */
const TEMPLATE_DIR = join(tmpdir(), 'pactlab-test-db-templates');

function migrationsHash(): string {
  const hash = createHash('sha256');
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of entries) {
    hash.update(name);
    hash.update(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql')));
  }
  return hash.digest('hex').slice(0, 16);
}

async function createMigratedOwner(): Promise<PGlite> {
  const owner = await PGlite.create();
  // All timestamps are UTC (matches the production pool's session setting).
  await owner.exec(`SET TIME ZONE 'UTC'`);
  await applyMigrations(owner);
  return owner;
}

async function createOwner(): Promise<PGlite> {
  if (process.env['PACTLAB_TEST_DB_NO_CACHE']) return createMigratedOwner();
  const template = join(TEMPLATE_DIR, `${migrationsHash()}.tar.gz`);
  if (existsSync(template)) {
    try {
      const owner = await PGlite.create({
        loadDataDir: new Blob([readFileSync(template)], { type: 'application/gzip' }),
      });
      await owner.exec(`SET TIME ZONE 'UTC'`);
      return owner;
    } catch {
      // A corrupt or incompatible snapshot must never fail a test run:
      // drop it and fall through to a full replay, which re-creates it.
      rmSync(template, { force: true });
    }
  }
  const owner = await createMigratedOwner();
  try {
    mkdirSync(TEMPLATE_DIR, { recursive: true });
    const dump = await owner.dumpDataDir('gzip');
    // Publish atomically: concurrent workers may build at the same time,
    // and a reader must only ever see a complete snapshot.
    const partial = `${template}.${process.pid}.tmp`;
    writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
    renameSync(partial, template);
  } catch {
    // Caching is best-effort; the database itself is already built.
  }
  return owner;
}

/**
 * Hermetic in-process PostgreSQL (PGlite) with every production migration and
 * RLS policy applied. The session is a superuser; `withTenant` drops to
 * `pactlab_app` per transaction, so RLS applies exactly as in production.
 * `pnpm test:integration` repeats the proof against a real PostgreSQL server
 * through the production `pg` driver adapter.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const owner = await createOwner();
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
