import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId } from '@pactlab/domain';
import { appendAuditEvent, verifyAuditChain } from './audit';
import { createPrismaClient, type PrismaClient } from './client';
import { deals } from './repositories';
import { assertRuntimeRoleIsolation, resolvePrincipal, withTenant } from './tenant';
import { createSyntheticTenant, type SyntheticTenant } from './testing/tenants';

/**
 * Repeats the core isolation proof against a real PostgreSQL server through
 * the production `pg` driver adapter, connecting as the runtime login role.
 * Requires migrations applied (`pnpm db:migrate`).
 */
const runtimeUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];

describe.runIf(runtimeUrl && ownerUrl)('RLS against PostgreSQL', () => {
  let prisma: PrismaClient;
  let owner: pg.Client;
  let a: SyntheticTenant;
  let b: SyntheticTenant;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
    await owner.connect();
    a = await createSyntheticTenant(owner, `Alpha${Date.now()}`);
    b = await createSyntheticTenant(owner, `Bravo${Date.now()}`);
    prisma = createPrismaClient({ connectionString: runtimeUrl ?? '' });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await owner?.end();
  });

  it('runtime login role is not a superuser and cannot bypass RLS', async () => {
    await assertRuntimeRoleIsolation(prisma);
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('runtime login role has no table privileges outside a tenant transaction', async () => {
    await expect(prisma.$queryRaw`SELECT count(*) FROM deals`).rejects.toThrow(/permission denied/);
  });

  it('resolves principals only within their own organization', async () => {
    await expect(
      resolvePrincipal(prisma, { subject: a.subject, externalOrganizationId: a.auth0OrganizationId }),
    ).resolves.toEqual(a.context);
    await expect(
      resolvePrincipal(prisma, { subject: a.subject, externalOrganizationId: b.auth0OrganizationId }),
    ).resolves.toBeNull();
  });

  it('allows own deals and denies the other tenant by list, id and search', async () => {
    const result = await withTenant(prisma, a.context, async (tx) => ({
      list: await deals.list(tx),
      other: await deals.get(tx, b.dealId),
      search: await deals.search(tx, b.dealName),
    }));
    expect(result.list.map((deal) => deal.organizationId)).toEqual([a.organizationId]);
    expect(result.other).toBeNull();
    expect(result.search).toEqual([]);
  });

  it("denies writes into another tenant's deal and files", async () => {
    await expect(
      withTenant(prisma, a.context, (tx) =>
        tx.jobRun.create({
          data: {
            organizationId: b.organizationId,
            dealId: b.dealId,
            type: 'system.noop',
            schemaVersion: 1,
            idempotencyKey: newId(),
            requestedBy: a.userId,
            correlationId: 'it',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(withTenant(prisma, a.context, (tx) => tx.storedFile.findUnique({ where: { id: b.fileId } }))).resolves.toBeNull();
  });

  it('keeps the audit trail append-only and hash-chained', async () => {
    await withTenant(prisma, a.context, async (tx) => {
      await appendAuditEvent(tx, { organizationId: a.organizationId, dealId: a.dealId, action: 'deal.read', targetType: 'deal', outcome: 'ALLOWED' });
      await appendAuditEvent(tx, { organizationId: a.organizationId, dealId: a.dealId, action: 'deal.read', targetType: 'deal', outcome: 'ALLOWED' });
    });
    const chain = await withTenant(prisma, a.context, (tx) =>
      tx.auditEvent.findMany({ where: { dealId: a.dealId }, orderBy: { chainSeq: 'asc' } }),
    );
    expect(verifyAuditChain(chain)).toEqual({ valid: true });
    await expect(withTenant(prisma, a.context, (tx) => tx.auditEvent.deleteMany())).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(prisma, a.context, (tx) => tx.auditEvent.updateMany({ data: { action: 'x' } })),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies findings reads and writes across tenants", async () => {
    const now = new Date();
    await withTenant(prisma, a.context, (tx) =>
      tx.finding.create({
        data: {
          organizationId: a.organizationId,
          dealId: a.dealId,
          domain: 'SECURITY',
          title: 'Integration finding',
          description: 'Synthetic',
          severity: 'LOW',
          confidence: 'LOW',
          origin: 'HUMAN',
          fingerprint: `it:${newId()}`,
          createdBy: { kind: 'HUMAN', userId: a.userId, role: 'DEAL_LEAD' },
          evidenceVersion: 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    await expect(withTenant(prisma, b.context, (tx) => tx.finding.count({ where: { dealId: a.dealId } }))).resolves.toBe(0);
    await expect(
      withTenant(prisma, b.context, (tx) =>
        tx.finding.create({
          data: {
            organizationId: a.organizationId,
            dealId: a.dealId,
            domain: 'SECURITY',
            title: 'Cross-tenant',
            description: 'Synthetic',
            severity: 'LOW',
            confidence: 'LOW',
            origin: 'HUMAN',
            fingerprint: `it:${newId()}`,
            createdBy: { kind: 'HUMAN', userId: b.userId, role: 'DEAL_LEAD' },
            evidenceVersion: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(withTenant(prisma, a.context, (tx) => tx.finding.deleteMany())).rejects.toThrow(/permission denied/);
  });
});
