import type { ValuationInputs, ValuationResult } from '@pactlab/calculations';
import {
  appendAuditEvent,
  withTenant,
  type AuditEventInput,
  type Prisma,
  type PrismaClient,
  type TransactionClient,
} from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type {
  AssumptionSet,
  Scenario,
  ScenarioAssumptions,
  ScenarioChange,
  ScenarioRecord,
  Submission,
  SubmissionDecision,
  ValuationRepository,
  ValuationRun,
} from './valuation.repository';

const recordInclude = {
  assumptionSets: { orderBy: { version: 'asc' } },
  runs: { orderBy: [{ ranAt: 'desc' }, { id: 'desc' }], take: 1 },
  submissions: {
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    include: { decisions: { orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }] } },
  },
} as const satisfies Prisma.ValuationScenarioInclude;

type ScenarioRow = Prisma.ValuationScenarioGetPayload<{ include: typeof recordInclude }>;
type RunRow = ScenarioRow['runs'][number];
type SubmissionRow = Omit<ScenarioRow['submissions'][number], 'decisions'>;

const json = (value: unknown) => value as Prisma.InputJsonValue;

function toScenario(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    name: row.name,
    currency: row.currency,
    transactionType: row.transactionType,
    status: row.status,
    assumptionVersion: row.assumptionVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toRun(row: RunRow): ValuationRun {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    assumptionVersion: row.assumptionVersion,
    inputs: row.inputs as unknown as ValuationInputs,
    result: row.result as unknown as ValuationResult,
    ranBy: row.ranBy,
    ranAt: row.ranAt.toISOString(),
  };
}

function toSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    runId: row.runId,
    canonical: row.canonical,
    digest: row.digest,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
  };
}

function toRecord(row: ScenarioRow): ScenarioRecord {
  const latest = row.runs[0];
  return {
    scenario: toScenario(row),
    assumptionSets: row.assumptionSets.map(
      (set): AssumptionSet => ({
        scenarioId: set.scenarioId,
        version: set.version,
        values: set.values as unknown as ScenarioAssumptions,
        createdBy: set.createdBy,
        createdAt: set.createdAt.toISOString(),
      }),
    ),
    latestRun: latest ? toRun(latest) : null,
    submissions: row.submissions.map(toSubmission),
    decisions: row.submissions.flatMap((submission) =>
      submission.decisions.map(
        (decision): SubmissionDecision => ({
          id: decision.id,
          submissionId: decision.submissionId,
          decision: decision.decision,
          rationale: decision.rationale,
          decidedBy: decision.decidedBy,
          decidedRole: decision.decidedRole,
          decidedAt: decision.decidedAt.toISOString(),
        }),
      ),
    ),
  };
}

async function appendChange(tx: TransactionClient, scenario: Scenario, change: ScenarioChange) {
  const scope = { organizationId: scenario.organizationId, dealId: scenario.dealId };
  switch (change.kind) {
    case 'ASSUMPTIONS': {
      const set = change.assumptionSet;
      await tx.valuationAssumptionSet.create({
        data: {
          ...scope,
          scenarioId: set.scenarioId,
          version: set.version,
          values: json(set.values),
          createdBy: set.createdBy,
          createdAt: new Date(set.createdAt),
        },
      });
      return;
    }
    case 'RUN': {
      const run = change.run;
      await tx.valuationRun.create({
        data: {
          ...scope,
          id: run.id,
          scenarioId: run.scenarioId,
          assumptionVersion: run.assumptionVersion,
          inputs: json(run.inputs),
          result: json(run.result),
          ranBy: run.ranBy,
          ranAt: new Date(run.ranAt),
        },
      });
      return;
    }
    case 'SUBMISSION': {
      const submission = change.submission;
      await tx.valuationSubmission.create({
        data: {
          ...scope,
          id: submission.id,
          scenarioId: submission.scenarioId,
          runId: submission.runId,
          canonical: submission.canonical,
          digest: submission.digest,
          submittedBy: submission.submittedBy,
          submittedAt: new Date(submission.submittedAt),
        },
      });
      return;
    }
    case 'DECISION': {
      const decision = change.decision;
      await tx.valuationSubmissionDecision.create({
        data: {
          ...scope,
          id: decision.id,
          submissionId: decision.submissionId,
          decision: decision.decision,
          rationale: decision.rationale,
          decidedBy: decision.decidedBy,
          decidedRole: decision.decidedRole,
          decidedAt: new Date(decision.decidedAt),
        },
      });
      return;
    }
  }
}

/**
 * RLS-backed valuation persistence. Every call runs as `pactlab_app` inside
 * the caller's tenant context; a scenario change, its appended record and
 * its audit event commit in one transaction. Submission bytes are stored and
 * returned as the exact string.
 */
export class PrismaValuationRepository implements ValuationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenant: TenantContext, dealId: string): Promise<ScenarioRecord[]> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.valuationScenario.findMany({
        where: { dealId },
        include: recordInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.map(toRecord);
  }

  async get(tenant: TenantContext, dealId: string, scenarioId: string): Promise<ScenarioRecord | null> {
    const row = await withTenant(this.prisma, tenant, (tx) =>
      tx.valuationScenario.findFirst({ where: { id: scenarioId, dealId }, include: recordInclude }),
    );
    return row ? toRecord(row) : null;
  }

  async getSubmission(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    submissionId: string,
  ): Promise<Submission | null> {
    const row = await withTenant(this.prisma, tenant, (tx) =>
      tx.valuationSubmission.findFirst({ where: { id: submissionId, scenarioId, dealId } }),
    );
    return row ? toSubmission(row) : null;
  }

  async insert(
    tenant: TenantContext,
    scenario: Scenario,
    assumptionSet: AssumptionSet,
    audit: AuditEventInput,
  ): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.valuationScenario.create({
        data: {
          id: scenario.id,
          organizationId: scenario.organizationId,
          dealId: scenario.dealId,
          name: scenario.name,
          currency: scenario.currency,
          transactionType: scenario.transactionType,
          status: scenario.status,
          assumptionVersion: scenario.assumptionVersion,
          createdBy: scenario.createdBy,
          createdAt: new Date(scenario.createdAt),
          updatedAt: new Date(scenario.updatedAt),
          version: scenario.version,
        },
      });
      await appendChange(tx, scenario, { kind: 'ASSUMPTIONS', assumptionSet });
      await appendAuditEvent(tx, audit);
    });
  }

  commit(
    tenant: TenantContext,
    scenario: Scenario,
    expectedVersion: number,
    change: ScenarioChange,
    audit: AuditEventInput,
  ): Promise<boolean> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.valuationScenario.updateMany({
        where: { id: scenario.id, dealId: scenario.dealId, version: expectedVersion },
        data: {
          status: scenario.status,
          assumptionVersion: scenario.assumptionVersion,
          updatedAt: new Date(scenario.updatedAt),
          version: scenario.version,
        },
      });
      if (updated.count === 0) return false;
      await appendChange(tx, scenario, change);
      await appendAuditEvent(tx, audit);
      return true;
    });
  }
}
