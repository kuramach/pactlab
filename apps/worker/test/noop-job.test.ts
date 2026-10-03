import { TenantAccessDeniedError, newId } from '@pactlab/domain';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processNoopJob } from '../src/jobs/noop';

describe('noop job (tenant-scoped, idempotent)', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;

  const envelope = (tenant: SyntheticTenant, overrides: Record<string, unknown> = {}) => ({
    jobId: newId(),
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    type: 'system.noop',
    schemaVersion: 1,
    idempotencyKey: newId(),
    attempt: 0,
    requestedBy: tenant.userId,
    correlationId: 'test',
    ...overrides,
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('records a run for the requester’s own deal (allow)', async () => {
    const outcome = await processNoopJob({ prisma: db.prisma }, envelope(a));
    expect(outcome.replayed).toBe(false);
    const rows = await db.owner.query<{ status: string; organization_id: string }>(
      'SELECT status, organization_id FROM job_runs WHERE id = $1',
      [outcome.jobRunId],
    );
    expect(rows.rows).toEqual([{ status: 'SUCCEEDED', organization_id: a.organizationId }]);
  });

  it('replays without creating a duplicate run', async () => {
    const job = envelope(a);
    const first = await processNoopJob({ prisma: db.prisma }, job);
    const replay = await processNoopJob({ prisma: db.prisma }, { ...job, jobId: newId(), attempt: 1 });
    expect(replay).toEqual({ jobRunId: first.jobRunId, replayed: true });
    const count = await db.owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM job_runs WHERE idempotency_key = $1',
      [job.idempotencyKey],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it("denies a job targeting another tenant's deal", async () => {
    await expect(processNoopJob({ prisma: db.prisma }, envelope(a, { dealId: b.dealId }))).rejects.toBeInstanceOf(
      TenantAccessDeniedError,
    );
    await expect(
      processNoopJob({ prisma: db.prisma }, envelope(a, { organizationId: b.organizationId, dealId: b.dealId })),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    const leaked = await db.owner.query('SELECT 1 FROM job_runs WHERE deal_id = $1', [b.dealId]);
    expect(leaked.rows).toEqual([]);
  });

  it('rejects envelopes missing the job contract', async () => {
    const { organizationId: _missing, ...incomplete } = envelope(a);
    await expect(processNoopJob({ prisma: db.prisma }, incomplete)).rejects.toThrow();
  });
});
