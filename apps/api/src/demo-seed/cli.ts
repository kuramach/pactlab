/**
 * `pnpm seed` (after the database seed): synthetic decision-loop data for the
 * app — findings at every review stage, valuation scenarios and contracts
 * with cited AI drafts — created through the real services. Local only.
 * Model responses are scripted and recorded as `synthetic-fixture`.
 */
import 'reflect-metadata';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { createPrismaClient } from '@pactlab/db';
import pg from 'pg';
import { createLogger } from '@pactlab/observability';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { DEMO_HOLDERS, demoModelResponse, seedDemo } from './seed';

const config = loadConfig(apiEnvSchema);
if (config.APP_ENV !== 'local' || !config.DOCUMENT_STORE_DIR) {
  process.stderr.write('The demo seed runs only locally (APP_ENV=local) with DOCUMENT_STORE_DIR set.\n');
  process.exit(1);
}

const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
const app = await createApp({
  prisma,
  identityVerifier: new DisabledIdentityVerifier(),
  logger: createLogger('demo-seed', { level: 'warn' }),
  documents: {
    objectStore: new FileSystemObjectStore(config.DOCUMENT_STORE_DIR),
    malwareScanner: new SignatureMalwareScanner(),
    gateway: new TransportClaudeGateway({
      transport: new ScriptedModelTransport(demoModelResponse),
      registry: defaultPromptRegistry(),
      routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic },
    }),
  },
});
// Locally the synthetic identities may be linked to real sign-in accounts
// (an Auth0 organization and user); read the current links as the schema owner.
const links: { externalOrganizationIds: Record<string, string>; subjects: Record<string, string> } = {
  externalOrganizationIds: {},
  subjects: {},
};
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];
if (ownerUrl) {
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const organizations = await owner.query<{ id: string; auth0_organization_id: string }>(
      `SELECT id, auth0_organization_id FROM organizations WHERE auth0_organization_id IS NOT NULL AND id = ANY($1::uuid[])`,
      [DEMO_HOLDERS.map((holder) => holder.organizationId)],
    );
    for (const row of organizations.rows) links.externalOrganizationIds[row.id] = row.auth0_organization_id;
    const users = await owner.query<{ id: string; auth0_subject: string }>(
      `SELECT id, auth0_subject FROM users WHERE id = ANY($1::uuid[])`,
      [DEMO_HOLDERS.flatMap((holder) => [holder.lead.userId, holder.reviewer.userId])],
    );
    for (const row of users.rows) links.subjects[row.id] = row.auth0_subject;
  } finally {
    await owner.end();
  }
}
try {
  for (const line of await seedDemo(app, prisma, links)) process.stdout.write(`${line}\n`);
} finally {
  await app.close();
  await prisma.$disconnect();
}
