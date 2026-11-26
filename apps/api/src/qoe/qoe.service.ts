import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PNL_EBITDA_BASIS, PNL_READER_VERSION } from '@pactlab/calculations';
import { citationStillValid, PROHIBITED_CLASSIFICATIONS, SourceIndex, type CitableSource } from '@pactlab/ai';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  canReviewFindings,
  newId,
  permissionsForDealRole,
  QOE_ADD_BACK_EVIDENCE_TYPE,
  QOE_ADJUSTMENT_EVIDENCE_TYPE,
  QOE_CATEGORY_REGISTRY,
  QOE_DISCLAIMER,
  QOE_PNL_CONFLICT_EVIDENCE_TYPE,
  QOE_VERIFICATION_LABELS,
  qoeDirectionFor,
  type DealRole,
  type DocumentCitation,
  type FindingEvidenceLink,
  type ProposedFinding,
  type QoeAdjustmentCategory,
  type QoeInclusionDecision,
  type QoeRecurrence,
  type QoeVerificationStatus,
  type QoeWorkingCapitalComponent,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
import { PricingService } from '../pricing/pricing.service';
import { PRISMA } from '../tokens';
import { filesOf, loadImportedPnl, type PnlSourceFile } from './pnl-evidence';
import {
  adjustedEbitdaSchedule,
  QOE_ENGINE_VERSION,
  workingCapitalAnalysis,
  type AddBackInput,
  type AdjustmentInput,
  type PeriodSchedule,
  type PnlConflict,
  type ReportedEbitdaInput,
  type WorkingCapitalAnalysis,
  type WorkingCapitalInput,
} from './qoe-engine';
import type { QoeCitationInput, QoeDecisionBody, QoeEntryBody, QoeReviseBody, QoeWithdrawBody } from './qoe.schemas';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
/** Findings cite only these classes (the same set pack rules read). */
const CITABLE = new Set(['PUBLIC', 'BUSINESS', 'FINANCIAL']);

type StoredCitation = Omit<DocumentCitation, never>;
type Row = Awaited<ReturnType<TransactionClient['qoeEntry']['findMany']>>[number];

/** How a citation shows: the page it points at and whether its quote is still there. */
export interface CitationView {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
  valid: boolean;
}

export interface QoeEntryMeta {
  entryKey: string;
  version: number;
  kind: string;
  findingId: string | null;
  citation: CitationView;
  verificationCitation: CitationView | null;
  decisionReason: string | null;
  updatedAt: string;
}

/** A period of the schedule, with the files its imported figures were read from. */
export type QoeSchedulePeriod = PeriodSchedule & { pnlFiles: PnlSourceFile[] };

/** A disagreement between the imported P&L and a filed statement, and the finding it became (if raised). */
export type QoeConflictView = PnlConflict & { fingerprint: string; findingId: string | null };

export interface QoeView {
  disclaimer: string;
  engineVersion: string;
  currency: string;
  canEdit: boolean;
  canDecide: boolean;
  schedule: QoeSchedulePeriod[];
  /** The imported P&L the schedule reads (T-149): its reader version, how EBITDA is read, and its files. */
  importedPnl: { readerVersion: string; ebitdaBasis: string; periods: number; files: PnlSourceFile[] };
  /** Every period where the imported P&L and a filed statement disagree: findings to review, never a silent pick. */
  conflicts: QoeConflictView[];
  /** Every seller-claimed add-back, across periods: the register. */
  register: PeriodSchedule['addBacks'];
  workingCapital: WorkingCapitalAnalysis;
  /** Per entry: its version, citation state and the finding it became. */
  entries: QoeEntryMeta[];
}

/** Idempotent: the same disagreement (same filed version, same imported figure) drafts one finding. */
const conflictFingerprint = (conflict: PnlConflict) => `qoe:pnl-conflict:${conflict.filedEntry.entryKey}:v${conflict.filedEntry.version}:${conflict.imported}`;
/** How many of a conflicting period's imported rows the finding links; the description gives the full count. */
const CONFLICT_ROW_LINKS = 25;

