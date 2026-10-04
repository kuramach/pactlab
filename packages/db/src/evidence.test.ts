import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCsvEvidenceSource,
  newId,
  type EvidenceSource,
  type TenantContext,
} from '@pactlab/domain';
import { verifyAuditChain } from './audit';
import { connections, evidence, IdempotencyConflictError, syncRuns } from './evidence';
import { sha256Hex } from './hash';
import { createDealWithLead, dealMemberships } from './memberships';
import { executeSyncRun } from './sync';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const CUSTOMERS =
  'customer_id,name,mrr,as_of\nc-1,Acme (synthetic),100.00,2026-09-30\nc-2,Beta (synthetic),200.00,2026-09-30\n';

function csvSource(text: () => string): EvidenceSource {
  return createCsvEvidenceSource({
    provider: 'csv',
    version: 'csv-test-1',
    datasets: [
      {
        dataset: 'HealthyCo/customers.csv',
        evidenceType: 'billing.customer',
        recordIdColumn: 'customer_id',
        observedAtColumn: 'as_of',
      },
    ],
    load: async () => text(),
  });
}

describe('deal/evidence spine', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let connectionId: string;

  async function requestRun(tenant: SyntheticTenant, key = newId(), connection = connectionId) {
    return withTenant(db.prisma, tenant.context, (tx) =>
      syncRuns.request(tx, {
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        connectionId: connection,
        connectorVersion: 'csv-test-1',
        idempotencyKey: key,
        requestedBy: tenant.userId,
        correlationId: 'test',
      }),
    );
  }

  const job = (tenant: SyntheticTenant, syncRunId: string) => ({
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    requestedBy: tenant.userId,
    syncRunId,
  });

  async function evidenceCount(context: TenantContext) {
    return withTenant(db.prisma, context, (tx) => tx.evidenceItem.count());
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const connection = await withTenant(db.prisma, a.context, (tx) =>
      connections.create(tx, {
        organizationId: a.organizationId,
        dealId: a.dealId,
        provider: 'csv',
        displayName: 'Billing export',
        mode: 'FIXTURE',
        credentialRef: null,
        config: { datasets: ['HealthyCo/customers.csv'] },
        evidenceVisibility: 'BUYER_ONLY',
        createdBy: a.userId,
      }),
    );
    connectionId = connection.id;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  describe('sync runs', () => {
    it('replaying a sync run creates no duplicates and keeps lineage intact', async () => {
      const key = newId();
      const { run } = await requestRun(a, key);
      const first = await executeSyncRun(
        db.prisma,
        job(a, run.id),
        csvSource(() => CUSTOMERS),
      );
      expect(first).toMatchObject({
        replayed: false,
        recordsSeen: 2,
        recordsCreated: 2,
        recordsUnchanged: 0,
      });

      // Same idempotency key → same run; executing it again writes nothing.
      const again = await requestRun(a, key);
      expect(again).toMatchObject({ replayed: true, run: { id: run.id, status: 'SUCCEEDED' } });
      const replay = await executeSyncRun(
        db.prisma,
        job(a, run.id),
        csvSource(() => CUSTOMERS),
      );
      expect(replay).toMatchObject({ replayed: true, recordsCreated: 2 });

      // A brand-new run over unchanged data matches every record by content hash.
      const { run: second } = await requestRun(a);
      const resync = await executeSyncRun(
        db.prisma,
        job(a, second.id),
        csvSource(() => CUSTOMERS),
      );
      expect(resync).toMatchObject({
        replayed: false,
        recordsSeen: 2,
        recordsCreated: 0,
        recordsUnchanged: 2,
      });

      const state = await withTenant(db.prisma, a.context, async (tx) => ({
        items: await tx.evidenceItem.findMany({ include: { citations: true } }),
        edges: await tx.evidenceEdge.count(),
        outbox: await tx.outboxEvent.count({ where: { aggregateType: 'sync_run' } }),
        audit: await tx.auditEvent.findMany({
          where: { dealId: a.dealId },
          orderBy: { chainSeq: 'asc' },
        }),
      }));
      expect(state.items).toHaveLength(2);
      expect(state.edges).toBe(0);
      expect(state.outbox).toBe(2);
      for (const item of state.items) {
        expect(item.firstSyncRunId).toBe(run.id);
        expect(item.lastSyncRunId).toBe(second.id);
        expect(item.citations).toHaveLength(1);
      }
      expect(verifyAuditChain(state.audit)).toEqual({ valid: true });
    });

    it('records changed source content as a new version linked by SUPERSEDES', async () => {
      const changed = CUSTOMERS.replace('100.00', '150.00');
      const { run } = await requestRun(a);
      const outcome = await executeSyncRun(
        db.prisma,
        job(a, run.id),
        csvSource(() => changed),
      );
      expect(outcome).toMatchObject({ recordsCreated: 1, recordsUnchanged: 1 });

      const versions = await withTenant(db.prisma, a.context, (tx) =>
        tx.evidenceItem.findMany({ where: { sourceRecordId: 'c-1' }, orderBy: { id: 'asc' } }),
      );
      expect(versions).toHaveLength(2);
      const lineage = await withTenant(db.prisma, a.context, (tx) =>
        evidence.lineage(tx, a.dealId, versions[1]!.id),
      );
      expect(lineage?.related).toEqual([
        { evidenceId: versions[0]!.id, edgeType: 'SUPERSEDES', direction: 'OUTGOING', depth: 1 },
      ]);
      const older = await withTenant(db.prisma, a.context, (tx) =>
        evidence.lineage(tx, a.dealId, versions[0]!.id),
      );
      expect(older?.related).toEqual([
        { evidenceId: versions[1]!.id, edgeType: 'SUPERSEDES', direction: 'INCOMING', depth: 1 },
      ]);
    });

    it('rejects an idempotency key reused for a different connection', async () => {
      const key = newId();
      await requestRun(a, key);
      const other = await withTenant(db.prisma, a.context, (tx) =>
        connections.create(tx, {
          organizationId: a.organizationId,
          dealId: a.dealId,
          provider: 'csv',
          displayName: 'Second export',
          mode: 'FIXTURE',
          credentialRef: null,
          config: {},
          evidenceVisibility: 'BUYER_ONLY',
          createdBy: a.userId,
        }),
      );
      await expect(requestRun(a, key, other.id)).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('marks a run FAILED when the source throws, and it can be retried', async () => {
      const { run } = await requestRun(a);
      const broken: EvidenceSource = {
        provider: 'csv',
        version: 'csv-test-1',
        pull: async () => Promise.reject(new TypeError('boom')),
      };
      await expect(executeSyncRun(db.prisma, job(a, run.id), broken)).rejects.toThrow('boom');
      const failed = await withTenant(db.prisma, a.context, (tx) =>
        syncRuns.get(tx, a.dealId, run.id),
      );
      expect(failed).toMatchObject({ status: 'FAILED', errorClass: 'TypeError' });
      const retried = await executeSyncRun(
        db.prisma,
        job(a, run.id),
        csvSource(() => CUSTOMERS),
      );
      expect(retried.replayed).toBe(false);
    });

    it("refuses to execute a run for another tenant's deal", async () => {
      const { run } = await requestRun(a);
      await expect(
        executeSyncRun(
          db.prisma,
          { ...job(b, run.id), dealId: a.dealId },
          csvSource(() => CUSTOMERS),
        ),
      ).rejects.toThrow(/no access/);
    });
  });

  describe('lineage', () => {
    it('resolves every evidence record to its source system, record id and exact source row', async () => {
      const items = await withTenant(db.prisma, a.context, (tx) =>
        evidence.list(tx, a.dealId, { limit: 100 }),
      );
      expect(items.items.length).toBeGreaterThan(0);
      for (const item of items.items) {
        const lineage = await withTenant(db.prisma, a.context, (tx) =>
          evidence.lineage(tx, a.dealId, item.id),
        );
        expect(lineage).not.toBeNull();
        expect(lineage!.evidence.sourceSystem).toBe('csv');
        expect(lineage!.evidence.sourceRecordId).toMatch(/^c-\d$/);
        expect(lineage!.connection).toMatchObject({
          id: connectionId,
          provider: 'csv',
          mode: 'FIXTURE',
        });
        expect(lineage!.syncRun.status).toBe('SUCCEEDED');
        expect(lineage!.citations).toHaveLength(1);
        const citation = lineage!.citations[0]!;
        expect(citation.locator.dataset).toBe('HealthyCo/customers.csv');
        // The quote hash verifies against the exact source row the citation points to.
        const sourceRow = CUSTOMERS.split('\n')[citation.locator.row];
        const candidates = [sourceRow, sourceRow?.replace('100.00', '150.00')].map((row) =>
          sha256Hex(row ?? ''),
        );
        expect(candidates).toContain(citation.quoteHash);
      }
    });

    it('paginates with an opaque cursor and filters by type and record id', async () => {
      const page1 = await withTenant(db.prisma, a.context, (tx) =>
        evidence.list(tx, a.dealId, { limit: 1 }),
      );
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await withTenant(db.prisma, a.context, (tx) =>
        evidence.list(tx, a.dealId, { limit: 1, after: page1.nextCursor! }),
      );
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
      const filtered = await withTenant(db.prisma, a.context, (tx) =>
        evidence.list(tx, a.dealId, {
          limit: 50,
          sourceRecordId: 'c-2',
          evidenceType: 'billing.customer',
        }),
      );
      expect(filtered.items.map((item) => item.sourceRecordId)).toEqual(['c-2']);
    });
  });

  describe('tenant isolation (allow + deny)', () => {
    it("never shows another tenant's connections, runs, evidence, edges or citations", async () => {
      const visible = await withTenant(db.prisma, b.context, async (tx) => [
        await tx.connection.count(),
        await tx.syncRun.count(),
        await tx.evidenceItem.count(),
        await tx.evidenceEdge.count(),
        await tx.citation.count(),
      ]);
      expect(visible).toEqual([0, 0, 0, 0, 0]);
      const anyItem = await withTenant(db.prisma, a.context, (tx) =>
        tx.evidenceItem.findFirstOrThrow(),
      );
      await expect(
        withTenant(db.prisma, b.context, (tx) => evidence.lineage(tx, a.dealId, anyItem.id)),
      ).resolves.toBeNull();
    });

    it("cannot create a connection or sync run in another tenant's deal", async () => {
      await expect(
        withTenant(db.prisma, b.context, (tx) =>
          connections.create(tx, {
            organizationId: a.organizationId,
            dealId: a.dealId,
            provider: 'csv',
            displayName: 'x',
            mode: 'FIXTURE',
            credentialRef: null,
            config: {},
            evidenceVisibility: 'BUYER_ONLY',
            createdBy: b.userId,
          }),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(requestRun(b, newId(), connectionId)).rejects.toThrow();
    });

    it('requires a credential reference exactly when a connection is LIVE', async () => {
      await expect(
        withTenant(db.prisma, a.context, (tx) =>
          connections.setMode(tx, connectionId, { mode: 'LIVE', credentialRef: null }),
        ),
      ).rejects.toThrow(/credential_matches_mode|check constraint/);
    });
  });

  describe('contributor boundary', () => {
    it('hides buyer-only evidence, citations and lineage from target contributors until shared', async () => {
      const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
      const buyerCount = await evidenceCount(a.context);
      expect(buyerCount).toBeGreaterThan(0);
      expect(await evidenceCount(contributor.context)).toBe(0);
      await expect(
        withTenant(db.prisma, contributor.context, (tx) => tx.citation.count()),
      ).resolves.toBe(0);

      const item = await withTenant(db.prisma, a.context, (tx) =>
        tx.evidenceItem.findFirstOrThrow({ where: { sourceRecordId: 'c-2' } }),
      );
      await expect(
        withTenant(db.prisma, contributor.context, (tx) => evidence.lineage(tx, a.dealId, item.id)),
      ).resolves.toBeNull();
      // A contributor cannot share buyer-only evidence to themselves.
      await expect(
        withTenant(db.prisma, contributor.context, (tx) =>
          evidence.share(tx, a.dealId, item.id, contributor.userId),
        ),
      ).resolves.toBeNull();

      await withTenant(db.prisma, a.context, (tx) =>
        evidence.share(tx, a.dealId, item.id, a.userId),
      );
      const shared = await withTenant(db.prisma, contributor.context, (tx) =>
        evidence.lineage(tx, a.dealId, item.id),
      );
      expect(shared?.evidence.visibility).toBe('SHARED');
      expect(shared?.citations).toHaveLength(1);
      expect(await evidenceCount(contributor.context)).toBe(1);
    });

    it('cannot write buyer-only evidence as a contributor', async () => {
      const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
      const run = await withTenant(db.prisma, a.context, (tx) => tx.syncRun.findFirstOrThrow());
      await expect(
        withTenant(db.prisma, contributor.context, (tx) =>
          tx.evidenceItem.create({
            data: {
              organizationId: a.organizationId,
              dealId: a.dealId,
              connectionId,
              firstSyncRunId: run.id,
              lastSyncRunId: run.id,
              evidenceType: 'x',
              sourceSystem: 'csv',
              sourceRecordId: newId(),
              canonical: {},
              contentHash: '0'.repeat(64),
              visibility: 'BUYER_ONLY',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('deals and memberships', () => {
    it('creates a deal with the creator as DEAL_LEAD, visible only to the creator tenant', async () => {
      const deal = await createDealWithLead(db.prisma, a.context, {
        name: 'Project New',
        targetName: 'NewCo (synthetic)',
        transactionType: 'PUBLIC_ACQUIRER',
        baseCurrency: 'EUR',
      });
      const role = await withTenant(
        db.prisma,
        { ...a.context, dealIds: [...a.context.dealIds, deal.id as never] },
        (tx) => dealMemberships.roleOf(tx, deal.id, a.userId),
      );
      expect(role).toBe('DEAL_LEAD');
      await expect(
        withTenant(db.prisma, { ...b.context, dealIds: [deal.id as never] }, (tx) =>
          tx.deal.findUnique({ where: { id: deal.id } }),
        ),
      ).resolves.toBeNull();
    });

    it("adds only members of the deal's own organization", async () => {
      const added = await withTenant(db.prisma, a.context, (tx) =>
        dealMemberships.upsert(tx, {
          organizationId: a.organizationId,
          dealId: a.dealId,
          userId: b.userId,
          role: 'ANALYST',
        }),
      );
      expect(added).toBeNull();
    });
  });
});
