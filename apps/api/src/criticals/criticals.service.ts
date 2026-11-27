import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extractCriticalFigures, GatewayPolicyError, PROHIBITED_CLASSIFICATIONS, proposeCriticalStructure, type AiRunRecord, type CitableSource, type ClaudeGateway } from '@pactlab/ai';
import { capRate, CRITICALS_ENGINE_VERSION, rateCritical, type CriticalFigure, type FigureOutcome, type PackMetricsReport } from '@pactlab/calculations';
import type { ConfirmCriticalBody, CreateCriticalBody, CreateOrgCriticalBody, CriticalsLibraryQuery, CriticalStructureInput, OverrideCriticalBody, RetireCriticalBody, ReviseCriticalBody } from '@pactlab/contracts';
import { ACTIVE_EVIDENCE_SQL, appendAuditEvent, askingPrices, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  COMPANY_TYPES,
  CRITICAL_LIBRARY_LIMIT,
  CRITICAL_METRICS,
  CRITICAL_PACT_LIMIT,
  CRITICAL_RATING_LABELS,
  criticalDirectionFor,
  criticalMetricsFor,
  describeStructure,
  formatCriticalValue,
  newId,
  percentToRatio,
  permissionsForDealRole,
  structureProblem,
  type CompanyType,
  type CriticalMetricId,
  type CriticalRating,
  type CriticalState,
  type CriticalStructure,
  type DealRole,
  type DocumentCitation,
  type FindingEvidenceLink,
  type ProposedFinding,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
import { MetricsService } from '../metrics/metrics.service';
import { PRISMA } from '../tokens';
import { CRITICALS_GATEWAY } from './criticals.tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => canRead(role) && permissionsForDealRole(role).has('DEAL_WRITE');
/** Loosening a firm red line for a deal is possible, never invisible: only the deal lead overrides. */
const canOverride = (role: DealRole) => role === 'DEAL_LEAD';
const isOrgAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
const CITABLE_CLASSES = ['PUBLIC', 'BUSINESS', 'FINANCIAL'] as const;
/** Pages sent to the model for one document metric: the ones that name it. */
const DOCUMENT_PAGES_PER_METRIC = 8;
/** Evidence a finding cites at most (the receipts keep every figure). */
const MAX_FINDING_LINKS = 50;
const TOOL = 'pactlab-criticals';

export interface CriticalRow {
  id: string;
  organizationId: string;
  dealId: string | null;
  criticalKey: string;
  version: number;
  scope: string;
  companyType: string | null;
  overridesKey: string | null;
  words: string | null;
  metric: string | null;
  comparator: string | null;
  threshold: { toFixed(digits?: number): string } | string | null;
  lookbackYears: number | null;
  evenBand: { toFixed(digits?: number): string } | string | null;
  state: string;
  structureSource: string | null;
  reason: string | null;
  promotedFromKey: string | null;
  createdBy: string;
  createdAt: Date;
}

interface EvaluationRow {
  id: string;
  runId: string;
  criticalKey: string;
  criticalVersion: number;
  origin: string;
  overrideKey: string | null;
  overrideVersion: number | null;
  snapshot: unknown;
  rating: string;
  receipts: unknown;
  rationale: string;
  missing: string | null;
  policyBreach: boolean;
  findingId: string | null;
  evidenceMark: string;
  engineVersion: string;
  evaluatedAt: Date;
}

/** A decimal column as a plain string ("0.06", "1.25"), never a float. */
const plain = (value: CriticalRow['threshold']): string | null => {
  if (value === null) return null;
  const text = typeof value === 'string' ? value : value.toFixed(6);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
};

export function structureOf(row: CriticalRow): CriticalStructure | null {
  const threshold = plain(row.threshold);
  if (!row.metric || !row.comparator || threshold === null) return null;
  return { metric: row.metric as CriticalMetricId, comparator: row.comparator as CriticalStructure['comparator'], threshold, lookbackYears: row.lookbackYears, evenBand: plain(row.evenBand) };
}

const sameStructure = (a: CriticalStructure | null, b: CriticalStructure | null) =>
  !!a && !!b && a.metric === b.metric && a.comparator === b.comparator && a.threshold === b.threshold && a.lookbackYears === b.lookbackYears && (a.evenBand ?? null) === (b.evenBand ?? null);

/** The library's view of one critical's latest version. */
export interface CriticalView {
  key: string;
  version: number;
  scope: 'ORG' | 'PACT';
  companyType: CompanyType | null;
  words: string | null;
  structure: CriticalStructure | null;
  structureText: string | null;
  structureSource: 'AI' | 'PERSON' | null;
  state: CriticalState;
  /** Whether it evaluates: only a confirmed structure does. */
  evaluates: boolean;
  /** Why the proposal cannot be confirmed as it stands (a person corrects it). */
  problem: string | null;
  /** The AI's question when the words were unclear. */
  question: string | null;
  promotedFromKey: string | null;
  reason: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface PanelFigure {
  period: string | null;
  value: string | null;
  display: string | null;
  outcome: FigureOutcome;
  source: 'CALCULATED' | 'DOCUMENT';
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string } | null;
}

export interface PanelRow {
  key: string;
  origin: 'ORG' | 'PACT';
  words: string | null;
  version: number;
  state: CriticalState;
  structure: CriticalStructure | null;
  structureText: string | null;
  /** For an overridden org standard: the standard it replaces, and the override record. */
  standard: { version: number; structureText: string | null } | null;
  override: { key: string; version: number; disabled: boolean; structureText: string | null; reason: string; by: string; at: string } | null;
  metric: { id: CriticalMetricId; label: string; settles: string; requests: string } | null;
  evaluation: {
    runId: string;
    rating: CriticalRating;
    ratingLabel: string;
    rationale: string;
    missing: string | null;
    requests: string | null;
    policyBreach: boolean;
    findingId: string | null;
    figures: PanelFigure[];
    formula: string | null;
    evidenceIds: string[];
    ratedVersion: number;
    ratedOverrideVersion: number | null;
    ratedStructureText: string | null;
    /** The pact was rated under an older version of the policy (or a since-changed override). */
    olderVersion: boolean;
    /** New documents or imports since the rating: re-evaluate explicitly. */
    stale: boolean;
    evaluatedAt: string;
    engineVersion: string;
  } | null;
}

interface Receipts {
  figures: PanelFigure[];
  formula: string | null;
  evidenceIds: string[];
}

@Injectable()
export class CriticalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(CRITICALS_GATEWAY) private readonly gateway: ClaudeGateway,
  ) {}

  // --- The org library ---------------------------------------------------------------------

  /** The metric vocabulary a critical scoped to this company type may target. */
  vocabulary(companyType: CompanyType | null) {
    return criticalMetricsFor(companyType).map((id) => ({ id, label: CRITICAL_METRICS[id].label, unit: CRITICAL_METRICS[id].unit, lookback: CRITICAL_METRICS[id].lookback, source: CRITICAL_METRICS[id].source.kind, settles: CRITICAL_METRICS[id].settles }));
  }

  private requireLibraryReader(tenant: TenantContext) {
    if (tenant.organizationRole === 'GUEST') throw new ForbiddenException();
  }
  private requireLibraryWriter(tenant: TenantContext) {
    this.requireLibraryReader(tenant);
    if (!isOrgAdmin(tenant)) throw new ForbiddenException({ code: 'ORG_ADMIN_REQUIRED', message: 'Only an organization owner or admin changes the organization’s criticals' });
  }

  async library(tenant: TenantContext, query: CriticalsLibraryQuery, requestId: string) {
    this.requireLibraryReader(tenant);
    return withTenant(this.prisma, tenant, async (tx) => {
      const heads = await this.heads(tx, { scope: 'ORG' });
      const filtered = heads.filter((row) => row.state !== 'RETIRED' && (query.companyType === undefined || (query.companyType === 'ALL' ? row.companyType === null : row.companyType === query.companyType)));
      // Newest first; the cursor is the last row's (time, id), so a page never repeats or skips a row.
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      const start = query.cursor ? decodeLibraryCursor(query.cursor, filtered) : 0;
      const page = filtered.slice(start, start + query.limit);
      const last = page.at(-1);
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, actorUserId: tenant.userId, action: 'criticals.library_viewed', targetType: 'organization', targetId: tenant.organizationId, outcome: 'ALLOWED', requestId });
      return {
        items: page.map((row) => this.view(row, null)),
        nextCursor: start + query.limit < filtered.length && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null,
        total: filtered.length,
        limit: query.limit,
        canEdit: isOrgAdmin(tenant),
      };
    });
  }

  async createStandard(tenant: TenantContext, body: CreateOrgCriticalBody, requestId: string) {
    this.requireLibraryWriter(tenant);
    const companyType = body.companyType === 'ALL' ? null : body.companyType;
    const live = await withTenant(this.prisma, tenant, async (tx) => (await this.heads(tx, { scope: 'ORG' })).filter((row) => row.state !== 'RETIRED').length);
    if (live >= CRITICAL_LIBRARY_LIMIT) throw new UnprocessableEntityException({ code: 'TOO_MANY_CRITICALS', message: `An organization keeps at most ${CRITICAL_LIBRARY_LIMIT} criticals` });
    const proposal = await this.propose(tenant, null, body.words ?? null, body.structure ?? null, companyType);
    const key = newId();
    const row = await this.insert(tenant, { dealId: null, scope: 'ORG', companyType, criticalKey: key, version: 1, words: body.words ?? null, structure: proposal.structure, source: proposal.source, state: 'PROPOSED', reason: 'Written' }, 'criticals.standard_created', requestId);
    return this.view(row, proposal.question);
  }

  async reviseStandard(tenant: TenantContext, criticalKey: string, body: ReviseCriticalBody, requestId: string) {
    this.requireLibraryWriter(tenant);
    const head = await this.requireHead(tenant, criticalKey, 'ORG', null, body.version);
    return this.revise(tenant, head, body, requestId);
  }

  async confirmStandard(tenant: TenantContext, criticalKey: string, body: ConfirmCriticalBody, requestId: string) {
    this.requireLibraryWriter(tenant);
    const head = await this.requireHead(tenant, criticalKey, 'ORG', null, body.version);
    return this.confirm(tenant, head, body, requestId);
  }

  async retireStandard(tenant: TenantContext, criticalKey: string, body: RetireCriticalBody, requestId: string) {
    this.requireLibraryWriter(tenant);
    const head = await this.requireHead(tenant, criticalKey, 'ORG', null, body.version);
    const row = await this.insert(tenant, { ...this.carry(head), version: head.version + 1, state: 'RETIRED', reason: body.reason }, 'criticals.standard_retired', requestId);
    return this.view(row, null);
  }

  // --- A pact's criticals -------------------------------------------------------------------

  async createPactCritical(tenant: TenantContext, dealId: string, body: CreateCriticalBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'criticals.pact_created', requestId });
    const { companyType } = await this.deal(tenant, dealId);
    const live = await withTenant(this.prisma, tenant, async (tx) => (await this.heads(tx, { scope: 'PACT', dealId })).filter((row) => row.state !== 'RETIRED').length);
    if (live >= CRITICAL_PACT_LIMIT) throw new UnprocessableEntityException({ code: 'TOO_MANY_CRITICALS', message: `A pact keeps at most ${CRITICAL_PACT_LIMIT} criticals` });
    const proposal = await this.propose(tenant, dealId, body.words ?? null, body.structure ?? null, companyType);
    const row = await this.insert(tenant, { dealId, scope: 'PACT', companyType: null, criticalKey: newId(), version: 1, words: body.words ?? null, structure: proposal.structure, source: proposal.source, state: 'PROPOSED', reason: 'Written' }, 'criticals.pact_created', requestId);
    return this.view(row, proposal.question);
  }

  async revisePactCritical(tenant: TenantContext, dealId: string, criticalKey: string, body: ReviseCriticalBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'criticals.pact_revised', requestId });
    const head = await this.requireHead(tenant, criticalKey, 'PACT', dealId, body.version);
    if (head.overridesKey) throw new UnprocessableEntityException({ code: 'IS_OVERRIDE', message: 'Change an override from the org standard it replaces' });
    return this.revise(tenant, head, body, requestId);
  }

  async confirmPactCritical(tenant: TenantContext, dealId: string, criticalKey: string, body: ConfirmCriticalBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'criticals.pact_confirmed', requestId });
    const head = await this.requireHead(tenant, criticalKey, 'PACT', dealId, body.version);
    if (head.overridesKey) throw new UnprocessableEntityException({ code: 'IS_OVERRIDE', message: 'An override is confirmed when it is recorded' });
    return this.confirm(tenant, head, body, requestId);
  }

  async retirePactCritical(tenant: TenantContext, dealId: string, criticalKey: string, body: RetireCriticalBody, requestId: string) {
    await this.access.require(tenant, dealId, (role) => canWrite(role), { action: 'criticals.pact_retired', requestId });
    const head = await this.requireHead(tenant, criticalKey, 'PACT', dealId, body.version);
    // Removing an override returns the pact to the org standard; only the deal lead may.
    if (head.overridesKey) await this.access.require(tenant, dealId, canOverride, { action: 'criticals.override_cleared', requestId });
    const row = await this.insert(tenant, { ...this.carry(head), version: head.version + 1, state: 'RETIRED', reason: body.reason }, head.overridesKey ? 'criticals.override_cleared' : 'criticals.pact_retired', requestId);
    return this.view(row, null);
  }

  /** Tighten, loosen or switch off an org standard for this pact: a stamped record with its reason. */
  async override(tenant: TenantContext, dealId: string, body: OverrideCriticalBody, requestId: string) {
    await this.access.require(tenant, dealId, canOverride, { action: 'criticals.overridden', requestId });
    const { companyType } = await this.deal(tenant, dealId);
    const { standard, existing } = await withTenant(this.prisma, tenant, async (tx) => {
      const standards = await this.applicableStandards(tx, companyType);
      const pact = await this.heads(tx, { scope: 'PACT', dealId });
      return { standard: standards.find((row) => row.criticalKey === body.standardKey) ?? null, existing: pact.find((row) => row.overridesKey === body.standardKey && row.state !== 'RETIRED') ?? null };
    });
    if (!standard) throw new NotFoundException({ code: 'NOT_AN_ORG_STANDARD', message: 'That is not a confirmed org standard for this pact’s type' });
    let structure: CriticalStructure | null = null;
    if (!body.disabled && body.structure) {
      structure = this.toStructure(body.structure);
      if (structure.metric !== standard.metric) throw new UnprocessableEntityException({ code: 'OVERRIDE_METRIC', message: 'An override changes the threshold, lookback or band; it keeps the standard’s metric' });
      const problem = structureProblem(structure, companyType);
      if (problem) throw new UnprocessableEntityException({ code: 'STRUCTURE_INVALID', message: problem });
    }
    const row = await this.insert(
      tenant,
      {
        dealId,
        scope: 'PACT',
        companyType: null,
        criticalKey: existing?.criticalKey ?? newId(),
        version: (existing?.version ?? 0) + 1,
        overridesKey: standard.criticalKey,
        words: standard.words,
        structure,
        source: structure ? 'PERSON' : null,
        state: body.disabled ? 'DISABLED' : 'CONFIRMED',
        reason: body.reason,
      },
      'criticals.overridden',
      requestId,
    );
    return this.view(row, null);
  }

  /** Make a pact critical an org standard for the pact's company type, carrying its confirmed structure. */
  async promote(tenant: TenantContext, dealId: string, criticalKey: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'criticals.promoted', requestId });
    this.requireLibraryWriter(tenant);
    const { companyType } = await this.deal(tenant, dealId);
    const head = await this.requireHead(tenant, criticalKey, 'PACT', dealId, null);
    const structure = structureOf(head);
    if (head.overridesKey || head.state !== 'CONFIRMED' || !structure) throw new UnprocessableEntityException({ code: 'NOT_CONFIRMED', message: 'Confirm the pact critical before making it an org standard' });
    const row = await this.insert(tenant, { dealId: null, scope: 'ORG', companyType, criticalKey: newId(), version: 1, words: head.words, structure, source: head.structureSource === 'AI' ? 'AI' : 'PERSON', state: 'CONFIRMED', reason: 'Promoted from a pact critical', promotedFromKey: head.criticalKey }, 'criticals.promoted', requestId);
    return this.view(row, null);
  }

  // --- The panel and the evaluation ----------------------------------------------------------

  async panel(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'criticals.viewed', requestId });
    const { companyType } = await this.deal(tenant, dealId);
    return withTenant(this.prisma, tenant, async (tx) => {
      const { standards, pact } = await this.effective(tx, dealId, companyType);
      const evaluations = await this.latestEvaluations(tx, dealId);
      const mark = await this.evidenceMark(tx, dealId);
      const names = await this.documentNames(tx, dealId, evaluations);
      const rows: PanelRow[] = [];
      for (const { standard, override } of standards) rows.push(this.panelRow('ORG', standard, override, evaluations.get(standard.criticalKey) ?? null, mark, names));
      for (const row of pact) rows.push(this.panelRow('PACT', row, null, evaluations.get(row.criticalKey) ?? null, mark, names));
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'criticals.viewed', targetType: 'deal', targetId: dealId, outcome: 'ALLOWED', requestId });
      const rated = rows.flatMap((row) => (row.evaluation ? [row.evaluation] : []));
      return {
        companyType,
        engineVersion: CRITICALS_ENGINE_VERSION,
        rows,
        summary: {
          good: rated.filter((row) => row.rating === 'GOOD').length,
          even: rated.filter((row) => row.rating === 'EVEN').length,
          bad: rated.filter((row) => row.rating === 'BAD').length,
          noEvidence: rated.filter((row) => row.rating === 'NO_EVIDENCE').length,
          policyBreaches: rated.filter((row) => row.policyBreach).length,
          stale: rows.some((row) => row.evaluation?.stale || row.evaluation?.olderVersion || (row.evaluation === null && row.structure !== null && row.state === 'CONFIRMED')),
        },
        vocabulary: this.vocabulary(companyType),
        canEdit: canWrite(role),
        canOverride: canOverride(role),
        canPromote: canWrite(role) && isOrgAdmin(tenant),
      };
    });
  }

  /** Rate every applicable, confirmed critical against everything in the pact. Explicit, never silent. */
  async evaluate(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'criticals.evaluated', requestId });
    const { companyType } = await this.deal(tenant, dealId);
    const { standards, pact, mark, asking } = await withTenant(this.prisma, tenant, async (tx) => ({
      ...(await this.effective(tx, dealId, companyType)),
      mark: await this.evidenceMark(tx, dealId),
      asking: (await askingPrices.currentFor(tx, [dealId])).get(dealId) ?? null,
    }));
    const targets = [
      ...standards.flatMap(({ standard, override }) => {
        if (override?.state === 'DISABLED') return [];
        const structure = override ? structureOf(override) : structureOf(standard);
        return structure ? [{ origin: 'ORG' as const, critical: standard, override, structure }] : [];
      }),
      ...pact.flatMap((row) => {
        const structure = row.state === 'CONFIRMED' ? structureOf(row) : null;
        return structure ? [{ origin: 'PACT' as const, critical: row, override: null, structure }] : [];
      }),
    ];
    const needsMetrics = targets.some((target) => CRITICAL_METRICS[target.structure.metric].source.kind !== 'DOCUMENT');
    const report = needsMetrics ? await this.metrics.packMetrics(tenant, dealId, requestId) : null;
    const runId = newId();
    const skipped: { key: string; reason: string }[] = [];
    let rated = 0;
    for (const target of targets) {
      const metric = CRITICAL_METRICS[target.structure.metric];
      const observed = await this.observe(tenant, dealId, target.structure, report, asking, metric.source.kind === 'DOCUMENT' ? metric.source.terms : []);
      if (observed.skip) {
        skipped.push({ key: target.critical.criticalKey, reason: observed.skip });
        continue;
      }
      const result = rateCritical(target.structure, observed.figures);
      const receipts: Receipts = { figures: result.figures.map((figure, index) => ({ ...this.figureView(figure, metric.unit), citation: observed.citations[index] ?? null })), formula: observed.formula, evidenceIds: observed.evidenceIds };
      const policyBreach = result.rating === 'BAD' && target.origin === 'ORG';
      const missing = result.rating === 'NO_EVIDENCE' ? `${metric.settles}${observed.missingDetail ? ` (${observed.missingDetail})` : ''}.` : null;
      const findingId = await this.draftFinding(tenant, dealId, target, result.rating, receipts, observed.links, policyBreach, requestId);
      await withTenant(this.prisma, tenant, (tx) =>
        tx.criticalEvaluation.create({
          data: {
            id: newId(),
            organizationId: tenant.organizationId,
            dealId,
            runId,
            criticalKey: target.critical.criticalKey,
            criticalVersion: target.critical.version,
            origin: target.origin,
            overrideKey: target.override?.criticalKey ?? null,
            overrideVersion: target.override?.version ?? null,
            snapshot: { words: target.critical.words, structure: target.structure, structureText: describeStructure(target.structure), standardStructureText: target.override ? textOf(structureOf(target.critical)) : null, overrideReason: target.override?.reason ?? null } as never,
            rating: result.rating,
            receipts: receipts as never,
            rationale: result.rationale,
            missing,
            policyBreach,
            findingId,
            evidenceMark: mark,
            engineVersion: CRITICALS_ENGINE_VERSION,
            evaluatedBy: tenant.userId,
          },
        }),
      );
      rated += 1;
    }
    await withTenant(this.prisma, tenant, (tx) => appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'criticals.evaluated', targetType: 'criticals_run', targetId: runId, outcome: 'ALLOWED', requestId }));
    return { runId, rated, skipped, panel: await this.panel(tenant, dealId, requestId) };
  }

  /** Policy breaches for the investment committee (T-118): Bad ratings on org standards, as last evaluated. */
  async breaches(tenant: TenantContext, dealId: string) {
    return withTenant(this.prisma, tenant, async (tx) => {
      const evaluations = await this.latestEvaluations(tx, dealId);
      return [...evaluations.values()].filter((row) => row.policyBreach).map((row) => {
        const snapshot = row.snapshot as { words: string | null; structureText: string };
        return { key: row.criticalKey, words: snapshot.words, structureText: snapshot.structureText, rationale: row.rationale, findingId: row.findingId, evaluatedAt: row.evaluatedAt.toISOString() };
      });
    });
  }

  // --- Internals -----------------------------------------------------------------------------

  private async observe(tenant: TenantContext, dealId: string, structure: CriticalStructure, report: PackMetricsReport | null, asking: { amount: string; currency: string; id: string } | null, terms: readonly string[]) {
    const metric = CRITICAL_METRICS[structure.metric];
    const empty = { figures: [] as CriticalFigure[], citations: [] as (PanelFigure['citation'])[], evidenceIds: [] as string[], links: [] as FindingEvidenceLink[], formula: null as string | null, missingDetail: null as string | null, skip: null as string | null };
    const rowLinks = (ids: readonly string[]) => ids.slice(0, MAX_FINDING_LINKS).map((evidenceItemId) => link({ evidenceItemId }));
    if (metric.source.kind === 'PACK_METRIC') {
      const found = report?.metrics.find((entry) => entry.key === (metric.source as { metricKey: string }).metricKey);
      if (!found) return { ...empty, missingDetail: 'this pact’s pack does not compute it yet' };
      if (structure.lookbackYears !== null) {
        const years = (found.history ?? []).slice(-structure.lookbackYears);
        const figures = years.map((point): CriticalFigure => ({ period: point.period, value: point.value, source: 'CALCULATED' }));
        const evidenceIds = years.flatMap((point) => [...(point.evidenceIds ?? [])]);
        const missing = years.filter((point) => point.value === null).map((point) => point.period);
        return { ...empty, figures: figures.length ? figures : [], citations: figures.map(() => null), evidenceIds, links: rowLinks(evidenceIds), formula: `${found.formula}; year by year, the last ${structure.lookbackYears} years${found.coverage ? ` (${found.coverage})` : ''}`, missingDetail: missing.length ? `missing ${missing.join(', ')}` : found.unavailableReason ?? null };
      }
      const latest = found.history?.filter((point) => point.value !== null).at(-1);
      const evidenceIds = [...(latest?.evidenceIds ?? found.evidenceIds ?? [])];
      if (found.value === null) return { ...empty, formula: found.formula, missingDetail: found.unavailableReason ?? null };
      return { ...empty, figures: [{ period: latest?.period ?? null, value: found.value, source: 'CALCULATED' as const }], citations: [null], evidenceIds, links: rowLinks(evidenceIds), formula: found.formula };
    }
    if (metric.source.kind === 'CAP_RATE') {
      const noi = report?.metrics.find((entry) => entry.key === 'noi_latest') ?? null;
      const latest = noi?.history?.filter((point) => point.value !== null).at(-1);
      const rate = capRate(noi?.value ?? null, asking?.amount ?? null);
      const evidenceIds = [...(latest?.evidenceIds ?? [])];
      if (!rate || !noi?.value || !asking) return { ...empty, missingDetail: !noi?.value ? 'no operating statements imported' : 'no asking price recorded' };
      return {
        ...empty,
        figures: [{ period: latest?.period ?? null, value: rate, source: 'CALCULATED' as const }],
        citations: [null],
        evidenceIds,
        links: rowLinks(evidenceIds),
        formula: `Net operating income ${latest?.period ?? ''} (${asking.currency} ${noi.value}) ÷ the asking price (${asking.currency} ${asking.amount})`.replace('  ', ' '),
      };
    }
    // Document text: the pages that name the metric, read by AI with an exact quote verified on the page.
    const pages = await withTenant(this.prisma, tenant, (tx) =>
      tx.documentPage.findMany({
        where: { dealId, document: { status: 'AVAILABLE', aiExcluded: false, dataClass: { in: [...CITABLE_CLASSES] } }, OR: terms.map((term) => ({ text: { contains: term, mode: 'insensitive' as const } })) },
        select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
        orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
        take: DOCUMENT_PAGES_PER_METRIC,
      }),
    );
    const readable = pages.flatMap((page) => (page.text && !PROHIBITED.has(page.document.dataClass) ? [{ ...page, text: page.text }] : []));
    if (readable.length === 0) return { ...empty, missingDetail: 'no document in the pact mentions it' };
    const sources: CitableSource[] = readable.map((page) => ({ citationId: newId(), documentId: page.documentId, documentName: page.document.fileName, pageNumber: page.pageNumber, text: page.text, classification: page.document.dataClass as CitableSource['classification'] }));
    let outcome;
    try {
      outcome = await extractCriticalFigures(this.gateway, { organizationId: tenant.organizationId, dealId, metric: `${metric.label} (${metric.unit === 'RATIO' ? 'a percentage' : metric.unit === 'MULTIPLE' ? 'a multiple' : 'years'})`, sources });
    } catch (error) {
      if (error instanceof GatewayPolicyError) return { ...empty, skip: 'AI is not available to read the documents; nothing was rated. Try again when it is.' };
      throw error;
    }
    await this.recordRun(tenant, outcome.run);
    if (outcome.run.status === 'PROVIDER_ERROR') return { ...empty, skip: 'AI could not read the documents just now; nothing was rated. Try again.' };
    if (outcome.figures.length === 0) return { ...empty, missingDetail: 'the documents that mention it state no figure for it' };
    const names = new Map(readable.map((page) => [page.documentId, page.document.fileName]));
    return {
      ...empty,
      figures: outcome.figures.map((figure) => ({ period: figure.period, value: metric.unit === 'RATIO' ? percentToRatio(figure.value) : figure.value, source: 'DOCUMENT' as const })),
      citations: outcome.figures.map((figure) => ({ documentId: figure.citation.documentId, documentName: names.get(figure.citation.documentId) ?? null, pageNumber: figure.citation.pageNumber, quote: figure.citation.quote })),
      links: outcome.figures.map((figure) => link({ documentCitation: { documentId: figure.citation.documentId, pageNumber: figure.citation.pageNumber, quote: figure.citation.quote, quoteHash: figure.citation.quoteHash, charStart: figure.citation.charStart, charEnd: figure.citation.charEnd } })),
      formula: `As stated in the documents (${CRITICAL_METRICS[structure.metric].label}), each quote verified on its page`,
    };
  }

  private figureView(figure: CriticalFigure & { outcome: FigureOutcome }, unit: (typeof CRITICAL_METRICS)[CriticalMetricId]['unit']): Omit<PanelFigure, 'citation'> {
    return { period: figure.period, value: figure.value, display: figure.value === null ? null : formatCriticalValue(figure.value, unit), outcome: figure.outcome, source: figure.source };
  }

  /** Bad → a −1 finding (a policy breach when it is an org standard); Good → +1 confirmed value; Even and No evidence → none. */
  private async draftFinding(tenant: TenantContext, dealId: string, target: { origin: 'ORG' | 'PACT'; critical: CriticalRow; override: CriticalRow | null; structure: CriticalStructure }, rating: CriticalRating, receipts: Receipts, links: readonly FindingEvidenceLink[], policyBreach: boolean, requestId: string): Promise<string | null> {
    const rule = criticalDirectionFor(rating);
    if (!rule.raisesFinding || links.length === 0) return null;
    const metric = CRITICAL_METRICS[target.structure.metric];
    const text = describeStructure(target.structure);
    const name = target.critical.words ?? text;
    const figures = receipts.figures.map((figure) => `${figure.period ?? 'figure'}: ${figure.display ?? 'not in the pact'} (${figure.outcome.toLowerCase()})`).join('; ');
    const stamp = `${target.critical.criticalKey}:v${target.critical.version}${target.override ? `:o${target.override.version}` : ''}`;
    const digest = createHash('sha256').update(JSON.stringify(receipts.figures.map((figure) => [figure.period, figure.value]))).digest('hex').slice(0, 16);
    const origin = target.origin === 'ORG' ? (target.override ? 'Org standard (overridden for this pact)' : 'Org standard') : 'This pact';
    const proposal: ProposedFinding = {
      domain: metric.findingDomain,
      title: (rating === 'BAD' ? `${policyBreach ? 'Policy breach' : 'Deal critical missed'}: ${name}` : `Deal critical met: ${name}`).slice(0, 160),
      description: `${origin}: ${text}. Rated ${CRITICAL_RATING_LABELS[rating]} (${CRITICALS_ENGINE_VERSION}) on ${figures}.${receipts.formula ? ` ${receipts.formula}.` : ''}${target.override?.reason ? ` Override reason: ${target.override.reason}` : ''}`.slice(0, 4000),
      severity: rating === 'BAD' ? (policyBreach ? 'HIGH' : 'MEDIUM') : 'LOW',
      confidence: receipts.figures.every((figure) => figure.source === 'CALCULATED') ? 'HIGH' : 'MEDIUM',
      origin: 'HEURISTIC',
      fingerprint: `critical:${stamp}:${rating}:${digest}`,
      evidence: links,
      // A drag is priced by a person before acceptance; a critical never prices itself.
      pricedRisk: null,
      direction: rule.defaultDirection,
      directionRationale: rule.rationale,
      valueConfirmation: rating === 'GOOD' ? { valueDriver: `Deal critical: ${name}`.slice(0, 200), impliedValue: null, basis: `${text}, met on the evidence (${CRITICALS_ENGINE_VERSION}). Value confirmed, never price paid.` } : null,
    };
    const { created } = await this.findings.recordProposals(tenant, dealId, [proposal], { kind: 'SYSTEM', component: `criticals@${CRITICALS_ENGINE_VERSION}` }, requestId);
    if (created[0]) return created[0].id;
    const existing = await withTenant(this.prisma, tenant, (tx) => tx.finding.findFirst({ where: { dealId, fingerprint: proposal.fingerprint }, select: { id: true } }));
    return existing?.id ?? null;
  }

  private async recordRun(tenant: TenantContext, run: AiRunRecord) {
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.aiRun.create({
        data: {
          id: run.id,
          organizationId: run.organizationId,
          dealId: run.dealId,
          taskType: run.taskType,
          promptId: run.promptId,
          promptVersion: run.promptVersion,
          promptHash: run.promptHash,
          modelAlias: run.modelAlias,
          resolvedModelId: run.resolvedModelId,
          resolvedProvider: run.resolvedProvider,
          jobType: run.jobType,
          fallbackFrom: run.fallbackFrom,
          fallbackReason: run.fallbackReason,
          inputHashes: [...run.inputHashes],
          outputHash: run.outputHash,
          status: run.status,
          repairAttempted: run.repairAttempted,
          injectionSignals: run.injectionSignals,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          latencyMs: run.latencyMs,
          createdAt: new Date(run.createdAt),
        },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: run.dealId, actorUserId: tenant.userId, action: 'criticals.extraction.completed', targetType: 'ai_run', targetId: run.id, outcome: 'ALLOWED' });
    });
  }

  /** The AI's proposal from the words, or the person's structure; either way inert until confirmed. */
  private async propose(tenant: TenantContext, dealId: string | null, words: string | null, structure: CriticalStructureInput | null, companyType: CompanyType | null): Promise<{ structure: CriticalStructure | null; source: 'AI' | 'PERSON' | null; question: string | null }> {
    if (structure) return { structure: this.toStructure(structure), source: 'PERSON', question: null };
    if (!words) return { structure: null, source: null, question: null };
    let outcome;
    try {
      // An org standard belongs to no pact: the run is attributed to the organization only (audited, never stored as a deal's run).
      outcome = await proposeCriticalStructure(this.gateway, { organizationId: tenant.organizationId, dealId: dealId ?? '00000000-0000-0000-0000-000000000000', words, companyType: companyType ?? 'ALL' });
    } catch (error) {
      if (error instanceof GatewayPolicyError) return { structure: null, source: null, question: 'AI is not available to read the words; enter the structure yourself.' };
      throw error;
    }
    if (dealId) await this.recordRun(tenant, outcome.run);
    const proposal = outcome.proposal;
    if (!proposal || !proposal.metric || !proposal.comparator || !proposal.threshold) return { structure: null, source: null, question: proposal?.question ?? 'Pactlab could not read a metric and threshold from the words; enter the structure yourself.' };
    const unit = CRITICAL_METRICS[proposal.metric].unit;
    const proposed: CriticalStructure = {
      metric: proposal.metric,
      comparator: proposal.comparator,
      threshold: unit === 'RATIO' ? percentToRatio(proposal.threshold) : proposal.threshold,
      lookbackYears: CRITICAL_METRICS[proposal.metric].lookback ? proposal.lookbackYears : null,
      evenBand: proposal.evenBand === null ? null : unit === 'RATIO' ? percentToRatio(proposal.evenBand) : proposal.evenBand,
    };
    return { structure: proposed, source: 'AI', question: proposal.question };
  }

  private toStructure(input: CriticalStructureInput): CriticalStructure {
    return { metric: input.metric, comparator: input.comparator, threshold: canonicalDecimal(input.threshold), lookbackYears: input.lookbackYears, evenBand: input.evenBand === null ? null : canonicalDecimal(input.evenBand) };
  }

  private async revise(tenant: TenantContext, head: CriticalRow, body: ReviseCriticalBody, requestId: string) {
    const companyType = head.scope === 'ORG' ? (head.companyType as CompanyType | null) : (await this.deal(tenant, head.dealId ?? '')).companyType;
    const words = body.words ?? head.words;
    const proposal = body.structure || body.words ? await this.propose(tenant, head.dealId, body.words ?? null, body.structure ?? null, companyType) : { structure: structureOf(head), source: head.structureSource as 'AI' | 'PERSON' | null, question: null };
    const row = await this.insert(tenant, { ...this.carry(head), version: head.version + 1, words, structure: proposal.structure ?? (body.words ? null : structureOf(head)), source: proposal.source, state: 'PROPOSED', reason: 'Edited' }, head.scope === 'ORG' ? 'criticals.standard_revised' : 'criticals.pact_revised', requestId);
    return this.view(row, proposal.question);
  }

  private async confirm(tenant: TenantContext, head: CriticalRow, body: ConfirmCriticalBody, requestId: string) {
    if (head.state === 'RETIRED') throw new UnprocessableEntityException({ code: 'RETIRED', message: 'That critical was retired' });
    const companyType = head.scope === 'ORG' ? (head.companyType as CompanyType | null) : (await this.deal(tenant, head.dealId ?? '')).companyType;
    const structure = this.toStructure(body.structure);
    const problem = structureProblem(structure, companyType);
    if (problem) throw new UnprocessableEntityException({ code: 'STRUCTURE_INVALID', message: problem });
    // The AI's form, confirmed unchanged, stays the AI's; a corrected one is the person's.
    const source = head.structureSource === 'AI' && sameStructure(structureOf(head), structure) ? 'AI' : 'PERSON';
    const row = await this.insert(tenant, { ...this.carry(head), version: head.version + 1, structure, source, state: 'CONFIRMED', reason: 'Confirmed' }, head.scope === 'ORG' ? 'criticals.standard_confirmed' : 'criticals.pact_confirmed', requestId);
    return this.view(row, null);
  }

  private carry(head: CriticalRow) {
    return { dealId: head.dealId, scope: head.scope as 'ORG' | 'PACT', companyType: head.companyType, criticalKey: head.criticalKey, overridesKey: head.overridesKey, words: head.words, structure: structureOf(head), source: head.structureSource as 'AI' | 'PERSON' | null, promotedFromKey: head.promotedFromKey };
  }

  private async insert(
    tenant: TenantContext,
    input: { dealId: string | null; scope: 'ORG' | 'PACT'; companyType: string | null; criticalKey: string; version: number; overridesKey?: string | null; words: string | null; structure: CriticalStructure | null; source: 'AI' | 'PERSON' | null; state: CriticalState; reason: string; promotedFromKey?: string | null },
    action: string,
    requestId: string,
  ): Promise<CriticalRow> {
    try {
      return await withTenant(this.prisma, tenant, async (tx) => {
        const row = await tx.dealCritical.create({
          data: {
            id: newId(),
            organizationId: tenant.organizationId,
            dealId: input.dealId,
            criticalKey: input.criticalKey,
            version: input.version,
            scope: input.scope,
            companyType: input.companyType,
            overridesKey: input.overridesKey ?? null,
            words: input.words,
            metric: input.structure?.metric ?? null,
            comparator: input.structure?.comparator ?? null,
            threshold: input.structure?.threshold ?? null,
            lookbackYears: input.structure?.lookbackYears ?? null,
            evenBand: input.structure?.evenBand ?? null,
            state: input.state,
            structureSource: input.structure ? input.source : null,
            reason: input.reason,
            promotedFromKey: input.promotedFromKey ?? null,
            createdBy: tenant.userId,
          },
        });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId: input.dealId, actorUserId: tenant.userId, action, targetType: 'deal_critical', targetId: row.id, outcome: 'ALLOWED', requestId });
        return row as unknown as CriticalRow;
      });
    } catch (error) {
      // A concurrent edit of the same version reaches the person as 409: reload and retry.
      if (error instanceof Error && (error as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Someone changed this critical meanwhile; reload it' });
      throw error;
    }
  }

  private view(row: CriticalRow, question: string | null): CriticalView {
    const structure = structureOf(row);
    const companyType = row.scope === 'ORG' ? (row.companyType as CompanyType | null) : null;
    return {
      key: row.criticalKey,
      version: row.version,
      scope: row.scope as 'ORG' | 'PACT',
      companyType,
      words: row.words,
      structure,
      structureText: textOf(structure),
      structureSource: row.structureSource as 'AI' | 'PERSON' | null,
      state: row.state as CriticalState,
      evaluates: row.state === 'CONFIRMED' && structure !== null,
      problem: row.state === 'PROPOSED' ? (structure ? (row.scope === 'ORG' ? structureProblem(structure, companyType) : null) : 'No structured form yet: enter the metric and threshold, then confirm.') : null,
      question,
      promotedFromKey: row.promotedFromKey,
      reason: row.reason,
      updatedAt: row.createdAt.toISOString(),
      updatedBy: row.createdBy,
    };
  }

  private async requireHead(tenant: TenantContext, criticalKey: string, scope: 'ORG' | 'PACT', dealId: string | null, version: number | null): Promise<CriticalRow> {
    const head = await withTenant(this.prisma, tenant, async (tx) => {
      // bounded: one critical's versions (each a person's edit, confirmation or override change)
      const rows = (await tx.dealCritical.findMany({ where: { criticalKey, scope, dealId }, orderBy: { version: 'desc' }, take: 1 })) as unknown as CriticalRow[];
      return rows[0] ?? null;
    });
    if (!head) throw new NotFoundException();
    if (version !== null && head.version !== version) throw new ConflictException({ code: 'VERSION_CONFLICT', message: `This critical is at version ${head.version}; reload it` });
    return head;
  }

  /** The latest version of every critical in a scope (raw SQL: DISTINCT ON keeps the newest version per key). */
  private async heads(tx: TransactionClient, where: { scope: 'ORG' } | { scope: 'PACT'; dealId: string }): Promise<CriticalRow[]> {
    const limit = where.scope === 'ORG' ? CRITICAL_LIBRARY_LIMIT * 2 : CRITICAL_PACT_LIMIT * 4;
    const rows =
      where.scope === 'ORG'
        ? await tx.$queryRawUnsafe<RawCritical[]>(`SELECT * FROM (SELECT DISTINCT ON (critical_key) * FROM deal_criticals WHERE scope = 'ORG' ORDER BY critical_key, version DESC) heads ORDER BY created_at DESC, id DESC LIMIT ${limit}`)
        : await tx.$queryRawUnsafe<RawCritical[]>(`SELECT * FROM (SELECT DISTINCT ON (critical_key) * FROM deal_criticals WHERE scope = 'PACT' AND deal_id = $1::uuid ORDER BY critical_key, version DESC) heads ORDER BY created_at ASC, id ASC LIMIT ${limit}`, where.dealId);
    return rows.map(fromRaw);
  }

  private async applicableStandards(tx: TransactionClient, companyType: CompanyType | null): Promise<CriticalRow[]> {
    return (await this.heads(tx, { scope: 'ORG' }))
      .filter((row) => row.state === 'CONFIRMED' && (row.companyType === null || row.companyType === companyType))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  /** The pact's set: the org standards of its type as overridden, plus its pact-only criticals. */
  private async effective(tx: TransactionClient, dealId: string, companyType: CompanyType | null) {
    const standards = await this.applicableStandards(tx, companyType);
    const pact = await this.heads(tx, { scope: 'PACT', dealId });
    const overrides = new Map(pact.filter((row) => row.overridesKey && row.state !== 'RETIRED').map((row) => [row.overridesKey as string, row]));
    return {
      standards: standards.map((standard) => ({ standard, override: overrides.get(standard.criticalKey) ?? null })),
      pact: pact.filter((row) => !row.overridesKey && row.state !== 'RETIRED'),
    };
  }

  private async latestEvaluations(tx: TransactionClient, dealId: string): Promise<Map<string, EvaluationRow>> {
    const rows = await tx.$queryRawUnsafe<RawEvaluation[]>(
      `SELECT DISTINCT ON (critical_key) * FROM critical_evaluations WHERE deal_id = $1::uuid ORDER BY critical_key, evaluated_at DESC, id DESC LIMIT ${CRITICAL_LIBRARY_LIMIT + CRITICAL_PACT_LIMIT}`,
      dealId,
    );
    return new Map(rows.map((row) => [row.critical_key, fromRawEvaluation(row)]));
  }

  /** What the pact holds: active evidence, documents and the asking price. A different mark later means a rating is stale. */
  private async evidenceMark(tx: TransactionClient, dealId: string): Promise<string> {
    const [evidence] = await tx.$queryRawUnsafe<{ n: number; latest: Date | null }[]>(`SELECT count(*)::int AS n, max(created_at) AS latest FROM evidence_items WHERE deal_id = $1::uuid AND ${ACTIVE_EVIDENCE_SQL}`, dealId);
    const [documents] = await tx.$queryRawUnsafe<{ n: number; latest: Date | null }[]>(`SELECT count(*)::int AS n, max(created_at) AS latest FROM documents WHERE deal_id = $1::uuid AND status = 'AVAILABLE'`, dealId);
    const asking = (await askingPrices.currentFor(tx, [dealId])).get(dealId);
    return createHash('sha256').update(JSON.stringify([evidence?.n, evidence?.latest, documents?.n, documents?.latest, asking?.id ?? null])).digest('hex').slice(0, 24);
  }

  private async documentNames(tx: TransactionClient, dealId: string, evaluations: Map<string, EvaluationRow>) {
    const ids = [...new Set([...evaluations.values()].flatMap((row) => ((row.receipts as Receipts).figures ?? []).flatMap((figure) => (figure.citation ? [figure.citation.documentId] : []))))];
    if (ids.length === 0) return new Map<string, string>();
    // bounded: the documents the panel's cited figures name (a few per document critical)
    const rows = await tx.document.findMany({ where: { dealId, id: { in: ids } }, select: { id: true, fileName: true } });
    return new Map(rows.map((row) => [row.id, row.fileName]));
  }

  private panelRow(origin: 'ORG' | 'PACT', critical: CriticalRow, override: CriticalRow | null, evaluation: EvaluationRow | null, mark: string, names: Map<string, string>): PanelRow {
    const standardStructure = structureOf(critical);
    const structure = override ? (override.state === 'DISABLED' ? null : structureOf(override)) : standardStructure;
    const metricId = (structure ?? standardStructure)?.metric ?? null;
    const snapshot = evaluation ? (evaluation.snapshot as { structureText: string }) : null;
    const receipts = evaluation ? (evaluation.receipts as Receipts) : null;
    const olderVersion = !!evaluation && (evaluation.criticalVersion !== critical.version || (evaluation.overrideVersion ?? null) !== (override?.version ?? null));
    return {
      key: critical.criticalKey,
      origin,
      words: critical.words,
      version: critical.version,
      state: (override?.state === 'DISABLED' ? 'DISABLED' : critical.state) as CriticalState,
      structure,
      structureText: textOf(structure),
      standard: override ? { version: critical.version, structureText: textOf(standardStructure) } : null,
      override: override ? { key: override.criticalKey, version: override.version, disabled: override.state === 'DISABLED', structureText: textOf(structureOf(override)), reason: override.reason ?? '', by: override.createdBy, at: override.createdAt.toISOString() } : null,
      metric: metricId ? { id: metricId, label: CRITICAL_METRICS[metricId].label, settles: CRITICAL_METRICS[metricId].settles, requests: CRITICAL_METRICS[metricId].requests } : null,
      evaluation:
        evaluation && receipts
          ? {
              runId: evaluation.runId,
              rating: evaluation.rating as CriticalRating,
              ratingLabel: CRITICAL_RATING_LABELS[evaluation.rating as CriticalRating],
              rationale: evaluation.rationale,
              missing: evaluation.missing,
              requests: evaluation.rating === 'NO_EVIDENCE' && metricId ? CRITICAL_METRICS[metricId].requests : null,
              policyBreach: evaluation.policyBreach,
              findingId: evaluation.findingId,
              figures: receipts.figures.map((figure) => ({ ...figure, citation: figure.citation ? { ...figure.citation, documentName: names.get(figure.citation.documentId) ?? figure.citation.documentName } : null })),
              formula: receipts.formula,
              evidenceIds: receipts.evidenceIds,
              ratedVersion: evaluation.criticalVersion,
              ratedOverrideVersion: evaluation.overrideVersion,
              ratedStructureText: snapshot?.structureText ?? null,
              olderVersion,
              stale: evaluation.evidenceMark !== mark,
              evaluatedAt: evaluation.evaluatedAt.toISOString(),
              engineVersion: evaluation.engineVersion,
            }
          : null,
    };
  }

  private async deal(tenant: TenantContext, dealId: string): Promise<{ companyType: CompanyType | null }> {
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { id: true } });
      if (!deal) throw new NotFoundException();
      const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true } });
      const type = seller?.companyType ?? null;
      return { companyType: type && (COMPANY_TYPES as readonly string[]).includes(type) ? (type as CompanyType) : null };
    });
  }
}

