import type {
  AccretionDilutionAssumptions,
  AdjustmentPoint,
  BridgeAssumptions,
  LboAssumptions,
  MethodAssumptions,
  SensitivitySpec,
  ValuationInputs,
  ValuationResult,
  ValuationTransactionType,
} from '@pactlab/calculations';
import type { AuditEventInput } from '@pactlab/db';
import type { DealRole, TenantContext } from '@pactlab/domain';

export const VALUATION_REPOSITORY = Symbol('VALUATION_REPOSITORY');

/**
 * DRAFT scenarios are editable. Submission freezes the latest run; a
 * rejected submission returns the scenario to DRAFT, an approved one is final.
 */
export const SCENARIO_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export interface Scenario {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly name: string;
  readonly currency: string;
  readonly transactionType: ValuationTransactionType;
  readonly status: ScenarioStatus;
  /** Version of the current assumption set. */
  readonly assumptionVersion: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic-concurrency version; every change increments it. */
  readonly version: number;
}

/** A scenario links accepted findings; the run resolves each to its priced risk. */
export interface FindingLink {
  readonly findingId: string;
  readonly point: AdjustmentPoint;
}

export interface ScenarioAssumptions {
  readonly assumptions: MethodAssumptions;
  readonly bridge: BridgeAssumptions;
  readonly stockConsiderationShare: string;
  readonly findingLinks: readonly FindingLink[];
  readonly lbo: LboAssumptions | null;
  readonly accretionDilution: AccretionDilutionAssumptions | null;
  readonly sensitivity: SensitivitySpec | null;
}

/** One immutable version of a scenario's assumptions; edits append a new version. */
export interface AssumptionSet {
  readonly scenarioId: string;
  readonly version: number;
  readonly values: ScenarioAssumptions;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** One engine run: the full resolved input set and the result it produced. */
export interface ValuationRun {
  readonly id: string;
  readonly scenarioId: string;
  readonly assumptionVersion: number;
  readonly inputs: ValuationInputs;
  readonly result: ValuationResult;
  readonly ranBy: string;
  readonly ranAt: string;
}

/** A frozen submission. `canonical` is stored and returned byte-for-byte. */
export interface Submission {
  readonly id: string;
  readonly scenarioId: string;
  readonly runId: string;
  readonly canonical: string;
  readonly digest: string;
  readonly submittedBy: string;
  readonly submittedAt: string;
}

export const SUBMISSION_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type SubmissionDecisionKind = (typeof SUBMISSION_DECISIONS)[number];

/** Append-only human decision on a submission. */
export interface SubmissionDecision {
  readonly id: string;
  readonly submissionId: string;
  readonly decision: SubmissionDecisionKind;
  readonly rationale: string;
  readonly decidedBy: string;
  readonly decidedRole: DealRole;
  readonly decidedAt: string;
}

export interface ScenarioRecord {
  readonly scenario: Scenario;
  /** Oldest first; append-only. */
  readonly assumptionSets: readonly AssumptionSet[];
  readonly latestRun: ValuationRun | null;
  /** Oldest first; append-only. */
  readonly submissions: readonly Submission[];
  readonly decisions: readonly SubmissionDecision[];
}

export type ScenarioChange =
  | { readonly kind: 'ASSUMPTIONS'; readonly assumptionSet: AssumptionSet }
  | { readonly kind: 'RUN'; readonly run: ValuationRun }
  | { readonly kind: 'SUBMISSION'; readonly submission: Submission }
  | { readonly kind: 'DECISION'; readonly decision: SubmissionDecision };

/**
 * Persistence port for scenarios. Implementations run every call inside the
 * caller's tenant context (RLS), write the supplied audit event in the same
 * transaction, and never update or delete assumption sets, runs,
 * submissions or decisions once written.
 */
export interface ValuationRepository {
  list(tenant: TenantContext, dealId: string): Promise<ScenarioRecord[]>;
  get(tenant: TenantContext, dealId: string, scenarioId: string): Promise<ScenarioRecord | null>;
  getSubmission(
    tenant: TenantContext,
    dealId: string,
    scenarioId: string,
    submissionId: string,
  ): Promise<Submission | null>;
  insert(
    tenant: TenantContext,
    scenario: Scenario,
    assumptionSet: AssumptionSet,
    audit: AuditEventInput,
  ): Promise<void>;
  /**
   * Save `scenario` and append `change` atomically. Returns false when
   * `expectedVersion` is stale (optimistic concurrency).
   */
  commit(
    tenant: TenantContext,
    scenario: Scenario,
    expectedVersion: number,
    change: ScenarioChange,
    audit: AuditEventInput,
  ): Promise<boolean>;
}
