/**
 * Local walkthrough of the decision loop on seeded data (`pnpm --filter
 * @pactlab/api flow:local`): finding → priced risk → human review →
 * valuation scenario → run → frozen submission → second-person approval.
 *
 * Dev only. Refuses to run unless APP_ENV=local and the database is on
 * localhost. Requests go through the production AppModule (auth guard, RLS,
 * audit); tokens are signed with a throwaway key that exists only in this
 * process, for the seeded synthetic identities. The running API is untouched.
 */
import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient } from '@pactlab/db';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app';
import { JwtIdentityVerifier } from './auth/identity';

const TROUBLED_DEAL = '01900000-0000-7000-8000-0000000d0002';
/** Seeded user ids (packages/db/src/seed/synthetic.ts); subjects may be relinked to real logins. */
const LEAD_USER_ID = '01900000-0000-7000-8000-00000000a002';
const REVIEWER_USER_ID = '01900000-0000-7000-8000-00000000a005';
const ISSUER = 'https://local-flow.pactlab.invalid/';
const AUDIENCE = 'pactlab-local-flow';

type Body = Record<string, unknown>;

function assertLocal(databaseUrl: string | undefined): string {
  if (process.env['APP_ENV'] !== 'local') throw new Error('flow:local runs only with APP_ENV=local');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const host = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('flow:local runs only against a localhost database');
  }
  return databaseUrl;
}

const step = (label: string, detail = '') => process.stdout.write(`\n▸ ${label}${detail ? `\n  ${detail}` : ''}\n`);

const prisma = createPrismaClient({ connectionString: assertLocal(process.env['DATABASE_URL']), maxConnections: 2 });

/**
 * Current subject and organization claim of a seeded user, read as the
 * schema owner (local only), so the walkthrough still works after the seeded
 * lead has been linked to a real Auth0 login.
 */
async function identityOf(userId: string): Promise<{ subject: string; org: string }> {
  const owner = createPrismaClient({
    connectionString: assertLocal(process.env['DATABASE_MIGRATION_URL']),
    maxConnections: 1,
  });
  try {
    const [row] = await owner.$queryRaw<{ subject: string; org: string }[]>`
      SELECT u.auth0_subject AS subject, o.auth0_organization_id AS org
        FROM users u
        JOIN deal_memberships d ON d.user_id = u.id AND d.deal_id = ${TROUBLED_DEAL}::uuid
        JOIN organizations o ON o.id = d.organization_id
       WHERE u.id = ${userId}::uuid`;
    if (!row) throw new Error('Seeded user missing on Project Troubled — run `pnpm seed` first');
    return row;
  } finally {
    await owner.$disconnect();
  }
}
const LEAD = await identityOf(LEAD_USER_ID);
const REVIEWER = await identityOf(REVIEWER_USER_ID);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'local-flow', alg: 'RS256' };
const app: NestFastifyApplication = await createApp({
  prisma,
  logger: createLogger('local-flow', { level: 'silent' }),
  identityVerifier: new JwtIdentityVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: createLocalJWKSet({ keys: [jwk] }),
  }),
});

