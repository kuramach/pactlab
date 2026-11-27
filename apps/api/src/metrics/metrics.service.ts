import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  computeCohorts,
  computeSaasMetrics,
  METRIC_CALCULATORS,
  SAAS_METRICS_CALCULATOR,
  SOFTWARE_HISTORY_EVIDENCE,
  softwareHistoryReport,
  type MetricCalculator,
  type PackMetricsInput,
  type PackMetricsReport,
  draftFindingFor,
  prepareWorkspace,
  reconcileArr,
  type ArrReconciliation,
  type CohortReport,
  type DraftFinding,
  type SaasMetricsReport,
} from '@pactlab/calculations';
import {
  appendAuditEvent,
  withTenant,
  type Prisma,
  type PrismaClient,
  type TransactionClient,
} from '@pactlab/db';
import {
  isBuyerSideRole,
  packFor,
  permissionsForDealRole,
  type DealRole,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import {
  defaultAsOfMonth,
  loadMetricsEvidence,
  reportedArrFor,
  TooMuchEvidenceError,
  type MetricsEvidence,
} from './metrics.inputs';

const AGGREGATE = 'metrics_reconciliation';
const APPROVED_EVENT = 'metrics.reconciliation.approved';

/** Metrics are buyer analysis: target contributors never see them. */
/** Above this, pack metrics refuse rather than read a partial evidence set. */

const canReadMetrics = (role: DealRole) =>
  isBuyerSideRole(role) && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Analysts and leads record reconciliations. */
const canRunReconciliation = (role: DealRole) =>
  canReadMetrics(role) && permissionsForDealRole(role).has('DEAL_WRITE');
/** Only a reviewer or the deal lead approves a difference. */
const canApproveReconciliation = (role: DealRole) => role === 'DEAL_LEAD' || role === 'REVIEWER';

export interface ReconciliationApproval {
  status: 'PENDING' | 'APPROVED' | 'STALE' | 'NOT_REQUIRED';
  reconciliationId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
}

/** The history start the pack report was computed with (T-185), and a year to prefill it with when none is set. */
export interface HistoryStartView {
  readonly year: number | null;
  readonly suggested: { readonly year: number; readonly from: string } | null;
}

export type PackMetricsView = PackMetricsReport & { readonly historyStart: HistoryStartView };

export interface MetricsSummary {
  report: SaasMetricsReport;
  reconciliation: ArrReconciliation;
  draftFinding: DraftFinding | null;
  draftFindingRecorded: boolean;
  approval: ReconciliationApproval;
}

interface Computed {
  asOfMonth: string;
  report: SaasMetricsReport;
  reconciliation: ArrReconciliation;
  draftFinding: DraftFinding | null;
  cohorts: () => CohortReport;
}

function compute(evidence: MetricsEvidence, asOf: string | undefined): Computed {
  const asOfMonth = asOf ?? defaultAsOfMonth(evidence);
  const input = {
    lines: evidence.lines,
    fxRates: evidence.fxRates,
    baseCurrency: evidence.baseCurrency,
    asOfMonth,
  };
  const ws = prepareWorkspace(input);
  const report = computeSaasMetrics(input, ws);
  const reconciliation = reconcileArr(ws, report, reportedArrFor(evidence, asOfMonth));
  return {
    asOfMonth,
    report,
    reconciliation,
    draftFinding: draftFindingFor(reconciliation),
    cohorts: () => computeCohorts(input, ws),
  };
}

const RECONCILABLE = new Set(['RECONCILED', 'DIFFERENCE']);

/** Plain JSON copy for outbox payloads (drops undefined, keeps decimal strings as strings). */
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * SaaS metrics and ARR reconciliation. Every figure is recomputed from
 * current evidence by the deterministic engine; reviewer decisions are
 * append-only audit and outbox events bound to the reconciliation's content
 * hash, so changed evidence makes an earlier approval visibly stale.
 */
@Injectable()
export class MetricsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async load(tx: TransactionClient, dealId: string, asOf: string | undefined) {
    let evidence: MetricsEvidence | null;
    try {
      evidence = await loadMetricsEvidence(tx, dealId);
    } catch (error) {
      if (error instanceof TooMuchEvidenceError)
        throw new UnprocessableEntityException('Too many billing records for one computation');
      throw error;
    }
    if (!evidence) throw new NotFoundException();
    return compute(evidence, asOf);
  }

  /**
   * The deal's pack metrics (T-059): the pack's calculator over its imported
   * extracts, as labelled figures with formulas. The software pack's SaaS
   * metrics stay on `summary`; for it this returns an empty list.
   */
  async packMetrics(tenant: TenantContext, dealId: string, requestId: string): Promise<PackMetricsView> {
    await this.access.require(tenant, dealId, canReadMetrics, { action: 'metrics.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { baseCurrency: true, historyStartYear: true } });
      if (!deal) throw new NotFoundException();
      const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
      const calculator = METRIC_CALCULATORS[packFor(seller?.companyType ?? null).metricCalculator];
      const historyStart = await this.historyStartOf(tx, dealId, deal.historyStartYear);
      // Software (T-184b): the SaaS engine's figures are on their own screen; the pack report carries the years.
      const saas = !calculator || calculator.id === SAAS_METRICS_CALCULATOR.id;
      let evidence;
      try {
        evidence = await loadPackEvidence(tx, dealId, saas ? SOFTWARE_HISTORY_EVIDENCE : calculator.evidenceTypes);
      } catch (error) {
        // A billing ledger too large for one read keeps the SaaS screen; the years are left out rather than failing it.
        if (error instanceof TooMuchPackEvidenceError && saas) return { calculator: SAAS_METRICS_CALCULATOR.id, version: SAAS_METRICS_CALCULATOR.version, currency: deal.baseCurrency, metrics: [], historyStart };
        if (error instanceof TooMuchPackEvidenceError) throw new PayloadTooLargeException('Too much evidence for one metrics run');
        throw error;
      }
      await this.audit(tx, tenant, dealId, 'metrics.viewed', 'deal', dealId, requestId);
      const input: PackMetricsInput = { currency: deal.baseCurrency, evidence, historyStartYear: deal.historyStartYear };
      const report = saas ? softwareHistoryReport(input, SAAS_METRICS_CALCULATOR) : (calculator as unknown as MetricCalculator<PackMetricsInput, PackMetricsReport>).compute(input);
      return { ...report, historyStart };
    });
  }

  /**
   * The pact's history start (T-185) and, while none is set, a year a pack field already holds to prefill it with:
   * the year built from an accepted property profile. The suggestion is never applied until a person saves it.
   */
  private async historyStartOf(tx: TransactionClient, dealId: string, year: number | null): Promise<HistoryStartView> {
    if (year !== null) return { year, suggested: null };
    const profile = await tx.dealPropertyProfile.findFirst({ where: { dealId }, select: { accepted: true } });
    const built = (profile?.accepted as Record<string, { value?: unknown } | undefined> | null)?.['year_built']?.value;
    const suggested = typeof built === 'number' ? built : typeof built === 'string' && /^\d{4}$/.test(built) ? Number(built) : null;
    return { year: null, suggested: suggested !== null ? { year: suggested, from: 'Year built, from the property profile' } : null };
  }

  /** Sets or clears the history start (T-185): the deal lead or an analyst; audited. */
  async setHistoryStart(tenant: TenantContext, dealId: string, year: number | null, requestId: string): Promise<{ historyStartYear: number | null }> {
    const action = year === null ? 'deal.history_start_cleared' : 'deal.history_start_set';
    await this.access.require(tenant, dealId, canRunReconciliation, { action, requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.deal.updateMany({ where: { id: dealId }, data: { historyStartYear: year } });
      if (updated.count === 0) throw new NotFoundException();
      await this.audit(tx, tenant, dealId, action, 'deal', dealId, requestId);
      return { historyStartYear: year };
    });
  }

  async summary(
    tenant: TenantContext,
    dealId: string,
    asOf: string | undefined,
    requestId: string,
  ): Promise<MetricsSummary> {
    await this.access.require(tenant, dealId, canReadMetrics, {
      action: 'metrics.viewed',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => {
      const computed = await this.load(tx, dealId, asOf);
      await this.audit(tx, tenant, dealId, 'metrics.viewed', 'deal', dealId, requestId);
      return this.view(tx, dealId, computed);
    });
  }

  async cohorts(
    tenant: TenantContext,
    dealId: string,
    asOf: string | undefined,
    requestId: string,
  ): Promise<CohortReport> {
    await this.access.require(tenant, dealId, canReadMetrics, {
      action: 'metrics.viewed',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => {
      const computed = await this.load(tx, dealId, asOf);
      await this.audit(tx, tenant, dealId, 'metrics.viewed', 'deal', dealId, requestId);
      return computed.cohorts();
    });
  }

  /**
   * Record a reconciliation run. A difference outside tolerance is proposed
   * as a DRAFT finding (outbox, idempotent per reconciliation) for the
   * findings workflow; nothing is accepted without a human reviewer.
   */
  async reconcile(
    tenant: TenantContext,
    dealId: string,
    asOf: string | undefined,
    requestId: string,
  ): Promise<MetricsSummary> {
    await this.access.require(tenant, dealId, canRunReconciliation, {
      action: 'metrics.reconciliation.recorded',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => {
      const computed = await this.load(tx, dealId, asOf);
      await this.record(tx, tenant, dealId, computed, requestId);
      return this.view(tx, dealId, computed);
    });
  }

  async approve(
    tenant: TenantContext,
    dealId: string,
    reconciliationId: string,
    command: { asOf: string; note: string },
    requestId: string,
  ): Promise<MetricsSummary> {
    await this.access.require(tenant, dealId, canApproveReconciliation, {
      action: 'metrics.reconciliation.approved',
      requestId,
    });
    return withTenant(this.prisma, tenant, async (tx) => {
      const computed = await this.load(tx, dealId, command.asOf);
      const { reconciliation } = computed;
      if (reconciliation.reconciliationId !== reconciliationId)
        throw new ConflictException('Evidence changed since this reconciliation was computed');
      if (!RECONCILABLE.has(reconciliation.status))
        throw new UnprocessableEntityException('There is no reported figure to reconcile');
      await this.record(tx, tenant, dealId, computed, requestId);
      const created = await tx.outboxEvent.createMany({
        data: [
          {
            organizationId: tenant.organizationId,
            dealId,
            aggregateType: AGGREGATE,
            aggregateId: reconciliationId,
            eventType: APPROVED_EVENT,
            idempotencyKey: `${AGGREGATE}:${reconciliationId}:approved`,
            payload: json({
              reconciliationId,
              asOfMonth: reconciliation.asOfMonth,
              engineVersion: reconciliation.engineVersion,
              status: reconciliation.status,
              reported: reconciliation.reported?.value ?? null,
              calculated: reconciliation.calculated,
              delta: reconciliation.delta,
              deltaRatio: reconciliation.deltaRatio,
              note: command.note,
              approvedBy: tenant.userId,
              approvedAt: new Date().toISOString(),
            }),
          },
        ],
        skipDuplicates: true,
      });
      if (created.count > 0)
        await this.audit(
          tx,
          tenant,
          dealId,
          APPROVED_EVENT,
          AGGREGATE,
          reconciliationId,
          requestId,
        );
      return this.view(tx, dealId, computed);
    });
  }

  private async record(
    tx: TransactionClient,
    tenant: TenantContext,
    dealId: string,
    computed: Computed,
    requestId: string,
  ): Promise<void> {
    const { reconciliation, draftFinding } = computed;
    const id = reconciliation.reconciliationId;
    const events: Prisma.OutboxEventCreateManyInput[] = [
      {
        organizationId: tenant.organizationId,
        dealId,
        aggregateType: AGGREGATE,
        aggregateId: id,
        eventType: 'metrics.reconciliation.recorded',
        idempotencyKey: `${AGGREGATE}:${id}:recorded`,
        payload: json({
          reconciliationId: id,
          asOfMonth: reconciliation.asOfMonth,
          status: reconciliation.status,
          engineVersion: reconciliation.engineVersion,
          calculated: reconciliation.calculated,
          reported: reconciliation.reported?.value ?? null,
          delta: reconciliation.delta,
        }),
      },
    ];
    if (draftFinding) {
      events.push({
        organizationId: tenant.organizationId,
        dealId,
        aggregateType: AGGREGATE,
        aggregateId: id,
        eventType: 'finding.draft_proposed',
        idempotencyKey: `${AGGREGATE}:${id}:draft_finding`,
        payload: json(draftFinding),
      });
    }
    const created = await tx.outboxEvent.createMany({ data: events, skipDuplicates: true });
    if (created.count > 0)
      await this.audit(
        tx,
        tenant,
        dealId,
        'metrics.reconciliation.recorded',
        AGGREGATE,
        id,
        requestId,
      );
  }

  private async view(
    tx: TransactionClient,
    dealId: string,
    computed: Computed,
  ): Promise<MetricsSummary> {
    const { reconciliation } = computed;
    const id = reconciliation.reconciliationId;
    const events = await tx.outboxEvent.findMany({
      where: {
        dealId,
        aggregateType: AGGREGATE,
        OR: [
          { eventType: APPROVED_EVENT },
          { aggregateId: id, eventType: 'finding.draft_proposed' },
        ],
      },
      select: { aggregateId: true, eventType: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const approvals = events.filter(
      (event) =>
        event.eventType === APPROVED_EVENT &&
        (event.payload as { asOfMonth?: string } | null)?.asOfMonth === computed.asOfMonth,
    );
    const current = approvals.find((event) => event.aggregateId === id);
    const shown = current ?? approvals[0];
    const payload = (shown?.payload ?? {}) as { approvedBy?: string; note?: string };
    const approval: ReconciliationApproval = {
      status: current
        ? 'APPROVED'
        : shown
          ? 'STALE'
          : RECONCILABLE.has(reconciliation.status)
            ? 'PENDING'
            : 'NOT_REQUIRED',
      reconciliationId: shown?.aggregateId ?? null,
      approvedBy: payload.approvedBy ?? null,
      approvedAt: shown?.createdAt.toISOString() ?? null,
      note: payload.note ?? null,
    };
    return {
      report: computed.report,
      reconciliation,
      draftFinding: computed.draftFinding,
      draftFindingRecorded: events.some((event) => event.eventType === 'finding.draft_proposed'),
      approval,
    };
  }

  private async audit(
    tx: TransactionClient,
    tenant: TenantContext,
    dealId: string,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
  ): Promise<void> {
    await appendAuditEvent(tx, {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType,
      targetId,
      outcome: 'SUCCEEDED',
      requestId,
    });
  }
}
