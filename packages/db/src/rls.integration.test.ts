import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId } from '@pactlab/domain';
import { appendAuditEvent, verifyAuditChain } from './audit';
import { createPrismaClient, type PrismaClient } from './client';
import { emailLogin } from './login';
import { signup } from './signup';
import { dealParties } from './pacts';
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
      resolvePrincipal(prisma, { subject: a.subject, externalOrganizationId: a.auth0OrganizationId, issuer: 'AUTH0' }),
    ).resolves.toEqual(a.context);
    await expect(
      resolvePrincipal(prisma, { subject: a.subject, externalOrganizationId: b.auth0OrganizationId, issuer: 'AUTH0' }),
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

  it('denies valuation scenarios across tenants', async () => {
    const now = new Date();
    const scenario = await withTenant(prisma, a.context, (tx) =>
      tx.valuationScenario.create({
        data: {
          organizationId: a.organizationId,
          dealId: a.dealId,
          name: 'Integration scenario',
          currency: 'USD',
          transactionType: 'PRIVATE_ACQUIRER',
          assumptionVersion: 1,
          createdBy: a.userId,
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      }),
    );
    await expect(
      withTenant(prisma, b.context, (tx) => tx.valuationScenario.findUnique({ where: { id: scenario.id } })),
    ).resolves.toBeNull();
    await expect(
      withTenant(prisma, b.context, (tx) =>
        tx.valuationScenario.create({
          data: {
            organizationId: a.organizationId,
            dealId: a.dealId,
            name: 'Cross-tenant',
            currency: 'USD',
            transactionType: 'PRIVATE_ACQUIRER',
            assumptionVersion: 1,
            createdBy: b.userId,
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(withTenant(prisma, a.context, (tx) => tx.valuationRun.deleteMany())).rejects.toThrow(/permission denied/);
  });

  it('denies documents across tenants', async () => {
    const id = newId();
    await withTenant(prisma, a.context, (tx) =>
      tx.document.create({
        data: {
          id,
          organizationId: a.organizationId,
          dealId: a.dealId,
          fileName: 'it.txt',
          contentType: 'text/plain',
          sizeBytes: 1,
          sha256: '0'.repeat(64),
          objectKey: `${a.organizationId}/${a.dealId}/documents/${id}/original`,
          pageCount: 1,
          dataClass: 'BUSINESS',
          aiExcluded: false,
          retentionClass: 'DEAL_TERM',
          visibility: 'SHARED',
          malwareScanner: 'it',
          uploadedBy: a.userId,
          createdAt: new Date(),
        },
      }),
    );
    await expect(withTenant(prisma, b.context, (tx) => tx.document.findUnique({ where: { id } }))).resolves.toBeNull();
    await expect(withTenant(prisma, a.context, (tx) => tx.document.deleteMany())).rejects.toThrow(/permission denied/);
  });

  it('signs in with an email code through the definer functions and never crosses methods', async () => {
    const organizationId = newId();
    const userId = newId();
    const email = `it-${userId.slice(-8)}@example.test`;
    await owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'IT Email (synthetic)', $2, 'EMAIL_CODE', now())`,
      [organizationId, `it-email-${organizationId.slice(-8)}`],
    );
    await owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'IT (synthetic)', $3)`, [
      userId,
      `pactlab|${userId}`,
      email,
    ]);
    await owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`,
      [newId(), organizationId, userId],
    );
    const codeHash = 'c'.repeat(64);
    expect(await emailLogin.begin(prisma, { email, codeHash, ipHash: 'd'.repeat(64) })).toBeTruthy();
    const session = await emailLogin.verify(prisma, { email, codeHash });
    expect(session?.organizationId).toBe(organizationId);
    await expect(
      resolvePrincipal(prisma, { subject: `pactlab|${userId}`, externalOrganizationId: organizationId, issuer: 'PACTLAB' }),
    ).resolves.toMatchObject({ organizationId, userId });
    await expect(
      resolvePrincipal(prisma, { subject: `pactlab|${userId}`, externalOrganizationId: a.organizationId, issuer: 'PACTLAB' }),
    ).resolves.toBeNull();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
      return tx.$queryRawUnsafe('SELECT count(*) FROM auth_sessions');
    })).rejects.toThrow(/permission denied/);
  });

  it('creates a pending organization through self-serve sign-up and keeps it closed', async () => {
    const email = `it-signup-${newId().slice(-8)}@example.test`;
    const begun = await signup.begin(prisma, {
      email,
      displayName: 'IT Owner',
      organizationName: 'IT Signup Partners',
      ssoRequested: false,
      codeHash: 'e'.repeat(64),
      ipHash: newId().replaceAll('-', '').padEnd(64, '0'),
    });
    expect(begun.kind).toBe('code');
    const created = await signup.verify(prisma, { email, codeHash: 'e'.repeat(64), requiresApproval: true });
    expect(created).toMatchObject({ status: 'PENDING_APPROVAL' });
    await expect(
      resolvePrincipal(prisma, { subject: `pactlab|${created!.ownerUserId}`, externalOrganizationId: created!.organizationId, issuer: 'PACTLAB' }),
    ).resolves.toBeNull();
    await expect(emailLogin.begin(prisma, { email, codeHash: 'f'.repeat(64), ipHash: 'a'.repeat(64) })).resolves.toBeNull();
  });

  it("keeps a deal's parties inside its tenant", async () => {
    await withTenant(prisma, a.context, (tx) =>
      dealParties.create(tx, {
        organizationId: a.organizationId,
        dealId: a.dealId,
        role: 'SELLER',
        name: 'IT Target Software',
        ownership: 'PUBLIC',
        ticker: 'ITTS',
        exchange: null,
        website: null,
        companyType: 'SOFTWARE_SAAS',
      }),
    );
    await expect(withTenant(prisma, a.context, (tx) => dealParties.list(tx, a.dealId))).resolves.toEqual([
      expect.objectContaining({ role: 'SELLER', ticker: 'ITTS' }),
    ]);
    await expect(withTenant(prisma, b.context, (tx) => dealParties.list(tx, a.dealId))).resolves.toEqual([]);
    await expect(
      withTenant(prisma, b.context, (tx) =>
        dealParties.create(tx, {
          organizationId: a.organizationId,
          dealId: a.dealId,
          role: 'BUYER',
          name: 'Intruder',
          ownership: 'PRIVATE',
          ticker: null,
          exchange: null,
          website: null,
          companyType: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('a pact guest sees only their pact and the people on it — never the organization (ADR 0014)', async () => {
    // A seller-side guest: on a's deal as a target contributor, with no membership in a's organization.
    const guestId = newId();
    const otherDeal = newId();
    await owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Guest Seller (synthetic)', $3)`, [guestId, `pactlab|${guestId}`, `guest-${guestId.slice(-6)}@seller.example`]);
    await owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')`, [newId(), a.organizationId, a.dealId, guestId]);
    await owner.query(`INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ($1, $2, 'Not shared', 'T', 'PRIVATE_ACQUIRER', $3, now())`, [otherDeal, a.organizationId, a.userId]);
    const colleague = newId();
    await owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, 'Colleague not on the pact (synthetic)')`, [colleague, `auth0|c-${colleague.slice(-6)}`]);
    await owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), a.organizationId, colleague]);
    await owner.query(`INSERT INTO comparables (id, organization_id, kind, name, target_name, company_type, enterprise_value, arr, currency, recorded_by, origin) VALUES ($1, $2, 'PRECEDENT_TRANSACTION', 'Synthetic deal X', 'X', 'SOFTWARE_SAAS', 10, 1, 'USD', $3, 'SYNTHETIC')`, [newId(), a.organizationId, a.userId]);
    // The lead (an organization member) does see it: the guest's zero below is the policy, not an empty table.
    expect(await withTenant(prisma, a.context, (tx) => tx.comparable.count())).toBeGreaterThan(0);

    const guest = { organizationId: a.organizationId, userId: guestId, organizationRole: 'GUEST', dealIds: [a.dealId] } as unknown as typeof a.context;
    const seen = await withTenant(prisma, guest, async (tx) => ({
      deals: (await tx.deal.findMany({ select: { id: true } })).map((row) => row.id),
      memberships: await tx.organizationMembership.count(),
      users: (await tx.user.findMany({ select: { id: true } })).map((row) => row.id).sort(),
      comparables: await tx.comparable.count(),
      orgAudit: await tx.auditEvent.count({ where: { dealId: null } }),
      askingPrices: await tx.askingPrice.count(),
    }));
    expect(seen.deals).toEqual([a.dealId]);
    expect(seen.memberships).toBe(0);
    // Themselves and the lead on the pact; never a colleague who is not on it.
    expect(seen.users).toEqual([a.userId, guestId].sort());
    expect(seen.comparables).toBe(0);
    expect(seen.orgAudit).toBe(0);
    expect(seen.askingPrices).toBe(0); // buyer-only

    // No foothold: cannot start a deal or join the organization.
    await expect(withTenant(prisma, guest, (tx) => tx.deal.create({ data: { id: newId(), organizationId: a.organizationId, name: 'Mine', targetName: 'T', transactionType: 'PRIVATE_ACQUIRER', createdBy: guestId } }))).rejects.toThrow();
    await expect(withTenant(prisma, guest, (tx) => tx.organizationMembership.create({ data: { id: newId(), organizationId: a.organizationId, userId: guestId, role: 'ORG_ADMIN' } }))).rejects.toThrow();

    // The buyer side sees the guest by name on the pact.
    const lead = await withTenant(prisma, a.context, (tx) => tx.user.findMany({ where: { id: guestId }, select: { displayName: true } }));
    expect(lead).toEqual([{ displayName: 'Guest Seller (synthetic)' }]);

    // A guest principal resolves only with an active membership on one of the organization's pacts.
    await expect(resolvePrincipal(prisma, { subject: `pactlab|${guestId}`, externalOrganizationId: a.organizationId, issuer: 'PACTLAB' })).resolves.toMatchObject({ organizationRole: 'GUEST', dealIds: [a.dealId] });
    await expect(resolvePrincipal(prisma, { subject: `pactlab|${guestId}`, externalOrganizationId: b.organizationId, issuer: 'PACTLAB' })).resolves.toBeNull();
  });
});
