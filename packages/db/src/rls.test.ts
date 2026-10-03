import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type DealId, type TenantContext } from '@pactlab/domain';
import { appendAuditEvent, enqueueOutboxEvent, verifyAuditChain } from './audit';
import { deals, jobRuns, storedFiles } from './repositories';
import { assertRuntimeRoleIsolation, resolveJobContext, resolvePrincipal, withTenant } from './tenant';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/**
 * Tenant isolation proof (MVP increment 0 exit criterion): two synthetic
 * tenants, every policy exercised on its allow path and its deny paths.
 */
describe('PostgreSQL row-level security', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  const job = (tenant: SyntheticTenant, dealId = tenant.dealId, key = newId()) => ({
    jobId: newId(),
    organizationId: tenant.organizationId,
    dealId,
    type: 'system.noop',
    schemaVersion: 1,
    idempotencyKey: key,
    attempt: 0,
    requestedBy: tenant.userId,
    correlationId: 'test',
  });

  it('runtime role cannot bypass RLS', async () => {
    await expect(assertRuntimeRoleIsolation(db.prisma)).resolves.toBeUndefined();
  });

  describe('deny by default', () => {
    it('returns no rows from any table without a tenant context', async () => {
      const empty = { ...a.context, dealIds: [] };
      const counts = await db.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
        return Promise.all([
          tx.organization.count(),
          tx.user.count(),
          tx.organizationMembership.count(),
          tx.deal.count(),
          tx.dealMembership.count(),
          tx.storedFile.count(),
          tx.jobRun.count(),
          tx.auditEvent.count(),
          tx.outboxEvent.count(),
        ]);
      });
      expect(counts.every((count) => count === 0)).toBe(true);
      // Organization context without deal grants still hides every deal.
      await expect(withTenant(db.prisma, empty, (tx) => tx.deal.count())).resolves.toBe(0);
    });

    it('rejects malformed tenant identifiers before querying', async () => {
      const forged = { ...a.context, dealIds: [`${b.dealId}}','{x` as DealId] };
      await expect(withTenant(db.prisma, forged, (tx) => tx.deal.count())).rejects.toThrow(/Invalid tenant/);
    });
  });

  describe('principal resolution', () => {
    it('resolves a member to their organization and deals (allow)', async () => {
      const context = await resolvePrincipal(db.prisma, {
        subject: a.subject,
        externalOrganizationId: a.auth0OrganizationId,
      });
      expect(context).toEqual(a.context);
    });

    it("denies a member presenting another tenant's organization claim", async () => {
      await expect(
        resolvePrincipal(db.prisma, { subject: a.subject, externalOrganizationId: b.auth0OrganizationId }),
      ).resolves.toBeNull();
    });

    it('denies an unknown subject', async () => {
      await expect(
        resolvePrincipal(db.prisma, { subject: 'auth0|unknown', externalOrganizationId: a.auth0OrganizationId }),
      ).resolves.toBeNull();
    });
  });

  describe('deals', () => {
    it('lists, reads and searches own deals (allow)', async () => {
      const result = await withTenant(db.prisma, a.context, async (tx) => ({
        list: await deals.list(tx),
        one: await deals.get(tx, a.dealId),
        search: await deals.search(tx, 'Alpha'),
      }));
      expect(result.list.map((deal) => deal.id)).toEqual([a.dealId]);
      expect(result.one?.organizationId).toBe(a.organizationId);
      expect(result.search.map((deal) => deal.id)).toEqual([a.dealId]);
    });

    it("cannot read another tenant's deal by id (deny)", async () => {
      await expect(withTenant(db.prisma, a.context, (tx) => deals.get(tx, b.dealId))).resolves.toBeNull();
    });

    it("cannot find another tenant's deal through search (deny)", async () => {
      await expect(withTenant(db.prisma, a.context, (tx) => deals.search(tx, 'Bravo'))).resolves.toEqual([]);
    });

    it("cannot read another tenant's deal by claiming its id in the deal list (deny)", async () => {
      const smuggled: TenantContext = { ...a.context, dealIds: [a.context.dealIds[0] as DealId, b.dealId as DealId] };
      await expect(withTenant(db.prisma, smuggled, (tx) => deals.get(tx, b.dealId))).resolves.toBeNull();
    });

    it("cannot update another tenant's deal (deny)", async () => {
      const updated = await withTenant(db.prisma, a.context, (tx) =>
        tx.deal.updateMany({ where: { id: b.dealId }, data: { name: 'hijacked' } }),
      );
      expect(updated.count).toBe(0);
    });

    it("cannot insert a deal into another tenant's organization (deny)", async () => {
      await expect(
        withTenant(db.prisma, a.context, (tx) =>
          tx.deal.create({
            data: {
              organizationId: b.organizationId,
              name: 'x',
              targetName: 'y',
              transactionType: 'TAKE_PRIVATE',
              createdBy: a.userId,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('rejects cross-tenant references by composite foreign key, even for the owner', async () => {
      await expect(
        db.owner.query(
          `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'VIEWER')`,
          [newId(), a.organizationId, b.dealId, a.userId],
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe('jobs', () => {
    it('records a job for an own deal and replays without duplicates (allow)', async () => {
      const input = job(a);
      const first = await withTenant(db.prisma, a.context, (tx) => jobRuns.start(tx, input));
      const replay = await withTenant(db.prisma, a.context, (tx) => jobRuns.start(tx, { ...input, jobId: newId() }));
      expect(first.replayed).toBe(false);
      expect(replay).toEqual({ id: first.id, status: 'RUNNING', replayed: true });
      const count = await withTenant(db.prisma, a.context, (tx) =>
        tx.jobRun.count({ where: { idempotencyKey: input.idempotencyKey } }),
      );
      expect(count).toBe(1);
    });

    it("cannot record a job against another tenant's deal (deny)", async () => {
      await expect(
        withTenant(db.prisma, a.context, (tx) => jobRuns.start(tx, job(a, b.dealId))),
      ).rejects.toThrow();
    });

    it("cannot see another tenant's jobs (deny)", async () => {
      await withTenant(db.prisma, b.context, (tx) => jobRuns.start(tx, job(b)));
      const visible = await withTenant(db.prisma, a.context, (tx) =>
        tx.jobRun.findMany({ select: { organizationId: true } }),
      );
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((row) => row.organizationId === a.organizationId)).toBe(true);
    });

    it('establishes job context only for a requester with deal access', async () => {
      await expect(resolveJobContext(db.prisma, job(a))).resolves.toEqual(a.context);
      // Tenant A's user cannot run a job inside tenant B, or against B's deal.
      await expect(
        resolveJobContext(db.prisma, { ...job(a), organizationId: b.organizationId, dealId: b.dealId }),
      ).rejects.toThrow(/no access/);
      await expect(resolveJobContext(db.prisma, { ...job(a), dealId: b.dealId })).rejects.toThrow(/no access/);
    });
  });

  describe('files', () => {
    it('reads own file metadata (allow)', async () => {
      const file = await withTenant(db.prisma, a.context, (tx) => storedFiles.get(tx, a.fileId));
      expect(file?.objectKey.startsWith(`${a.organizationId}/${a.dealId}/`)).toBe(true);
    });

    it("cannot read another tenant's file (deny)", async () => {
      await expect(withTenant(db.prisma, a.context, (tx) => storedFiles.get(tx, b.fileId))).resolves.toBeNull();
    });

    it("cannot register a file under another tenant's object prefix (deny)", async () => {
      const input = {
        organizationId: a.organizationId,
        dealId: a.dealId,
        objectKey: `${b.organizationId}/${b.dealId}/documents/evil.pdf`,
        fileName: 'evil.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1n,
        sha256: '0'.repeat(64),
      };
      await expect(withTenant(db.prisma, a.context, (tx) => storedFiles.register(tx, input))).rejects.toThrow(
        /outside the tenant/,
      );
      // The database constraint holds even if application code is bypassed.
      await expect(
        withTenant(db.prisma, a.context, (tx) => tx.storedFile.create({ data: { ...input, id: newId() } })),
      ).rejects.toThrow(/object_key_tenant_prefix|check constraint/);
    });
  });

  describe('audit and outbox', () => {
    it('appends a hash-chained audit trail that cannot be modified', async () => {
      await withTenant(db.prisma, a.context, async (tx) => {
        for (const action of ['deal.read', 'deal.search', 'file.read']) {
          await appendAuditEvent(tx, {
            organizationId: a.organizationId,
            dealId: a.dealId,
            actorUserId: a.userId,
            action,
            targetType: 'deal',
            targetId: a.dealId,
            outcome: 'ALLOWED',
          });
        }
      });
      const chain = await withTenant(db.prisma, a.context, (tx) =>
        tx.auditEvent.findMany({ where: { dealId: a.dealId }, orderBy: { chainSeq: 'asc' } }),
      );
      expect(chain.map((event) => Number(event.chainSeq))).toEqual([1, 2, 3]);
      expect(verifyAuditChain(chain)).toEqual({ valid: true });
      expect(verifyAuditChain([chain[0]!, { ...chain[1]!, action: 'tampered' }])).toEqual({
        valid: false,
        brokenAt: chain[1]!.id,
      });

      // Privilege errors are asserted on the PGlite session directly: the wire
      // shim drops connections on parse-time errors. The integration suite
      // repeats these through Prisma against real PostgreSQL.
      for (const statement of [`UPDATE audit_events SET action = 'x'`, 'DELETE FROM audit_events']) {
        await expect(
          db.owner.transaction(async (tx) => {
            await tx.exec('SET LOCAL ROLE pactlab_app');
            await tx.exec(statement);
          }),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(db.owner.query(`UPDATE audit_events SET action = 'x'`)).rejects.toThrow(/append-only/);
      await expect(db.owner.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
    });

    it("cannot read or write another tenant's audit events (deny)", async () => {
      await withTenant(db.prisma, b.context, (tx) =>
        appendAuditEvent(tx, { organizationId: b.organizationId, action: 'org.read', targetType: 'organization', outcome: 'ALLOWED' }),
      );
      const visible = await withTenant(db.prisma, a.context, (tx) => tx.auditEvent.findMany());
      expect(visible.every((event) => event.organizationId === a.organizationId)).toBe(true);
      await expect(
        withTenant(db.prisma, a.context, (tx) =>
          appendAuditEvent(tx, { organizationId: b.organizationId, action: 'x', targetType: 'x', outcome: 'ALLOWED' }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('scopes outbox events to the tenant', async () => {
      const event = (tenant: SyntheticTenant) => ({
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        aggregateType: 'deal',
        aggregateId: tenant.dealId,
        eventType: 'deal.touched',
        payload: { version: 1 },
        idempotencyKey: newId(),
      });
      await withTenant(db.prisma, a.context, (tx) => enqueueOutboxEvent(tx, event(a)));
      await withTenant(db.prisma, b.context, (tx) => enqueueOutboxEvent(tx, event(b)));
      const visible = await withTenant(db.prisma, a.context, (tx) => tx.outboxEvent.findMany());
      expect(visible).toHaveLength(1);
      expect(visible[0]?.organizationId).toBe(a.organizationId);
      await expect(withTenant(db.prisma, a.context, (tx) => enqueueOutboxEvent(tx, event(b)))).rejects.toThrow(
        /row-level security/,
      );
    });
  });
});
