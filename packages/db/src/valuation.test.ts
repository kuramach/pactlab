import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type TenantContext } from '@pactlab/domain';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('valuation persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let reviewer: TenantContext;
  let contributor: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) =>
    withTenant(db.prisma, context, fn);

  /** Scenario + run + submission written as the deal lead. */
  async function submitted(tenant: SyntheticTenant) {
    const scenarioId = newId();
    const runId = newId();
    const submissionId = newId();
    const canonical = `{"scenario":"${scenarioId}","amount":"65000000.00"}`;
    const now = new Date();
    const scope = { organizationId: tenant.organizationId, dealId: tenant.dealId };
    await inTenant(tenant.context, async (tx) => {
      await tx.valuationScenario.create({
        data: {
          ...scope,
          id: scenarioId,
          name: 'Base',
          currency: 'USD',
          transactionType: 'PRIVATE_ACQUIRER',
          status: 'SUBMITTED',
          assumptionVersion: 1,
          createdBy: tenant.userId,
          createdAt: now,
          updatedAt: now,
          version: 3,
        },
      });
      await tx.valuationAssumptionSet.create({
        data: { ...scope, scenarioId, version: 1, values: { arr: '1' }, createdBy: tenant.userId, createdAt: now },
      });
      await tx.valuationRun.create({
        data: {
          ...scope,
          id: runId,
          scenarioId,
          assumptionVersion: 1,
          inputs: { arr: '1' },
          result: { ev: '1' },
          ranBy: tenant.userId,
          ranAt: now,
        },
      });
      await tx.valuationSubmission.create({
        data: {
          ...scope,
          id: submissionId,
          scenarioId,
          runId,
          canonical,
          digest: sha256(canonical),
          submittedBy: tenant.userId,
          submittedAt: now,
        },
      });
    });
    return { scenarioId, runId, submissionId, canonical };
  }

  const decision = (tenant: SyntheticTenant, submissionId: string, decidedBy: string) => ({
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    submissionId,
    decision: 'APPROVED' as const,
    rationale: 'Ties to accepted findings',
    decidedBy,
    decidedRole: 'REVIEWER' as const,
    decidedAt: new Date(),
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    reviewer = (await addSyntheticDealMember(db.owner, a, 'REVIEWER')).context;
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('stores frozen submissions byte-for-byte', async () => {
    const { submissionId, canonical } = await submitted(a);
    const row = await inTenant(a.context, (tx) => tx.valuationSubmission.findUnique({ where: { id: submissionId } }));
    expect(row?.canonical).toBe(canonical);
    expect(row?.digest).toBe(sha256(canonical));
  });

  it('rejects a submission whose bytes do not match the digest', async () => {
    const { scenarioId, runId } = await submitted(a);
    await expect(
      inTenant(a.context, (tx) =>
        tx.valuationSubmission.create({
          data: {
            organizationId: a.organizationId,
            dealId: a.dealId,
            scenarioId,
            runId,
            canonical: '{"tampered":true}',
            digest: sha256('{"original":true}'),
            submittedBy: a.userId,
            submittedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('isolates tenants and hides valuation from target contributors', async () => {
    const { scenarioId } = await submitted(a);
    expect(await inTenant(b.context, (tx) => tx.valuationScenario.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => tx.valuationScenario.findUnique({ where: { id: scenarioId } }))).toBeNull();
    for (const table of ['valuationScenario', 'valuationRun', 'valuationSubmission', 'valuationAssumptionSet'] as const) {
      expect(await inTenant(contributor, (tx) => (tx[table] as { count(): Promise<number> }).count())).toBe(0);
    }
    await expect(
      inTenant(b.context, (tx) =>
        tx.valuationScenario.updateMany({ where: { id: scenarioId }, data: { status: 'APPROVED' } }),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it('enforces four eyes: the submitter cannot record a decision on their own submission', async () => {
    const { submissionId } = await submitted(a);
    await expect(
      inTenant(a.context, (tx) => tx.valuationSubmissionDecision.create({ data: decision(a, submissionId, a.userId) })),
    ).rejects.toThrow(/row-level security/);
    // Nor in someone else's name.
    await expect(
      inTenant(reviewer, (tx) => tx.valuationSubmissionDecision.create({ data: decision(a, submissionId, a.userId) })),
    ).rejects.toThrow(/row-level security/);
    await inTenant(reviewer, (tx) =>
      tx.valuationSubmissionDecision.create({ data: decision(a, submissionId, reviewer.userId) }),
    );
  });

  it('grants no DELETE and keeps runs, submissions and decisions immutable', async () => {
    await submitted(a);
    const statements = [
      `DELETE FROM valuation_scenarios`,
      `DELETE FROM valuation_runs`,
      `DELETE FROM valuation_submissions`,
      `DELETE FROM valuation_assumption_sets`,
      `DELETE FROM valuation_submission_decisions`,
      `UPDATE valuation_runs SET result = '{}'`,
      `UPDATE valuation_submissions SET canonical = 'x'`,
      `UPDATE valuation_assumption_sets SET values = '{}'`,
      `UPDATE valuation_submission_decisions SET rationale = 'x'`,
      `UPDATE valuation_scenarios SET name = 'x'`,
    ];
    for (const sql of statements) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
