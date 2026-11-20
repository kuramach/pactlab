import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { citationStillValid, figuresIn, PROHIBITED_CLASSIFICATIONS, SourceIndex, type CitableSource } from '@pactlab/ai';
import {
  D,
  offeringChecks,
  OFFERING_CHECKS_ID,
  OFFERING_CHECKS_VERSION,
  PRIOR_DEAL,
  runWaterfall,
  WaterfallError,
  waterfallTermsFrom,
  type OfferingCheckItem,
  type OfferingClaimOutcome,
  type WaterfallResult,
} from '@pactlab/calculations';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  newId,
  OFFERING_KIND_REGISTRY,
  OFFERING_SCENARIOS,
  OFFERING_SOURCE_CATEGORY,
  OFFERING_SOURCE_LABELS,
  permissionsForDealRole,
  ruleProposals,
  SCENARIO_LABEL,
  SYNDICATION_GUARDRAIL,
  type DealRole,
  type DocumentCitation,
  type FindingRule,
  type OfferingItemKind,
  type OfferingScenario,
  type OfferingSource,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { loadPackEvidence, type PackEvidenceRow } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import type { DecisionBody, ExtractBody, ItemBody, OfferingBody } from './syndication.schemas';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
const CITABLE_CLASSES = ['PUBLIC', 'BUSINESS', 'FINANCIAL'] as const;
const CITABLE = new Set<string>(CITABLE_CLASSES);
const T12 = 'multifamily.t12_month';
/** The intake category of each offering document, back to its source. */
const OFFERING_CATEGORY_SOURCE: Readonly<Record<string, OfferingSource>> = Object.fromEntries(Object.entries(OFFERING_SOURCE_CATEGORY).map(([source, category]) => [category, source as OfferingSource]));
const UNIT = 'multifamily.unit';

type ItemRow = Awaited<ReturnType<TransactionClient['syndicationOfferingItem']['findMany']>>[number];
type OfferingRow = NonNullable<Awaited<ReturnType<TransactionClient['syndicationOffering']['findFirst']>>>;

/** A decimal column as a plain string ("8", "1.85"), never a float. */
const plain = (value: { toFixed(digits: number): string } | null) => (value === null ? null : value.toFixed(6).replace(/\.?0+$/, '') || '0');
const canonical = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text).replace(/^0+(?=\d)/, '');

export interface OfferingItemView {
  id: string;
  kind: OfferingItemKind;
  group: 'TERM' | 'CLAIM';
  kindLabel: string;
  source: OfferingSource;
  sourceLabel: string;
  label: string | null;
  value: string | null;
  hurdle: string | null;
  status: string;
  origin: string;
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string; valid: boolean };
  /** For claims: where the checks leave it (VERIFIED, CONTRADICTED, UNVERIFIED) and why. */
  check: { status: OfferingClaimOutcome['status']; rationale: string } | null;
  decidedAt: string | null;
}

export interface ScenarioView {
  scenario: OfferingScenario;
  noiGrowthPct: string;
  exitCapPct: string;
  result: WaterfallResult | null;
  error: string | null;
}

/**
 * Multifamily syndication, the sponsor's side (T-106, ADR 0037). The offering's terms and claims
 * are read from the PPM, operating agreement and deck by AI (`offering.extract`) as PROPOSED
 * items with exact quotes; the sponsor confirms, corrects or rejects each. Only confirmed items
 * feed the deterministic waterfall (`syndication-waterfall-1`) and the offering checks, whose
 * drafts go to the one findings register and whose claim outcomes go to the claims register.
 * Everything here is the sponsor's own side (RLS and BUYER_ANALYSIS_READ): the seller never
 * sees the raise. Diligence support only — no legal advice or accreditation determination.
 */