const textOf = (structure: CriticalStructure | null) => (structure ? describeStructure(structure) : null);
const canonicalDecimal = (text: string) => {
  const negative = text.startsWith('-');
  const body = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  const trimmed = body.includes('.') ? body.replace(/0+$/, '').replace(/\.$/, '') : body;
  return negative && /[1-9]/.test(trimmed) ? `-${trimmed}` : trimmed;
};

const link = (input: { evidenceItemId?: string; documentCitation?: DocumentCitation }): FindingEvidenceLink => ({
  evidenceItemId: input.evidenceItemId ?? null,
  documentCitation: input.documentCitation ?? null,
  commitSha: null,
  toolName: TOOL,
  toolVersion: CRITICALS_ENGINE_VERSION,
  rulesetVersion: null,
  path: null,
  lineStart: null,
  lineEnd: null,
});

function decodeLibraryCursor(cursor: string, rows: readonly CriticalRow[]): number {
  try {
    const [, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const at = rows.findIndex((row) => row.id === id);
    return at < 0 ? 0 : at + 1;
  } catch {
    return 0;
  }
}

interface RawCritical {
  id: string;
  organization_id: string;
  deal_id: string | null;
  critical_key: string;
  version: number;
  scope: string;
  company_type: string | null;
  overrides_key: string | null;
  words: string | null;
  metric: string | null;
  comparator: string | null;
  threshold: string | null;
  lookback_years: number | null;
  even_band: string | null;
  state: string;
  structure_source: string | null;
  reason: string | null;
  promoted_from_key: string | null;
  created_by: string;
  created_at: Date;
}

const fromRaw = (row: RawCritical): CriticalRow => ({
  id: row.id,
  organizationId: row.organization_id,
  dealId: row.deal_id,
  criticalKey: row.critical_key,
  version: row.version,
  scope: row.scope,
  companyType: row.company_type,
  overridesKey: row.overrides_key,
  words: row.words,
  metric: row.metric,
  comparator: row.comparator,
  threshold: row.threshold === null ? null : String(row.threshold),
  lookbackYears: row.lookback_years,
  evenBand: row.even_band === null ? null : String(row.even_band),
  state: row.state,
  structureSource: row.structure_source,
  reason: row.reason,
  promotedFromKey: row.promoted_from_key,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
});

interface RawEvaluation {
  id: string;
  run_id: string;
  critical_key: string;
  critical_version: number;
  origin: string;
  override_key: string | null;
  override_version: number | null;
  snapshot: unknown;
  rating: string;
  receipts: unknown;
  rationale: string;
  missing: string | null;
  policy_breach: boolean;
  finding_id: string | null;
  evidence_mark: string;
  engine_version: string;
  evaluated_at: Date;
}

const fromRawEvaluation = (row: RawEvaluation): EvaluationRow => ({
  id: row.id,
  runId: row.run_id,
  criticalKey: row.critical_key,
  criticalVersion: row.critical_version,
  origin: row.origin,
  overrideKey: row.override_key,
  overrideVersion: row.override_version,
  snapshot: row.snapshot,
  rating: row.rating,
  receipts: row.receipts,
  rationale: row.rationale,
  missing: row.missing,
  policyBreach: row.policy_breach,
  findingId: row.finding_id,
  evidenceMark: row.evidence_mark,
  engineVersion: row.engine_version,
  evaluatedAt: new Date(row.evaluated_at),
});

