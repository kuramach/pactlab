/**
 * Idempotent local seed (`pnpm seed`): two synthetic buyer tenants plus the
 * HealthyCo / TroubledCo / SparseCo targets, ingested through the real sync
 * engine. Identities run as the schema owner; evidence runs under RLS.
 */
import pg from 'pg';
import { createPrismaClient } from '../client';
import { seedSynthetic } from './synthetic';

const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  process.stderr.write('DATABASE_MIGRATION_URL is required for seeding\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, options: '-c TimeZone=UTC' });
const prisma = createPrismaClient({ connectionString: url, maxConnections: 2 });
await client.connect();
try {
  const report = await seedSynthetic(client, prisma);
  process.stdout.write(`Seeded ${report.tenants} synthetic tenants\n`);
  for (const { company, dealId, sync } of report.companies) {
    process.stdout.write(
      `${company}: deal ${dealId} · sync ${sync.replayed ? 'already complete' : 'ran'} · ` +
        `${sync.recordsSeen} records (${sync.recordsCreated} new) · ${sync.issuesCount} source issues\n`,
    );
  }
  const { codeReview } = report;
  process.stdout.write(
    `TroubledCo code review: repository evidence ${codeReview.sync.replayed ? 'already synced' : 'synced'} · ` +
      `${codeReview.findingsCreated} draft findings created, ${codeReview.findingsExisting} already present\n`,
  );
} finally {
  await client.end();
  await prisma.$disconnect();
}