const amountString = (value: { toFixed(digits: number): string }) => value.toFixed(4).replace(/\.?0+$/, '') || '0';

/**
 * The quality-of-earnings work product (T-135): cited entries in, a deterministic schedule,
 * register and working-capital analysis out. Every adjustment and add-back is drafted as a
 * finding whose direction comes from the QoE direction rules; that finding — accepted and
 * priced by a person — is its only route to the valuation bridge. The peg reaches the seller
 * only as a deal term. Buyer-side analysis throughout (RLS and BUYER_ANALYSIS_READ).
 */
@Injectable()
export class QoeService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  /** Verify a quote against the stored page; never people data, never a purged document. */
  private async verify(tx: TransactionClient, dealId: string, source: QoeCitationInput): Promise<StoredCitation> {
    const page = await tx.documentPage.findFirst({
      where: { dealId, documentId: source.documentId, pageNumber: source.pageNumber },
      select: { text: true, document: { select: { fileName: true, dataClass: true, status: true } } },
    });
    if (!page || page.text === null || page.document.status !== 'AVAILABLE') throw new UnprocessableEntityException({ code: 'PAGE_UNAVAILABLE', message: 'That document page is not available' });
    if (PROHIBITED.has(page.document.dataClass) || !CITABLE.has(page.document.dataClass)) {
      throw new UnprocessableEntityException({ code: 'PEOPLE_DATA', message: 'That document cannot be cited for the QoE work product' });
    }
    const citable: CitableSource = { citationId: `${source.documentId}:${source.pageNumber}`, documentId: source.documentId, documentName: page.document.fileName, pageNumber: source.pageNumber, text: page.text, classification: page.document.dataClass };
    const check = new SourceIndex([citable]).verify({ citationId: citable.citationId, quote: source.quote });
    if (!check.ok) throw new UnprocessableEntityException({ code: check.reason, message: `Citation refused: ${check.reason}` });
    const { citationId: _id, ...citation } = check.citation;
    return citation as StoredCitation;
  }

  /** The latest version of every entry, withdrawn ones dropped. */
  private async current(tx: TransactionClient, dealId: string): Promise<Row[]> {
    // whole-set: the schedule, register and peg are calculated from every current entry of the pact
    const rows = await tx.qoeEntry.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { version: 'asc' }] });
    const latest = new Map<string, Row>();
    for (const row of rows) if ((latest.get(row.entryKey)?.version ?? 0) < row.version) latest.set(row.entryKey, row);
    return [...latest.values()].filter((row) => !row.withdrawn);
  }

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<QoeView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'qoe.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true } });
      if (!deal) throw new NotFoundException();
      const rows = await this.current(tx, dealId);
      const cited = rows.flatMap((row) => [row.citation, row.verificationCitation].filter(Boolean) as unknown as StoredCitation[]);
      // bounded: the pages the entries above cite (one per figure)
      const pages = cited.length
        ? await tx.documentPage.findMany({
            where: { dealId, OR: cited.map((citation) => ({ documentId: citation.documentId, pageNumber: citation.pageNumber })) },
            select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, status: true } } },
          })
        : [];
      const show = (raw: unknown): CitationView => {
        const citation = raw as StoredCitation;
        const page = pages.find((candidate) => candidate.documentId === citation.documentId && candidate.pageNumber === citation.pageNumber);
        return {
          documentId: citation.documentId,
          documentName: page?.document.fileName ?? null,
          pageNumber: citation.pageNumber,
          quote: citation.quote,
          valid: page?.text != null && page.document.status === 'AVAILABLE' && citationStillValid({ citationId: '', ...citation }, page.text),
        };
      };
      const cite = (row: Row) => {
        const citation = row.citation as unknown as StoredCitation;
        return { entryKey: row.entryKey, version: row.version, citation: { documentId: citation.documentId, pageNumber: citation.pageNumber, quote: citation.quote } };
      };
      const reported: ReportedEbitdaInput[] = rows.filter((row) => row.kind === 'REPORTED_EBITDA').map((row) => ({ ...cite(row), period: row.period ?? '', label: row.label, amount: amountString(row.amount), currency: row.currency }));
      const adjustments: AdjustmentInput[] = rows
        .filter((row) => row.kind === 'ADJUSTMENT')
        .map((row) => ({ ...cite(row), period: row.period ?? '', category: row.category as QoeAdjustmentCategory, label: row.label, amount: amountString(row.amount), currency: row.currency, rationale: row.rationale, findingId: row.findingId }));
      const addBacks: AddBackInput[] = rows
        .filter((row) => row.kind === 'ADD_BACK')
        .map((row) => {
          const verification = row.verificationCitation as unknown as StoredCitation | null;
          return {
            ...cite(row),
            period: row.period ?? '',
            category: row.category as QoeAdjustmentCategory,
            label: row.label,
            claimed: amountString(row.amount),
            currency: row.currency,
            sellerRationale: row.rationale,
            status: row.verificationStatus as QoeVerificationStatus,
            verified: row.verifiedAmount ? amountString(row.verifiedAmount) : null,
            verificationCitation: verification ? { documentId: verification.documentId, pageNumber: verification.pageNumber, quote: verification.quote } : null,
            recurrence: row.recurrence as QoeRecurrence,
            inclusion: row.inclusion as QoeInclusionDecision | null,
            decisionReason: row.decisionReason,
            findingId: row.findingId,
          };
        });
      const lines: WorkingCapitalInput[] = rows
        .filter((row) => row.kind === 'WORKING_CAPITAL')
        .map((row) => ({ ...cite(row), periodEnd: row.periodEnd?.toISOString().slice(0, 10) ?? '', component: row.category as QoeWorkingCapitalComponent, label: row.label, amount: amountString(row.amount), currency: row.currency }));
      const imported = await loadImportedPnl(tx, dealId);
      const schedule = adjustedEbitdaSchedule({ reported, adjustments, addBacks, pnl: imported.periods, currency: deal.baseCurrency });
      const conflicts = schedule.flatMap((period) => (period.conflict ? [{ ...period.conflict, fingerprint: conflictFingerprint(period.conflict) }] : []));
      // bounded: one finding per conflicting period
      const raised = conflicts.length ? await tx.finding.findMany({ where: { dealId, fingerprint: { in: conflicts.map((conflict) => conflict.fingerprint) } }, select: { id: true, fingerprint: true } }) : [];
      return {
        disclaimer: QOE_DISCLAIMER,
        engineVersion: QOE_ENGINE_VERSION,
        currency: deal.baseCurrency,
        canEdit: canWrite(role),
        canDecide: canReviewFindings(role),
        schedule: schedule.map((period) => ({ ...period, pnlFiles: period.pnl ? filesOf(imported, period.pnl.sources.map((row) => row.evidenceId)) : [] })),
        importedPnl: {
          readerVersion: PNL_READER_VERSION,
          ebitdaBasis: PNL_EBITDA_BASIS,
          periods: imported.periods.length,
          files: filesOf(imported, imported.periods.flatMap((period) => period.sources.map((row) => row.evidenceId))),
        },
        conflicts: conflicts.map((conflict) => ({ ...conflict, findingId: raised.find((finding) => finding.fingerprint === conflict.fingerprint)?.id ?? null })),
        register: schedule.flatMap((period) => period.addBacks),
        workingCapital: { ...workingCapitalAnalysis(lines), currency: deal.baseCurrency },
        entries: rows.map((row) => ({
          entryKey: row.entryKey,
          version: row.version,
          kind: row.kind,
          findingId: row.findingId,
          citation: show(row.citation),
          verificationCitation: row.verificationCitation ? show(row.verificationCitation) : null,
          decisionReason: row.decisionReason,
          updatedAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  /**
   * Draft the finding an adjustment or add-back becomes, idempotently by fingerprint. Its
   * direction is the QoE direction rule's; nothing is priced or accepted here.
   */
  private async draftFinding(tenant: TenantContext, dealId: string, entryKey: string, body: QoeEntryBody, citations: { claim: StoredCitation; verification: StoredCitation | null }, requestId: string): Promise<string | null> {
    if (body.kind !== 'ADJUSTMENT' && body.kind !== 'ADD_BACK') return null;
    const category = QOE_CATEGORY_REGISTRY[body.category].label;
    const rule =
      body.kind === 'ADJUSTMENT'
        ? qoeDirectionFor(QOE_ADJUSTMENT_EVIDENCE_TYPE, body.amount.startsWith('-') ? 'reduces-ebitda' : 'increases-ebitda')
        : qoeDirectionFor(QOE_ADD_BACK_EVIDENCE_TYPE, body.verificationStatus);
    const link = (citation: StoredCitation): FindingEvidenceLink => ({ evidenceItemId: null, documentCitation: citation, commitSha: null, toolName: 'pactlab-qoe', toolVersion: QOE_ENGINE_VERSION, rulesetVersion: null, path: null, lineStart: null, lineEnd: null });
    const amount = `${body.currency} ${body.amount}`;
    const proposal: ProposedFinding = {
      domain: rule.findingDomain,
      title:
        body.kind === 'ADJUSTMENT'
          ? `QoE adjustment (${body.period}): ${body.label}`.slice(0, 160)
          : `Seller add-back, ${QOE_VERIFICATION_LABELS[body.verificationStatus].toLowerCase()} (${body.period}): ${body.label}`.slice(0, 160),
      description:
        body.kind === 'ADJUSTMENT'
          ? `${category}: ${amount} to ${body.period} EBITDA. ${body.rationale}`
          : `${category}: the seller claims ${amount} for ${body.period} (${body.recurrence === 'ONE_OFF' ? 'one-off' : 'recurring'}). Seller's rationale: ${body.rationale}${body.verifiedAmount ? ` Verified: ${body.currency} ${body.verifiedAmount}.` : ''}`,
      severity: rule.defaultDirection === -1 ? 'MEDIUM' : 'LOW',
      confidence: body.kind === 'ADD_BACK' && body.verificationStatus === 'UNVERIFIED' ? 'LOW' : 'MEDIUM',
      origin: 'HEURISTIC',
      fingerprint: `qoe:${entryKey}:${body.kind === 'ADJUSTMENT' ? (body.amount.startsWith('-') ? 'reduces' : 'increases') : body.verificationStatus}`,
      evidence: [link(citations.claim), ...(citations.verification ? [link(citations.verification)] : [])],
      // A drag is priced by a person before acceptance (Needs pricing); the schedule never prices it.
      pricedRisk: null,
      direction: rule.defaultDirection,
      valueConfirmation:
        rule.defaultDirection === 1
          ? { valueDriver: `Normalized EBITDA: ${body.label}`.slice(0, 200), impliedValue: null, basis: `${amount} of ${body.period} EBITDA, cited (${QOE_ENGINE_VERSION}). Value confirmed, not price paid.` }
          : null,
    };
    const { created } = await this.findings.recordProposals(tenant, dealId, [proposal], { kind: 'SYSTEM', component: `qoe@${QOE_ENGINE_VERSION}` }, requestId);
    if (created[0]) return created[0].id;
    const existing = await withTenant(this.prisma, tenant, (tx) => tx.finding.findFirst({ where: { dealId, fingerprint: proposal.fingerprint }, select: { id: true } }));
    return existing?.id ?? null;
  }

  private async write(
    tenant: TenantContext,
    dealId: string,
    entryKey: string,
    version: number,
    body: QoeEntryBody,
    extra: { reason: string; inclusion?: QoeInclusionDecision | null; decisionReason?: string | null; withdrawn?: boolean; findingId?: string | null; citations?: { claim: StoredCitation; verification: StoredCitation | null } },
    action: string,
    requestId: string,
  ): Promise<void> {
    const citations =
      extra.citations ??
      (await withTenant(this.prisma, tenant, async (tx) => {
        const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true } });
        if (!deal) throw new NotFoundException();
        // One currency per work product: the pact's base currency, so every sum is like for like.
        if (body.currency !== deal.baseCurrency) throw new UnprocessableEntityException({ code: 'CURRENCY_MISMATCH', message: `Enter QoE figures in the pact's base currency (${deal.baseCurrency})` });
        return {
          claim: await this.verify(tx, dealId, body.citation),
          verification: body.kind === 'ADD_BACK' && body.verificationCitation ? await this.verify(tx, dealId, body.verificationCitation) : null,
        };
      }));
    const findingId = extra.findingId !== undefined ? extra.findingId : await this.draftFinding(tenant, dealId, entryKey, body, citations, requestId);
    await withTenant(this.prisma, tenant, async (tx) => {
      const id = newId();
      await tx.qoeEntry.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId,
          entryKey,
          version,
          kind: body.kind,
          period: body.kind === 'WORKING_CAPITAL' ? null : body.period,
          periodEnd: body.kind === 'WORKING_CAPITAL' ? new Date(`${body.periodEnd}T00:00:00Z`) : null,
          category: body.kind === 'REPORTED_EBITDA' ? null : body.category,
          label: body.label,
          amount: body.amount,
          currency: body.currency,
          citation: citations.claim as never,
          rationale: body.kind === 'ADJUSTMENT' || body.kind === 'ADD_BACK' ? body.rationale : null,
          verificationStatus: body.kind === 'ADD_BACK' ? body.verificationStatus : null,
          verifiedAmount: body.kind === 'ADD_BACK' ? (body.verifiedAmount ?? null) : null,
          verificationCitation: (citations.verification ?? undefined) as never,
          recurrence: body.kind === 'ADD_BACK' ? body.recurrence : null,
          inclusion: extra.inclusion ?? null,
          decisionReason: extra.decisionReason ?? null,
          withdrawn: extra.withdrawn ?? false,
          reason: extra.reason,
          findingId,
          createdBy: tenant.userId,
        },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: 'qoe_entry', targetId: entryKey, outcome: 'SUCCEEDED', requestId });
    });
  }

  private async latest(tenant: TenantContext, dealId: string, entryKey: string): Promise<Row> {
    const row = await withTenant(this.prisma, tenant, (tx) => tx.qoeEntry.findFirst({ where: { dealId, entryKey }, orderBy: { version: 'desc' } }));
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The body a stored row was recorded from, so a decision or withdrawal repeats it unchanged. */
  private bodyOf(row: Row): QoeEntryBody {
    const citation = row.citation as unknown as StoredCitation;
    const base = { label: row.label, currency: row.currency, amount: amountString(row.amount), citation: { documentId: citation.documentId, pageNumber: citation.pageNumber, quote: citation.quote } };
    if (row.kind === 'REPORTED_EBITDA') return { kind: 'REPORTED_EBITDA', period: row.period ?? '', ...base };
    if (row.kind === 'ADJUSTMENT') return { kind: 'ADJUSTMENT', period: row.period ?? '', category: row.category as QoeAdjustmentCategory, rationale: row.rationale ?? '', ...base };
    if (row.kind === 'WORKING_CAPITAL') return { kind: 'WORKING_CAPITAL', periodEnd: row.periodEnd?.toISOString().slice(0, 10) ?? '', category: row.category as QoeWorkingCapitalComponent, ...base };
    const verification = row.verificationCitation as unknown as StoredCitation | null;
    return {
      kind: 'ADD_BACK',
      period: row.period ?? '',
      category: row.category as QoeAdjustmentCategory,
      rationale: row.rationale ?? '',
      recurrence: row.recurrence as QoeRecurrence,
      verificationStatus: row.verificationStatus as QoeVerificationStatus,
      ...(row.verifiedAmount ? { verifiedAmount: amountString(row.verifiedAmount) } : {}),
      ...(verification ? { verificationCitation: { documentId: verification.documentId, pageNumber: verification.pageNumber, quote: verification.quote } } : {}),
      ...base,
    };
  }

  async record(tenant: TenantContext, dealId: string, body: QoeEntryBody, requestId: string): Promise<QoeView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'qoe.entry_recorded', requestId });
    await this.write(tenant, dealId, newId(), 1, body, { reason: 'Recorded' }, 'qoe.entry_recorded', requestId);
    if (body.kind === 'REPORTED_EBITDA') await this.raisePnlConflicts(tenant, dealId, requestId);
    return this.view(tenant, dealId, requestId);
  }

  /** A correction is the next version. A revised add-back needs a fresh inclusion decision: the old one was about the old facts. */
  async revise(tenant: TenantContext, dealId: string, entryKey: string, body: QoeReviseBody, requestId: string): Promise<QoeView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'qoe.entry_revised', requestId });
    const current = await this.latest(tenant, dealId, entryKey);
    if (current.withdrawn) throw new ConflictException('That entry was withdrawn');
    if (current.version !== body.expectedVersion) throw new ConflictException('The entry changed in the meantime');
    if (current.kind !== body.entry.kind) throw new UnprocessableEntityException({ code: 'KIND_CHANGED', message: 'A revision keeps the entry’s kind' });
    await this.write(tenant, dealId, entryKey, current.version + 1, body.entry, { reason: body.reason }, 'qoe.entry_revised', requestId);
    if (body.entry.kind === 'REPORTED_EBITDA') await this.raisePnlConflicts(tenant, dealId, requestId);
    return this.view(tenant, dealId, requestId);
  }

  async withdraw(tenant: TenantContext, dealId: string, entryKey: string, body: QoeWithdrawBody, requestId: string): Promise<QoeView> {
    await this.access.require(tenant, dealId, canWrite, { action: 'qoe.entry_withdrawn', requestId });
    const current = await this.latest(tenant, dealId, entryKey);
    if (current.withdrawn) throw new ConflictException('That entry was already withdrawn');
    if (current.version !== body.expectedVersion) throw new ConflictException('The entry changed in the meantime');
    await this.write(tenant, dealId, entryKey, current.version + 1, this.bodyOf(current), { reason: body.reason, withdrawn: true, findingId: current.findingId, citations: this.storedCitations(current), inclusion: current.inclusion as QoeInclusionDecision | null, decisionReason: current.decisionReason }, 'qoe.entry_withdrawn', requestId);
    return this.view(tenant, dealId, requestId);
  }

  private storedCitations(row: Row) {
    return { claim: row.citation as unknown as StoredCitation, verification: (row.verificationCitation as unknown as StoredCitation | null) ?? null };
  }

  /**
   * A reviewer's explicit inclusion or exclusion of an add-back, with the reason, recorded as the
   * next version and audited. The only way an unverified add-back reaches adjusted EBITDA.
   */
  async decide(tenant: TenantContext, dealId: string, entryKey: string, body: QoeDecisionBody, requestId: string): Promise<QoeView> {
    const action = body.decision === 'INCLUDE' ? 'qoe.add_back_included' : 'qoe.add_back_excluded';
    await this.access.require(tenant, dealId, canReviewFindings, { action, requestId });
    const current = await this.latest(tenant, dealId, entryKey);
    if (current.kind !== 'ADD_BACK') throw new NotFoundException();
    if (current.withdrawn) throw new ConflictException('That add-back was withdrawn');
    if (current.version !== body.expectedVersion) throw new ConflictException('The add-back changed in the meantime');
    await this.write(tenant, dealId, entryKey, current.version + 1, this.bodyOf(current), { reason: `Reviewer decision: ${body.decision}`, inclusion: body.decision, decisionReason: body.reason, findingId: current.findingId, citations: this.storedCitations(current) }, action, requestId);
    return this.view(tenant, dealId, requestId);
  }

  /**
   * Draft a finding for every period where the imported P&L and a filed statement disagree
   * (T-149), idempotently by fingerprint. It cites both sides: the filed page and the imported
   * rows. Nothing is picked, priced or accepted here; a person settles it by correcting or
   * withdrawing one source. Runs after a filed figure is recorded, and on request after an import.
   */
  async raisePnlConflicts(tenant: TenantContext, dealId: string, requestId: string): Promise<{ created: number; existing: number }> {
    await this.access.require(tenant, dealId, canWrite, { action: 'qoe.pnl_conflicts_raised', requestId });
    const { schedule, conflicts } = await this.view(tenant, dealId, requestId);
    const open = conflicts.filter((conflict) => !conflict.findingId);
    if (open.length === 0) return { created: 0, existing: conflicts.length };
    const rows = await withTenant(this.prisma, tenant, (tx) => this.current(tx, dealId));
    const rule = qoeDirectionFor(QOE_PNL_CONFLICT_EVIDENCE_TYPE, 'disagrees');
    const proposals: ProposedFinding[] = [];
    for (const conflict of open) {
      const filed = rows.find((row) => row.entryKey === conflict.filedEntry.entryKey);
      const period = schedule.find((candidate) => candidate.conflict?.filedEntry.entryKey === conflict.filedEntry.entryKey && candidate.period === conflict.period);
      if (!filed || !period?.pnl) continue;
      const ebitdaRows = period.pnl.sources.filter((row) => row.kind === 'REVENUE' || row.kind === 'COGS' || row.kind === 'OPEX');
      const files = period.pnlFiles.map((file) => file.fileName).join(', ') || 'the imported P&L';
      const tool = { commitSha: null, toolName: 'pactlab-qoe', toolVersion: `${QOE_ENGINE_VERSION}+${PNL_READER_VERSION}`, rulesetVersion: null, path: null, lineStart: null, lineEnd: null };
      proposals.push({
        domain: rule.findingDomain,
        title: `P&L conflict (${conflict.period}): imported EBITDA ${conflict.imported} vs filed ${conflict.filed}`.slice(0, 160),
        description: `The imported P&L (${files}) gives ${conflict.period} EBITDA of ${period.currency} ${conflict.imported}; the filed statement cited for “${filed.label}” gives ${period.currency} ${conflict.filed}, a difference of ${period.currency} ${conflict.difference}. Imported EBITDA is ${PNL_EBITDA_BASIS.charAt(0).toLowerCase()}${PNL_EBITDA_BASIS.slice(1)} Adjusted EBITDA for the period is not computed until a person corrects or withdraws one of them. ${ebitdaRows.length} imported rows make up the figure${ebitdaRows.length > CONFLICT_ROW_LINKS ? `; the first ${CONFLICT_ROW_LINKS} are linked` : ''}.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        origin: 'HEURISTIC',
        fingerprint: conflict.fingerprint,
        evidence: [
          { ...tool, evidenceItemId: null, documentCitation: filed.citation as unknown as StoredCitation },
          ...ebitdaRows.slice(0, CONFLICT_ROW_LINKS).map((row) => ({ ...tool, evidenceItemId: row.evidenceId, documentCitation: null })),
        ],
        pricedRisk: null,
        direction: rule.defaultDirection,
        valueConfirmation: null,
      });
    }
    const { created, existing } = await this.findings.recordProposals(tenant, dealId, proposals, { kind: 'SYSTEM', component: `qoe@${QOE_ENGINE_VERSION}` }, requestId);
    return { created: created.length, existing: existing + conflicts.length - open.length };
  }

  /** Put the proposed peg on the buyer's open draft terms (a true-up mechanic, never a bridge line). */
  async addPegTerm(tenant: TenantContext, dealId: string, requestId: string): Promise<{ batchId: string; amount: string; currency: string }> {
    await this.access.require(tenant, dealId, canWrite, { action: 'qoe.peg_term_added', requestId });
    const { workingCapital } = await this.view(tenant, dealId, requestId);
    if (!workingCapital.peg) throw new UnprocessableEntityException({ code: 'NO_PEG', message: workingCapital.pegUnavailable ?? 'No peg yet' });
    const { batchId } = await this.pricing.addWorkingCapitalPeg(tenant, dealId, { amount: workingCapital.peg.amount, currency: workingCapital.currency, derivation: workingCapital.peg.derivation }, requestId);
    return { batchId, amount: workingCapital.peg.amount, currency: workingCapital.currency };
  }
}