@Injectable()
export class SyndicationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(FindingsService) private readonly findings: FindingsService,
  ) {}

  /** The pact must be a syndication: the section and every route exist only for this pack. */
  private async requireSyndication(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'MULTIFAMILY_SYNDICATION') throw new UnprocessableEntityException({ code: 'NOT_A_SYNDICATION', message: 'This pact is not a multifamily syndication' });
    return deal;
  }

  /** Verify a quote on its stored page; never people data, never a purged document. */
  private async verify(tx: TransactionClient, dealId: string, documentId: string, pageNumber: number, quote: string): Promise<DocumentCitation> {
    const page = await tx.documentPage.findFirst({
      where: { dealId, documentId, pageNumber },
      select: { text: true, document: { select: { fileName: true, dataClass: true, status: true } } },
    });
    if (!page || page.text === null || page.document.status !== 'AVAILABLE') throw new UnprocessableEntityException({ code: 'PAGE_UNAVAILABLE', message: 'That document page is not available' });
    if (PROHIBITED.has(page.document.dataClass) || !CITABLE.has(page.document.dataClass)) throw new UnprocessableEntityException({ code: 'NOT_CITABLE', message: 'That document cannot be cited for the offering' });
    const citable: CitableSource = { citationId: `${documentId}:${pageNumber}`, documentId, documentName: page.document.fileName, pageNumber, text: page.text, classification: page.document.dataClass };
    const check = new SourceIndex([citable]).verify({ citationId: citable.citationId, quote });
    if (!check.ok) throw new UnprocessableEntityException({ code: check.reason, message: `Citation refused: ${check.reason}` });
    const { citationId: _id, ...citation } = check.citation;
    return citation;
  }

  /** No invented numbers: every figure of an item must be written in its quote. */
  private requireFigures(quote: string, figures: readonly (string | null | undefined)[]) {
    const written = figuresIn(quote);
    if (figures.some((figure) => figure != null && !written.has(canonical(figure))))
      throw new UnprocessableEntityException({ code: 'FIGURE_NOT_IN_QUOTE', message: 'Every figure must appear in the quoted text' });
  }

  private requireShape(kind: OfferingItemKind, label: string | null, value: string | null, hurdle: string | null) {
    const definition = OFFERING_KIND_REGISTRY[kind];
    if (definition.labelled !== (label !== null)) throw new UnprocessableEntityException({ code: 'LABEL', message: definition.labelled ? 'Name the fee or the prior deal' : 'Only a named fee or a prior deal takes a label' });
    if (hurdle !== null && !definition.tier) throw new UnprocessableEntityException({ code: 'HURDLE', message: 'Only a promote tier has a hurdle' });
    if (value === null && kind !== 'CATCH_UP') throw new UnprocessableEntityException({ code: 'VALUE', message: 'Give the figure the document states' });
  }

  private async items(tx: TransactionClient, dealId: string): Promise<ItemRow[]> {
    // bounded: one pact's offering items (tens per document: fees, tiers and claims), three documents
    return tx.syndicationOfferingItem.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1000 });
  }

  private checkItems(rows: readonly ItemRow[]): OfferingCheckItem[] {
    return rows
      .filter((row) => row.status === 'CONFIRMED')
      .map((row) => {
        const citation = row.citation as unknown as DocumentCitation;
        return { id: row.id, kind: row.kind, source: row.source as OfferingSource, label: row.label, value: plain(row.value), hurdle: plain(row.hurdle), documentId: citation.documentId, pageNumber: citation.pageNumber, quote: citation.quote };
      });
  }

  /** The waterfall on each path, from the operating agreement's confirmed terms. */
  private scenarios(offering: OfferingRow | null, items: readonly OfferingCheckItem[], t12Noi: InstanceType<typeof D> | null) {
    const { terms, missing, unmodelled } = waterfallTermsFrom(items);
    const noi = offering?.noiYear1 ? new D(offering.noiYear1.toString()) : t12Noi;
    const why = !offering
      ? 'Enter the offering (price, loan, raise and paths) first.'
      : !terms
        ? `Confirm ${missing.join(' and ')} from the operating agreement first.`
        : !noi
          ? 'Import the T-12 operating statement, or enter the year-1 NOI.'
          : null;
    const paths: Record<OfferingScenario, [string, string]> = offering
      ? {
          DOWNSIDE: [offering.downsideNoiGrowthPct.toString(), offering.downsideExitCapPct.toString()],
          BASE: [offering.baseNoiGrowthPct.toString(), offering.baseExitCapPct.toString()],
          UPSIDE: [offering.upsideNoiGrowthPct.toString(), offering.upsideExitCapPct.toString()],
        }
      : { DOWNSIDE: ['0', '0'], BASE: ['0', '0'], UPSIDE: ['0', '0'] };
    const views: ScenarioView[] = OFFERING_SCENARIOS.map((scenario) => {
      const [growth, cap] = paths[scenario];
      if (why || !offering || !terms || !noi) return { scenario, noiGrowthPct: growth, exitCapPct: cap, result: null, error: why };
      try {
        const result = runWaterfall(terms, {
          purchasePrice: new D(offering.purchasePrice.toString()),
          loanAmount: new D(offering.loanAmount.toString()),
          interestRate: new D(offering.interestRatePct.toString()).dividedBy(100),
          equity: new D(offering.equityRaise.toString()),
          holdYears: offering.holdYears,
          noiYear1: noi,
          noiGrowth: new D(growth).dividedBy(100),
          exitCapRate: new D(cap).dividedBy(100),
          sellingCosts: new D(offering.sellingCostsPct.toString()).dividedBy(100),
        });
        return { scenario, noiGrowthPct: plain(new D(growth))!, exitCapPct: plain(new D(cap))!, result, error: null };
      } catch (error) {
        if (error instanceof WaterfallError) return { scenario, noiGrowthPct: growth, exitCapPct: cap, result: null, error: error.message };
        throw error;
      }
    });
    return { views, missing, unmodelled, noiSource: offering?.noiYear1 ? 'ENTERED' : t12Noi ? 'T12' : null, noi: noi ? noi.toFixed(2) : null, why };
  }

  /** Everything the checks read: confirmed items, the waterfall, the track record and the rent roll. */
  private async inputs(tx: TransactionClient, dealId: string) {
    const [offering, rows, evidence] = await Promise.all([
      tx.syndicationOffering.findFirst({ where: { dealId } }),
      this.items(tx, dealId),
      loadPackEvidence(tx, dealId, [PRIOR_DEAL, UNIT, T12]),
    ]);
    const t12 = evidence.filter((row) => row.evidenceType === T12);
    const t12Noi = t12.length ? t12.reduce((total, row) => total.plus(row.canonical['net_operating_income'] ?? '0'), new D(0)) : null;
    const items = this.checkItems(rows);
    const waterfall = this.scenarios(offering, items, t12Noi);
    const base = waterfall.views.find((view) => view.scenario === 'BASE')!;
    const checks = offeringChecks({ items, base: base.result, baseUnavailable: base.error, evidence: evidence.filter((row) => row.evidenceType !== T12) });
    return { offering, rows, evidence, items, waterfall, checks };
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'syndication.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireSyndication(tx, dealId);
      const { offering, rows, evidence, waterfall, checks } = await this.inputs(tx, dealId);
      const cited = rows.map((row) => row.citation as unknown as DocumentCitation);
      const pairs = [...new Map(cited.map((c) => [`${c.documentId}:${c.pageNumber}`, c])).values()];
      // bounded: the pages the items above cite
      const pages = pairs.length
        ? await tx.documentPage.findMany({
            where: { dealId, OR: pairs.map((c) => ({ documentId: c.documentId, pageNumber: c.pageNumber })) },
            select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, status: true } } },
          })
        : [];
      // The documents the sponsor can have read; offering categories first. A pact's documents are tens, capped here.
      const documents = await tx.document.findMany({
        where: { dealId, status: 'AVAILABLE', aiExcluded: false, dataClass: { in: [...CITABLE_CLASSES] } },
        select: { id: true, fileName: true, intakeCategory: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const offeringFirst = (category: string | null) => (category && OFFERING_CATEGORY_SOURCE[category] ? 0 : 1);
      documents.sort((a, b) => offeringFirst(a.intakeCategory) - offeringFirst(b.intakeCategory));
      const outcome = new Map(checks.claims.map((claim) => [claim.itemId, claim]));
      const items: OfferingItemView[] = rows.map((row) => {
        const citation = row.citation as unknown as DocumentCitation;
        const page = pages.find((candidate) => candidate.documentId === citation.documentId && candidate.pageNumber === citation.pageNumber);
        const kind = row.kind as OfferingItemKind;
        const check = outcome.get(row.id);
        return {
          id: row.id,
          kind,
          group: OFFERING_KIND_REGISTRY[kind].group,
          kindLabel: OFFERING_KIND_REGISTRY[kind].label,
          source: row.source as OfferingSource,
          sourceLabel: OFFERING_SOURCE_LABELS[row.source as OfferingSource],
          label: row.label,
          value: plain(row.value),
          hurdle: plain(row.hurdle),
          status: row.status,
          origin: row.origin,
          citation: {
            documentId: citation.documentId,
            documentName: page?.document.fileName ?? null,
            pageNumber: citation.pageNumber,
            quote: citation.quote,
            valid: page?.text != null && page.document.status === 'AVAILABLE' && citationStillValid({ citationId: '', ...citation }, page.text),
          },
          check: check ? { status: check.status, rationale: check.rationale } : null,
          decidedAt: row.decidedAt?.toISOString() ?? null,
        };
      });
      const trackRecord = evidence
        .filter((row) => row.evidenceType === PRIOR_DEAL)
        .map((row: PackEvidenceRow) => ({
          evidenceId: row.id,
          deal: row.canonical['deal'] ?? row.sourceRecordId,
          units: row.canonical['units'] ?? null,
          status: row.canonical['status'] ?? null,
          acquiredOn: row.canonical['acquired_on'] ?? null,
          exitedOn: row.canonical['exited_on'] ?? null,
          projectedIrrPct: row.canonical['projected_irr_pct'] ?? null,
          actualIrrPct: row.canonical['actual_irr_pct'] ?? null,
          projectedMultiple: row.canonical['projected_multiple'] ?? null,
          actualMultiple: row.canonical['actual_multiple'] ?? null,
        }))
        .sort((a, b) => a.deal.localeCompare(b.deal));
      return {
        guardrail: SYNDICATION_GUARDRAIL,
        scenarioLabel: SCENARIO_LABEL,
        currency: offering?.currency ?? deal.baseCurrency,
        canEdit: canWrite(role),
        offering: offering
          ? {
              currency: offering.currency,
              purchasePrice: plain(offering.purchasePrice),
              loanAmount: plain(offering.loanAmount),
              interestRatePct: plain(offering.interestRatePct),
              equityRaise: plain(offering.equityRaise),
              holdYears: offering.holdYears,
              sellingCostsPct: plain(offering.sellingCostsPct),
              noiYear1: plain(offering.noiYear1),
              downsideNoiGrowthPct: plain(offering.downsideNoiGrowthPct),
              baseNoiGrowthPct: plain(offering.baseNoiGrowthPct),
              upsideNoiGrowthPct: plain(offering.upsideNoiGrowthPct),
              downsideExitCapPct: plain(offering.downsideExitCapPct),
              baseExitCapPct: plain(offering.baseExitCapPct),
              upsideExitCapPct: plain(offering.upsideExitCapPct),
              exemption: offering.exemption,
              version: offering.version,
            }
          : null,
        documents: documents.map((document) => ({ id: document.id, fileName: document.fileName, category: document.intakeCategory, source: (document.intakeCategory && OFFERING_CATEGORY_SOURCE[document.intakeCategory]) ?? null })),
        items,
        trackRecord,
        waterfall: { scenarios: waterfall.views, missing: waterfall.missing, unmodelled: waterfall.unmodelled, noi: waterfall.noi, noiSource: waterfall.noiSource, unavailable: waterfall.why },
        checks: { pending: checks.proposals.map((proposal) => ({ key: proposal.key, title: proposal.title })) },
      };
    });
  }

  async saveOffering(tenant: TenantContext, dealId: string, body: OfferingBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'syndication.offering_saved', requestId });
    if (new D(body.loanAmount).gte(body.purchasePrice)) throw new UnprocessableEntityException({ code: 'LOAN_ABOVE_PRICE', message: 'The loan must be below the purchase price' });
    if ([body.downsideExitCapPct, body.baseExitCapPct, body.upsideExitCapPct].some((cap) => new D(cap).lte(0))) throw new UnprocessableEntityException({ code: 'CAP_RATE', message: 'Exit cap rates must be above zero' });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSyndication(tx, dealId);
      const data = { ...body, noiYear1: body.noiYear1, updatedBy: tenant.userId, updatedAt: new Date() };
      const existing = await tx.syndicationOffering.findFirst({ where: { dealId }, select: { id: true } });
      const row = existing
        ? await tx.syndicationOffering.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.syndicationOffering.create({ data: { id: newId(), organizationId: tenant.organizationId, dealId, ...data } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'syndication.offering_saved', targetType: 'syndication_offering', targetId: row.id, outcome: 'SUCCEEDED', requestId });
      return { id: row.id, version: row.version };
    });
  }

  /** AI reads one offering document; grounded items land PROPOSED. Re-reading adds only what is new. */
  async extract(tenant: TenantContext, dealId: string, body: ExtractBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'syndication.extraction.requested', requestId });
    await withTenant(this.prisma, tenant, (tx) => this.requireSyndication(tx, dealId));
    const outcome = await this.documents.extractOffering(tenant, dealId, body.documentId, requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      const existing = await this.items(tx, dealId);
      const seen = new Set(existing.map((row) => `${row.kind}|${(row.citation as unknown as DocumentCitation).quote}|${row.hurdle ?? ''}`));
      let proposed = 0;
      for (const item of outcome.items) {
        const key = `${item.kind}|${item.citation.quote}|${item.hurdle === null ? '' : new D(item.hurdle).toFixed(6)}`;
        const shapeOk = OFFERING_KIND_REGISTRY[item.kind].labelled === (item.label !== null) && (item.hurdle === null || OFFERING_KIND_REGISTRY[item.kind].tier);
        if (!shapeOk || seen.has(key)) continue;
        seen.add(key);
        const { citationId: _id, ...citation } = item.citation;
        await tx.syndicationOfferingItem.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId, documentId: body.documentId, source: body.source, kind: item.kind, label: item.label, value: item.value, hurdle: item.hurdle, citation, origin: 'AI', aiRunId: outcome.runId, createdBy: tenant.userId },
        });
        proposed += 1;
      }
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'syndication.items_proposed', targetType: 'document', targetId: body.documentId, outcome: 'SUCCEEDED', requestId });
      return { aiRunId: outcome.runId, proposed, duplicates: outcome.items.length - proposed, rejected: outcome.rejected };
    });
  }

  /** A term or claim entered by hand: cited, figures in the quote, confirmed by the person who entered it. */
  async addItem(tenant: TenantContext, dealId: string, body: ItemBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'syndication.item_added', requestId });
    this.requireShape(body.kind, body.label, body.value, body.hurdle);
    this.requireFigures(body.quote, [body.value, body.hurdle]);
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSyndication(tx, dealId);
      const citation = await this.verify(tx, dealId, body.documentId, body.pageNumber, body.quote);
      const id = newId();
      const now = new Date();
      await tx.syndicationOfferingItem.create({
        data: { id, organizationId: tenant.organizationId, dealId, documentId: body.documentId, source: body.source, kind: body.kind, label: body.label, value: body.value, hurdle: body.hurdle, citation: { ...citation }, origin: 'PERSON', status: 'CONFIRMED', decidedBy: tenant.userId, decidedAt: now, createdBy: tenant.userId },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'syndication.item_added', targetType: 'syndication_offering_item', targetId: id, outcome: 'SUCCEEDED', requestId });
      return { id, status: 'CONFIRMED' };
    });
  }

  /** The sponsor confirms (optionally correcting the reading) or rejects an item. */
  async decide(tenant: TenantContext, dealId: string, itemId: string, body: DecisionBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'syndication.item_decided', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSyndication(tx, dealId);
      const row = await tx.syndicationOfferingItem.findFirst({ where: { id: itemId, dealId } });
      if (!row) throw new NotFoundException();
      const quote = (row.citation as unknown as DocumentCitation).quote;
      const value = body.value !== undefined ? body.value : plain(row.value);
      const hurdle = body.hurdle !== undefined ? body.hurdle : plain(row.hurdle);
      const label = body.label !== undefined ? body.label : row.label;
      if (body.decision === 'CONFIRM') {
        this.requireShape(row.kind as OfferingItemKind, label, value, hurdle);
        this.requireFigures(quote, [value, hurdle]);
      }
      const status = body.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
      await tx.syndicationOfferingItem.update({
        where: { id: row.id },
        data: { status, value, hurdle, label, decisionNote: body.note ?? null, decidedBy: tenant.userId, decidedAt: new Date(), version: { increment: 1 }, updatedAt: new Date() },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: body.decision === 'CONFIRM' ? 'syndication.item_confirmed' : 'syndication.item_rejected', targetType: 'syndication_offering_item', targetId: row.id, outcome: 'SUCCEEDED', requestId });
      return { id: row.id, status };
    });
  }

  /**
   * Run the offering checks over the confirmed items: drafts go to the findings register
   * (idempotent by fingerprint) and every claim's outcome to the claims register (origin
   * PACK_RULE), linked to its finding when it has one. Deterministic; nothing is accepted.
   */
  async runChecks(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'syndication.checks_run', requestId });
    const { checks, evidence, pages } = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireSyndication(tx, dealId);
      const loaded = await this.inputs(tx, dealId);
      const documentIds = [...new Set(loaded.items.map((item) => item.documentId))];
      // bounded: the pages of the pact's offering documents (a PPM, an agreement, a deck)
      const pageRows = documentIds.length
        ? await tx.documentPage.findMany({
            where: { dealId, documentId: { in: documentIds }, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...CITABLE_CLASSES] } } },
            select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
            take: 2000,
          })
        : [];
      return { checks: loaded.checks, evidence: loaded.evidence, pages: pageRows };
    });
    const index = new SourceIndex(pages.map((page) => ({ citationId: `${page.documentId}:${page.pageNumber}`, documentId: page.documentId, documentName: page.document.fileName, pageNumber: page.pageNumber, text: page.text ?? '', classification: page.document.dataClass })));
    const rule: FindingRule = { id: OFFERING_CHECKS_ID, version: OFFERING_CHECKS_VERSION, evidenceTypes: [PRIOR_DEAL, UNIT], readsDocuments: true, detect: () => checks.proposals };
    const run = ruleProposals(
      rule,
      { evidence: evidence.filter((row) => row.evidenceType !== T12), pages: pages.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text ?? '' })) },
      (quote) => {
        const check = index.verify({ citationId: `${quote.documentId}:${quote.pageNumber}`, quote: quote.quote });
        if (!check.ok) return null;
        const { citationId: _id, ...citation } = check.citation;
        return citation;
      },
    );
    const recorded = await this.findings.recordProposals(tenant, dealId, run.proposals, { kind: 'SYSTEM', component: `${OFFERING_CHECKS_ID}@${OFFERING_CHECKS_VERSION}` }, requestId);
    const claims = await this.recordClaims(tenant, dealId, checks.claims, requestId);
    return { created: recorded.created.length, existing: recorded.existing, unresolvedQuotes: run.unresolved, claims };
  }

  private async recordClaims(tenant: TenantContext, dealId: string, outcomes: readonly OfferingClaimOutcome[], requestId: string) {
    let written = 0;
    for (const outcome of outcomes) {
      await withTenant(this.prisma, tenant, async (tx) => {
        const fingerprint = outcome.proposalKey ? `pack-rule:${OFFERING_CHECKS_ID}:${OFFERING_CHECKS_VERSION}:${outcome.proposalKey}` : null;
        const finding = fingerprint ? await tx.finding.findFirst({ where: { dealId, fingerprint }, select: { id: true } }) : null;
        const existing = await tx.dealClaim.findFirst({ where: { dealId, origin: 'PACK_RULE', statement: outcome.statement } });
        const findingIds = [...new Set([...(existing?.findingIds ?? []), ...(finding ? [finding.id] : [])])];
        if (existing && existing.status === outcome.status && existing.rationale === outcome.rationale && findingIds.length === existing.findingIds.length) return;
        const row = existing
          ? await tx.dealClaim.update({ where: { id: existing.id }, data: { status: outcome.status, rationale: outcome.rationale, evidenceItemIds: [...outcome.evidenceIds], findingIds, version: { increment: 1 }, updatedBy: tenant.userId, updatedAt: new Date() } })
          : await tx.dealClaim.create({
              data: { organizationId: tenant.organizationId, dealId, statement: outcome.statement, source: 'Offering documents', origin: 'PACK_RULE', status: outcome.status, rationale: outcome.rationale, evidenceItemIds: [...outcome.evidenceIds], findingIds, createdBy: tenant.userId, updatedBy: tenant.userId },
            });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: existing ? 'claim.updated' : 'claim.created', targetType: 'deal_claim', targetId: row.id, outcome: 'SUCCEEDED', requestId });
        written += 1;
      });
    }
    return { total: outcomes.length, written };
  }
}
