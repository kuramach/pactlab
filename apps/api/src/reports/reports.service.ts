import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ReportVersionView } from '@pactlab/contracts';
import { appendAuditEvent, reportVersions, withTenant, type PrismaClient, type ReportScope, type ReportVersionRecord } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { ConnectionsService } from '../connections/connections.service';
import { DealsService } from '../deals/deals.service';
import type { DocumentObjectStore } from '../documents/documents.repository';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { PhasesService } from '../phases/phases.service';
import { PricingService } from '../pricing/pricing.service';
import { LOGGER, PRISMA } from '../tokens';
import { ValuationService } from '../valuation/valuation.service';
import { executiveReportModel, pactReportModel, type ReportSources } from './report-model';
import { executiveReportPdf, pactReportPdf, type CommitteeRecord } from './report-pdf';

export const REPORT_STORE = Symbol('REPORT_STORE');

/**
 * Reports (T-110): versioned PDF snapshots. Each generation is a new immutable version, built in
 * the background from the generating user's own view of the data (so it holds exactly what their
 * organization may see), stored once under its own key, and audited when made and downloaded.
 */
@Injectable()
export class ReportsService {
  private readonly running = new Set<Promise<void>>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(REPORT_STORE) private readonly store: DocumentObjectStore,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(ValuationService) private readonly valuation: ValuationService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(PhasesService) private readonly phases: PhasesService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(ConnectionsService) private readonly connections: ConnectionsService,
  ) {}

  private sources(requestId: string): ReportSources {
    return {
      deal: (tenant, dealId) => this.deals.get(tenant, dealId) as never,
      deals: (tenant) => this.deals.list(tenant) as never,
      findings: (tenant, dealId) => this.findings.list(tenant, dealId, {} as never, requestId) as never,
      valuation: (tenant, dealId) => this.valuation.list(tenant, dealId, requestId) as never,
      pricing: (tenant, dealId) => this.pricing.view(tenant, dealId, requestId) as never,
      terms: (tenant, dealId) => this.pricing.proposedTerms(tenant, dealId, requestId) as never,
      claims: (tenant, dealId) => this.phases.claims(tenant, dealId, requestId) as never,
      postClose: (tenant, dealId) => this.phases.postClose(tenant, dealId, requestId) as never,
      documents: (tenant, dealId) => this.documents.list(tenant, dealId, requestId) as never,
      connections: (tenant, dealId) => this.connections.list(tenant, dealId, requestId) as never,
    };
  }

  private view(record: ReportVersionRecord, dealName: string | null): ReportVersionView {
    return {
      id: record.id,
      scope: record.scope,
      dealId: record.dealId,
      dealName,
      version: record.version,
      status: record.status,
      generatedAt: record.generatedAt.toISOString(),
      generatedByName: record.generatedByName,
      dataAsOf: record.dataAsOf.toISOString(),
      byteSize: record.byteSize,
      sha256: record.sha256,
      captured: record.captured,
    };
  }

  private audit(tenant: TenantContext, action: string, record: ReportVersionRecord, requestId: string) {
    return withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId: record.dealId,
        actorUserId: tenant.userId,
        action,
        targetType: 'report_version',
        targetId: record.id,
        outcome: 'SUCCEEDED',
        requestId,
      }),
    );
  }

  /** Start a new version; it is generated in the background (GENERATING -> READY or FAILED). */
  async generate(tenant: TenantContext, scope: ReportScope, dealId: string | null, requestId: string, options: { icBlockers?: string[] } = {}): Promise<ReportVersionView> {
    // A detailed report (or an IC pack) needs the pact to be visible to the caller (404 otherwise, as everywhere).
    const perPact = scope !== 'EXECUTIVE';
    const deal = perPact && dealId ? await this.deals.get(tenant, dealId) : null;
    if (perPact && !deal) throw new NotFoundException();
    const record = await withTenant(this.prisma, tenant, (tx) =>
      reportVersions.begin(tx, { organizationId: tenant.organizationId, scope, dealId: perPact ? dealId : null, generatedBy: tenant.userId, dataAsOf: new Date() }),
    );
    await this.audit(tenant, scope === 'IC' ? 'ic.pack_generated' : 'report.generated', record, requestId);
    const job = this.build(tenant, record, requestId, options.icBlockers ?? []).finally(() => this.running.delete(job));
    this.running.add(job);
    return this.view(record, deal?.name ?? null);
  }

  /**
   * The investment committee's record on the pact (T-118). Row-level security shows it to the
   * pact's own side only, so a seller's report simply has none.
   */
  private async committee(tenant: TenantContext, dealId: string): Promise<CommitteeRecord | null> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const submissions = await tx.icSubmission.findMany({ where: { dealId }, orderBy: { submittedAt: 'asc' } });
      if (submissions.length === 0) return null;
      const [decisions, conditions, versions] = await Promise.all([
        tx.icDecision.findMany({ where: { dealId } }),
        tx.icCondition.findMany({ where: { dealId }, orderBy: { ordinal: 'asc' } }),
        tx.reportVersion.findMany({ where: { id: { in: submissions.map((row) => row.reportVersionId) } }, select: { id: true, version: true } }),
      ]);
      const people = new Map(
        (await tx.user.findMany({ where: { id: { in: [...submissions.map((row) => row.submittedBy), ...decisions.map((row) => row.decidedBy)] } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName]),
      );
      return {
        submissions: submissions.map((submission) => {
          const decision = decisions.find((row) => row.submissionId === submission.id) ?? null;
          return {
            version: versions.find((row) => row.id === submission.reportVersionId)?.version ?? 0,
            submittedAt: submission.submittedAt.toISOString(),
            submittedByName: people.get(submission.submittedBy) ?? null,
            decision: decision ? { decision: decision.decision, note: decision.note, decidedByName: people.get(decision.decidedBy) ?? null, decidedAt: decision.decidedAt.toISOString() } : null,
            conditions: decision ? conditions.filter((row) => row.decisionId === decision.id).map((row) => ({ text: row.text, status: row.status })) : [],
          };
        }),
      };
    });
  }

  /** Tests and graceful shutdown: wait for background generations. */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private async build(tenant: TenantContext, record: ReportVersionRecord, requestId: string, icBlockers: readonly string[]): Promise<void> {
    try {
      const organization = await withTenant(this.prisma, tenant, (tx) => tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }));
      const stamp = {
        organizationName: organization?.name ?? 'Your organization',
        version: record.version,
        generatedAt: record.generatedAt,
        generatedByName: record.generatedByName ?? 'a team member',
        dataAsOf: record.dataAsOf,
      };
      let pdf: { bytes: Uint8Array; sha256: string };
      let captured: Record<string, unknown>;
      if (record.scope !== 'EXECUTIVE' && record.dealId) {
        const model = await pactReportModel(this.sources(requestId), tenant, record.dealId);
        if (!model) throw new Error('pact no longer visible');
        const ic = record.scope === 'IC';
        pdf = await pactReportPdf(
          model,
          { ...stamp, title: `${ic ? 'Investment committee pack' : 'Pact report'}: ${model.deal.name}`, subtitle: `${model.deal.targetName} · ${model.sideLabel}` },
          { committee: await this.committee(tenant, record.dealId), ...(ic ? { icPack: { blockers: [...icBlockers] } } : {}) },
        );
        captured = { ...model.captured, ...(ic ? { icBlockers: [...icBlockers] } : {}) };
      } else {
        const model = await executiveReportModel(this.sources(requestId), tenant);
        pdf = await executiveReportPdf(model, { ...stamp, title: 'Executive report', subtitle: `All pacts · ${stamp.organizationName}` });
        captured = model.captured;
      }
      // Each version has its own key: an earlier version's bytes are never touched.
      const objectKey =
        record.scope !== 'EXECUTIVE' && record.dealId
          ? `${record.organizationId}/${record.dealId}/reports/${record.id}.pdf`
          : `${record.organizationId}/${record.id}/executive-report.pdf`;
      await this.store.put(objectKey, pdf.bytes, { contentType: 'application/pdf', sha256: pdf.sha256 } as never);
      await withTenant(this.prisma, tenant, (tx) => reportVersions.ready(tx, record.id, { objectKey, sha256: pdf.sha256, byteSize: pdf.bytes.byteLength, captured }));
    } catch (error) {
      this.logger.error({ reportId: record.id, errorClass: error instanceof Error ? error.name : 'unknown' }, 'report generation failed');
      await withTenant(this.prisma, tenant, (tx) => reportVersions.failed(tx, record.id)).catch(() => undefined);
    }
  }

  async history(tenant: TenantContext, filter: { scope?: ReportScope; dealId?: string }): Promise<{ items: ReportVersionView[] }> {
    const records = await withTenant(this.prisma, tenant, (tx) => reportVersions.history(tx, filter));
    const dealIds = [...new Set(records.flatMap((record) => (record.dealId ? [record.dealId] : [])))];
    const names = new Map(
      (await withTenant(this.prisma, tenant, (tx) => tx.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } }))).map((deal) => [deal.id, deal.name]),
    );
    return { items: records.map((record) => this.view(record, record.dealId ? (names.get(record.dealId) ?? null) : null)) };
  }

  /** The stored PDF of a READY version, audited. 404 for anything the caller cannot see. */
  async download(tenant: TenantContext, id: string, requestId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const record = await withTenant(this.prisma, tenant, (tx) => reportVersions.get(tx, id));
    if (!record || record.status !== 'READY' || !record.objectKey) throw new NotFoundException();
    let bytes: Uint8Array;
    try {
      bytes = await this.store.get(record.objectKey);
    } catch {
      throw new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE' });
    }
    await this.audit(tenant, 'report.downloaded', record, requestId);
    const fileName = `${record.scope === 'PACT' ? 'pact-report' : record.scope === 'IC' ? 'ic-pack' : 'executive-report'}-v${record.version}-${record.dataAsOf.toISOString().slice(0, 10)}.pdf`;
    return { bytes, fileName };
  }
}