async function token(who: { subject: string; org: string }) {
  return new SignJWT({ org_id: who.org })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-flow' })
    .setSubject(who.subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function call(who: { subject: string; org: string }, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Body) {
  const response = await app.inject({
    method,
    url: `/v1/deals/${TROUBLED_DEAL}${path}`,
    headers: { authorization: `Bearer ${await token(who)}` },
    ...(payload ? { payload } : {}),
  });
  const body = response.json() as Body;
  if (response.statusCode >= 400) {
    throw new Error(`${method} ${path} → ${response.statusCode} ${JSON.stringify(body)}`);
  }
  return body;
}

interface FindingView {
  id: string;
  domain: string;
  title: string;
  status: string;
  version: number;
  pricedRisk: { currency: string; low: string; high: string } | null;
  evidence: { evidenceItemId: string; commitSha: string; toolName: string; toolVersion: string }[];
}

try {
  step('1. Findings on Project Troubled (seeded by the heuristic scan as DRAFTs)');
  const items = (await call(LEAD, 'GET', '/findings')).items as FindingView[];
  for (const f of items) process.stdout.write(`  · [${f.status}] ${f.domain}: ${f.title}\n`);
  let finding = items.find((f) => f.domain === 'CODE_PROVENANCE');
  if (!finding) throw new Error('No seeded CODE_PROVENANCE finding — run `pnpm seed` first');

  if (finding.status === 'DRAFT') {
    step('2. Lead prices the risk on the draft (humans price; heuristics never do)');
    finding = (await call(LEAD, 'PATCH', `/findings/${finding.id}`, {
      expectedVersion: finding.version,
      pricedRisk: {
        type: 'REMEDIATION_COST',
        currency: 'USD',
        low: '250000',
        high: '750000',
        basis: 'Re-attribute or rewrite code from unmatched identities',
      },
    })) as unknown as FindingView;
    process.stdout.write(`  priced ${finding.pricedRisk?.currency} ${finding.pricedRisk?.low}–${finding.pricedRisk?.high}\n`);

    step('3. Lead submits it for review');
    const submitted = await call(LEAD, 'POST', `/findings/${finding.id}/reviews`, {
      expectedVersion: finding.version,
      decision: 'SUBMITTED',
      rationale: 'Ghost-commit share is material; priced as remediation',
    });
    finding = submitted.finding as FindingView;
  }
  if (finding.status === 'IN_REVIEW') {
    step('4. A different person (the seeded reviewer) accepts it');
    const accepted = await call(REVIEWER, 'POST', `/findings/${finding.id}/reviews`, {
      expectedVersion: finding.version,
      decision: 'ACCEPTED',
      rationale: 'Confirmed against the identity map at the scanned commit',
    });
    finding = accepted.finding as FindingView;
  }
  if (finding.status !== 'ACCEPTED') throw new Error(`Finding is ${finding.status}; expected ACCEPTED`);
  const link = finding.evidence[0];
  step(
    'Accepted finding provenance',
    `commit ${link?.commitSha.slice(0, 12)} · tool ${link?.toolName}@${link?.toolVersion} · evidence ${link?.evidenceItemId}`,
  );

  step('5. Lead creates a valuation scenario linked to the accepted risk (MID point)');
  const created = await call(LEAD, 'POST', '/valuation/scenarios', {
    name: `Local flow ${new Date().toISOString().slice(0, 19)}Z`,
    values: {
      assumptions: { method: 'ARR_MULTIPLE', arr: '4800000.00', multiple: '5.5' },
      bridge: { cash: '1200000', debt: '2000000', debtLikeItems: '300000', workingCapitalAdjustment: '-150000' },
      findingLinks: [{ findingId: finding.id, point: 'MID' }],
    },
  });
  let scenario = created.scenario as { id: string; version: number };

  step('6. Deterministic engine run');
  const ran = await call(LEAD, 'POST', `/valuation/scenarios/${scenario.id}/runs`, { expectedVersion: scenario.version });
  scenario = ran.scenario as typeof scenario;
  const result = (ran.latestRun as { result: { enterpriseValue: { amount: string }; bridge: { equityPurchasePrice: { amount: string }; lines: { kind: string; amount: { amount: string } }[] } } }).result;
  const adjustment = result.bridge.lines.find((line) => line.kind === 'FINDING_ADJUSTMENT');
  process.stdout.write(
    `  EV ${result.enterpriseValue.amount} · finding adjustment ${adjustment?.amount.amount} · equity price ${result.bridge.equityPurchasePrice.amount}\n`,
  );

  step('7. Lead freezes the result as a submission');
  const submitted = await call(LEAD, 'POST', `/valuation/scenarios/${scenario.id}/submissions`, { expectedVersion: scenario.version });
  scenario = submitted.scenario as typeof scenario;
  const submission = (submitted.submissions as { id: string; digest: string }[]).at(-1);
  process.stdout.write(`  submission ${submission?.id} · sha256 ${submission?.digest.slice(0, 16)}…\n`);

  step('8. The reviewer approves (the submitter cannot approve their own)');
  const approved = await call(REVIEWER, 'POST', `/valuation/scenarios/${scenario.id}/submissions/${submission?.id}/decisions`, {
    expectedVersion: scenario.version,
    decision: 'APPROVED',
    rationale: 'Bridge ties to the accepted ghost-commit risk',
  });
  step('Done', `scenario ${scenario.id} is ${(approved.scenario as { status: string }).status}`);
} finally {
  await app.close();
  await prisma.$disconnect();
}
