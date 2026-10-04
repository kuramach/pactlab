import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  freeze,
  runValuation,
  staleReasons,
  validateInputs,
  ValuationInputError,
  verifyFrozen,
  VALUATION_ENGINE_VERSION,
  type LinkedAdjustment,
  type LinkedFindingState,
  type ValuationInputs,
} from '@pactlab/calculations';
import { appendAuditEvent, deals, withTenant, type PrismaClient } from '@pactlab/db';
import { newId, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FINDINGS_REPOSITORY, type FindingsRepository } from '../findings/findings.repository';
import { PRISMA } from '../tokens';
import {
  VALUATION_REPOSITORY,
  type AssumptionSet,
  type FindingLink,
  type Scenario,
  type ScenarioAssumptions,
  type ScenarioChange,
  type ScenarioRecord,
  type ValuationRepository,
} from './valuation.repository';
import type {
  CreateScenarioBody,
  DecideSubmissionBody,
  UpdateAssumptionsBody,
  VersionedCommandBody,
} from './valuation.schemas';

/** Valuation is buyer-only analysis; target contributors never see it by role. */
const canReadValuation = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWriteValuation = (role: DealRole) =>
  permissionsForDealRole(role).has('DEAL_WRITE') &&
  permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canDecideValuation = (role: DealRole) => role === 'DEAL_LEAD' || role === 'REVIEWER';

function translate(error: unknown): never {
  if (error instanceof ValuationInputError) throw new UnprocessableEntityException();
  throw error;
}

/**
 * Scenario application service. Assumptions are versioned, runs record their
 * full resolved input set, results go stale when a linked accepted risk
 * changes, and a submission freezes canonical bytes that are never rewritten.
 */
