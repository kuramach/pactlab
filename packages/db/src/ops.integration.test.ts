import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createPrismaClient, type PrismaClient } from './client';
import { OperatorRequiredError, operatorOps, prismaExecutor } from './ops';
import { createSyntheticTenant, type SyntheticTenant } from './testing/tenants';

/**
 * The operator functions (T-072) against a real PostgreSQL server, called as
 * the runtime login role — the path the API takes. In-memory test databases
 * run as a superuser and would hide a missing grant or role switch.
 */
const runtimeUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];

describe.runIf(runtimeUrl && ownerUrl)('operator functions against PostgreSQL', () => {
  let prisma: PrismaClient;
  let owner: pg.Client;
  let operator: SyntheticTenant;
  let customer: SyntheticTenant;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
    await owner.connect();
    operator = await createSyntheticTenant(owner, `Ops${Date.now()}`);
    customer = await createSyntheticTenant(owner, `Customer${Date.now()}`);
    await owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
    prisma = createPrismaClient({ connectionString: runtimeUrl ?? '' });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await owner?.end();
  });

  it('lets an operator read across organizations, and refuses everyone else', async () => {
    const sql = prismaExecutor(prisma);
    const orgs = await operatorOps.organizations(sql, operator.userId);
    expect(orgs.map((org) => org.id)).toEqual(expect.arrayContaining([operator.organizationId, customer.organizationId]));
    await expect(operatorOps.organizations(sql, customer.userId)).rejects.toBeInstanceOf(OperatorRequiredError);
    // With no actor, only the schema owner's own session may act (the ops CLI); the runtime role may not.
    await expect(operatorOps.pendingOrganizations(sql, null)).rejects.toBeInstanceOf(OperatorRequiredError);
    expect(Array.isArray(await operatorOps.pendingOrganizations(owner, null))).toBe(true);
  });

  it('files, dedups and triages bugs through the runtime role', async () => {
    const sql = prismaExecutor(prisma);
    const input = { organizationId: customer.organizationId, dealId: null, reporterUserId: customer.userId, trigger: 'FRONTEND_EXCEPTION', fingerprint: `fp-${Date.now()}`, title: 'Synthetic crash', whatHappened: null, expected: null, severity: 'MEDIUM', context: { route: '/x' }, screenshot: null, screenshotType: null };
    const first = await operatorOps.fileBug(sql, input);
    const again = await operatorOps.fileBug(sql, input);
    expect(again).toMatchObject({ id: first.id, deduplicated: true });
    expect((await operatorOps.bugs(sql, customer.userId, true)).map((bug) => bug.id)).toContain(first.id);
    await expect(operatorOps.bug(sql, customer.userId, first.id)).rejects.toBeInstanceOf(OperatorRequiredError);
    expect(await operatorOps.triageBug(sql, operator.userId, first.id, { status: 'TRIAGED', severity: 'LOW', internalNotes: null })).toBe(true);
    // The runtime role still cannot read the table directly.
    await expect(prisma.$queryRaw`SELECT count(*) FROM bug_reports`).rejects.toThrow(/permission denied/);
  });
});
