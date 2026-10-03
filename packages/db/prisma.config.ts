import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Migrations run as the schema-owner role (DATABASE_MIGRATION_URL), never the
// runtime role. `prisma generate` needs no database, so the URL is optional here.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_MIGRATION_URL'] ?? '' },
});