@Injectable()
export class ValuationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(VALUATION_REPOSITORY) private readonly scenarios: ValuationRepository,
    @Inject(FINDINGS_REPOSITORY) private readonly findings: FindingsRepository,
  ) {}

  private audit(
    tenant: TenantContext,
    scenario: Scenario,
    action: string,
    requestId: string,
    targetType = 'valuation_scenario',
    targetId: string = scenario.id,
  ) {
    return {
      organizationId: tenant.organizationId,
      dealId: scenario.dealId,
      actorUserId: tenant.userId,
      action,
      targetType,
      targetId,
      outcome: 'SUCCEEDED' as const,
      requestId,
    };
  }

  private async load(tenant: TenantContext, dealId: string, scenarioId: string) {
    const record = await this.scenarios.get(tenant, dealId, scenarioId);
    if (!record) throw new NotFoundException();
    return record;
  }

  private currentAssumptions(record: ScenarioRecord): AssumptionSet {
    const set = record.assumptionSets.find(
      (candidate) => candidate.version === record.scenario.assumptionVersion,
    );
    if (!set) throw new InternalServerErrorException();
    return set;
  }

  private async linkedStates(
    tenant: TenantContext,
    dealId: string,
    findingIds: readonly string[],
  ): Promise<Map<string, LinkedFindingState | null>> {
    const states = new Map<string, LinkedFindingState | null>();
    for (const findingId of findingIds) {
      const found = await this.findings.get(tenant, dealId, findingId);
      states.set(
        findingId,
        found
          ? {
              findingId,
              version: found.finding.version,
              status: found.finding.status,
              pricedRisk: found.finding.pricedRisk,
            }
          : null,
      );
    }
    return states;
  }

  /**
   * Resolve finding links to their current priced risk. Only findings a
   * human has accepted may move a valuation.
   */
  private async resolveAdjustments(
    tenant: TenantContext,
    dealId: string,
    links: readonly FindingLink[],
  ): Promise<LinkedAdjustment[]> {
    const adjustments: LinkedAdjustment[] = [];
    for (const link of links) {
      const finding = (await this.findings.get(tenant, dealId, link.findingId))?.finding;
      if (!finding || finding.status !== 'ACCEPTED' || !finding.pricedRisk) {
        throw new UnprocessableEntityException('Linked finding is not an accepted priced risk');
      }
      adjustments.push({
        findingId: finding.id,
        findingVersion: finding.version,
        type: finding.pricedRisk.type,
        currency: finding.pricedRisk.currency,
        low: finding.pricedRisk.low,
        high: finding.pricedRisk.high,
        point: link.point,
        basis: finding.pricedRisk.basis,
      });
    }
    return adjustments;
  }

  private async buildInputs(
    tenant: TenantContext,
    scenario: Pick<Scenario, 'dealId' | 'currency' | 'transactionType'>,
    values: ScenarioAssumptions,
  ): Promise<ValuationInputs> {
    const inputs: ValuationInputs = {
      currency: scenario.currency,
      transactionType: scenario.transactionType,
      assumptions: values.assumptions,
      bridge: values.bridge,
      stockConsiderationShare: values.stockConsiderationShare,
      adjustments: await this.resolveAdjustments(tenant, scenario.dealId, values.findingLinks),
      lbo: values.lbo,
      accretionDilution: values.accretionDilution,
      sensitivity: values.sensitivity,
    };
    try {
      validateInputs(inputs);
    } catch (error) {
      translate(error);
    }
    return inputs;
  }

  private async present(tenant: TenantContext, record: ScenarioRecord) {
    const run = record.latestRun;
    const reasons = run
      ? staleReasons({
          resultAssumptionVersion: run.assumptionVersion,
          currentAssumptionVersion: record.scenario.assumptionVersion,
          adjustments: run.inputs.adjustments,
          current: await this.linkedStates(
            tenant,
            record.scenario.dealId,
            run.inputs.adjustments.map((adjustment) => adjustment.findingId),
          ),
        })
      : [];
    return {
      scenario: record.scenario,
      assumptions: this.currentAssumptions(record),
      assumptionVersions: record.assumptionSets.map(({ version, createdBy, createdAt }) => ({
        version,
        createdBy,
        createdAt,
      })),
      latestRun: run,
      stale: run ? reasons.length > 0 : null,
      staleReasons: reasons,
      submissions: record.submissions.map(({ canonical: _bytes, ...meta }) => meta),
      decisions: record.decisions,
    };
  }

  private async save(
    tenant: TenantContext,
    current: Scenario,
    next: Scenario,
    change: ScenarioChange,
    action: string,
    requestId: string,
  ) {
    const audit =
      change.kind === 'SUBMISSION'
        ? this.audit(tenant, next, action, requestId, 'valuation_submission', change.submission.id)
        : this.audit(tenant, next, action, requestId);
    if (!(await this.scenarios.commit(tenant, next, current.version, change, audit))) {
      throw new ConflictException();
    }
  }

  async list(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canReadValuation, {
      action: 'valuation.list',
      requestId,
    });
    const records = await this.scenarios.list(tenant, dealId);
    return { items: await Promise.all(records.map((record) => this.present(tenant, record))) };
  }

  async get(tenant: TenantContext, dealId: string, scenarioId: string, requestId: string) {
    await this.access.require(tenant, dealId, canReadValuation, {
      action: 'valuation.viewed',
      requestId,
    });
    return this.present(tenant, await this.load(tenant, dealId, scenarioId));
  }

  async create(tenant: TenantContext, dealId: string, body: CreateScenarioBody, requestId: string) {
    await this.access.require(tenant, dealId, canWriteValuation, {
      action: 'valuation.scenario.created',
      requestId,
    });
    const deal = await withTenant(this.prisma, tenant, (tx) => deals.get(tx, dealId));
    if (!deal) throw new NotFoundException();
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: newId(),
      organizationId: tenant.organizationId,
      dealId,
      name: body.name,
      currency: body.currency ?? deal.baseCurrency,
      transactionType: deal.transactionType,
      status: 'DRAFT',
      assumptionVersion: 1,
      createdBy: tenant.userId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.buildInputs(tenant, scenario, body.values);
    const assumptionSet: AssumptionSet = {
      scenarioId: scenario.id,
      version: 1,
      values: body.values,
      createdBy: tenant.userId,
      createdAt: now,
    };
    await this.scenarios.insert(
      tenant,
      scenario,
      assumptionSet,
      this.audit(tenant, scenario, 'valuation.scenario.created', requestId),
    );
    return this.get(tenant, dealId, scenario.id, requestId);
  }

  private requireDraft(record: ScenarioRecord, expectedVersion: number) {
    if (record.scenario.version !== expectedVersion) throw new ConflictException();
    // Submitted and approved scenarios are frozen.
    if (record.scenario.status !== 'DRAFT') throw new ConflictException();
  }

  async updateAssumptions(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    body: UpdateAssumptionsBody,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canWriteValuation, {
      action: 'valuation.assumptions.updated',
      requestId,
    });
    const record = await this.load(tenant, dealId, scenarioId);
    this.requireDraft(record, body.expectedVersion);
    const current = record.scenario;
    await this.buildInputs(tenant, current, body.values);
    const now = new Date().toISOString();
    const assumptionSet: AssumptionSet = {
      scenarioId,
      version: current.assumptionVersion + 1,
      values: body.values,
      createdBy: tenant.userId,
      createdAt: now,
    };
    const next: Scenario = {
      ...current,
      assumptionVersion: assumptionSet.version,
      updatedAt: now,
      version: current.version + 1,
    };
    await this.save(
      tenant,
      current,
      next,
      { kind: 'ASSUMPTIONS', assumptionSet },
      'valuation.assumptions.updated',
      requestId,
    );
    return this.get(tenant, dealId, scenarioId, requestId);
  }

  async run(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    body: VersionedCommandBody,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canWriteValuation, {
      action: 'valuation.run',
      requestId,
    });
    const record = await this.load(tenant, dealId, scenarioId);
    this.requireDraft(record, body.expectedVersion);
    const current = record.scenario;
    const inputs = await this.buildInputs(tenant, current, this.currentAssumptions(record).values);
    let result: ReturnType<typeof runValuation>;
    try {
      result = runValuation(inputs);
    } catch (error) {
      translate(error);
    }
    const now = new Date().toISOString();
    const run = {
      id: newId(),
      scenarioId,
      assumptionVersion: current.assumptionVersion,
      inputs,
      result,
      ranBy: tenant.userId,
      ranAt: now,
    };
    const next: Scenario = { ...current, updatedAt: now, version: current.version + 1 };
    await this.save(tenant, current, next, { kind: 'RUN', run }, 'valuation.run', requestId);
    return this.get(tenant, dealId, scenarioId, requestId);
  }

  /** Freeze the latest fresh run. A stale or missing result cannot be submitted. */
  async submit(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    body: VersionedCommandBody,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canWriteValuation, {
      action: 'valuation.submitted',
      requestId,
    });
    const record = await this.load(tenant, dealId, scenarioId);
    this.requireDraft(record, body.expectedVersion);
    const run = record.latestRun;
    if (!run) throw new UnprocessableEntityException('Run the scenario before submitting');
    const view = await this.present(tenant, record);
    if (view.stale) throw new ConflictException('Result is stale; re-run before submitting');

    const current = record.scenario;
    const now = new Date().toISOString();
    const submissionId = newId();
    const frozen = freeze({
      submissionId,
      engineVersion: VALUATION_ENGINE_VERSION,
      scenario: {
        id: current.id,
        organizationId: current.organizationId,
        dealId: current.dealId,
        name: current.name,
        currency: current.currency,
        transactionType: current.transactionType,
      },
      assumptionSet: this.currentAssumptions(record),
      run,
      submittedBy: tenant.userId,
      submittedAt: now,
    });
    const submission = {
      id: submissionId,
      scenarioId,
      runId: run.id,
      canonical: frozen.canonical,
      digest: frozen.digest,
      submittedBy: tenant.userId,
      submittedAt: now,
    };
    const next: Scenario = {
      ...current,
      status: 'SUBMITTED',
      updatedAt: now,
      version: current.version + 1,
    };
    await this.save(
      tenant,
      current,
      next,
      { kind: 'SUBMISSION', submission },
      'valuation.submitted',
      requestId,
    );
    return this.get(tenant, dealId, scenarioId, requestId);
  }

  /**
   * The frozen bytes exactly as stored, verified against their digest.
   * Reading a submission is an export and is audited.
   */
  async readSubmission(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    submissionId: string,
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canReadValuation, {
      action: 'valuation.submission.exported',
      requestId,
    });
    const submission = await this.scenarios.getSubmission(tenant, dealId, scenarioId, submissionId);
    if (!submission) throw new NotFoundException();
    if (!verifyFrozen(submission)) throw new InternalServerErrorException();
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'valuation.submission.exported',
        targetType: 'valuation_submission',
        targetId: submissionId,
        outcome: 'SUCCEEDED',
        requestId,
      }),
    );
    return { canonical: submission.canonical, digest: submission.digest };
  }

  /** Human approval or rejection; the submitter may not decide their own submission. */
  async decide(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    submissionId: string,
    body: DecideSubmissionBody,
    requestId: string,
  ) {
    const action = body.decision === 'APPROVED' ? 'valuation.approved' : 'valuation.rejected';
    const role = await this.access.require(tenant, dealId, canDecideValuation, {
      action,
      requestId,
    });
    const record = await this.load(tenant, dealId, scenarioId);
    const current = record.scenario;
    if (current.version !== body.expectedVersion) throw new ConflictException();
    const submission = record.submissions.find((candidate) => candidate.id === submissionId);
    if (!submission) throw new NotFoundException();
    if (current.status !== 'SUBMITTED' || record.submissions.at(-1)?.id !== submissionId) {
      throw new ConflictException();
    }
    if (submission.submittedBy === tenant.userId) throw new ForbiddenException();

    const now = new Date().toISOString();
    const decision = {
      id: newId(),
      submissionId,
      decision: body.decision,
      rationale: body.rationale,
      decidedBy: tenant.userId,
      decidedRole: role,
      decidedAt: now,
    };
    const next: Scenario = {
      ...current,
      status: body.decision === 'APPROVED' ? 'APPROVED' : 'DRAFT',
      updatedAt: now,
      version: current.version + 1,
    };
    await this.save(tenant, current, next, { kind: 'DECISION', decision }, action, requestId);
    return this.get(tenant, dealId, scenarioId, requestId);
  }
}
