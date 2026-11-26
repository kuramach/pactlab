import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { citationStillValid, figuresIn, PROHIBITED_CLASSIFICATIONS, SourceIndex, type CitableSource } from '@pactlab/ai';
import {
  assumedDecline,
  computedCapacityFactor,
  D,
  decimalChecks,
  documentDecline,
  documentEstimates,
  ENERGY_ASSETS_VERSION,
  ENERGY_CONVENTIONS,
  ENERGY_EVIDENCE_TYPES,
  ENERGY_RULES,
  ENERGY_THRESHOLDS,
  energyHoldYears,
  energyRows,
  leaseExposure,
  liabilityModel,
  ppaCliffs,
  productionModel,
  recomputedNri,
  reserveReportOnFile,
  reservesByCategory,
  type PackRule,
  type PackRuleEvidence,
  type PackRuleQuote,
} from '@pactlab/calculations';
import type { Page } from '@pactlab/contracts';
import { afterCursor, appendAuditEvent, decodeCursor, encodeCursor, toPage, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  ENERGY_CATEGORIES,
  ENERGY_GUARDRAIL,
  ENERGY_ITEM_REGISTRY,
  ENERGY_LIABILITY_LABELS,
  ENERGY_NO_INVENTED_FIGURES,
  ENERGY_RESERVE_LABELS,
  newId,
  permissionsForDealRole,
  ruleProposals,
  type DealRole,
  type DocumentCitation,
  type EnergyItemKind,
  type EnergyLiabilityKind,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import type { AssetsQuery, DecisionBody, ExtractBody, ItemBody, ItemsQuery } from './energy.schemas';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
const CITABLE = new Set<string>(RULE_READABLE_CLASSES);
const ENERGY_DOCUMENT_CATEGORIES = new Set<string>(ENERGY_CATEGORIES);
/** Most confirmed entries one package's models read; above it the view refuses rather than read a partial set. */
const MAX_CONFIRMED = 5_000;
/** Pages the models read for estimates, the decline assumption, a stated hold and the document checks. */
const MAX_PAGES = 5_000;

type Decimal = InstanceType<typeof D>;
type ItemRow = Awaited<ReturnType<TransactionClient['energyRegisterItem']['findMany']>>[number];

const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal | null) => (value === null ? null : value.toFixed(4));
/** A decimal column as a plain string ("12", "42000000.5"), never a float. */
const plain = (value: { toFixed(digits: number): string }) => value.toFixed(6).replace(/\.?0+$/, '') || '0';
const canonical = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text).replace(/^0+(?=\d)/, '');

export interface EnergyItemView {
  id: string;
  kind: EnergyItemKind;
  kindLabel: string;
  asset: string | null;
  detail: string | null;
  value: string;
  status: string;
  origin: string;
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string; valid: boolean };
  decidedAt: string | null;
}

export interface EnergyAssetView {
  assetId: string;
  family: 'PLANT' | 'INTEREST';
  name: string;
  /** PLANT: fuel, capacity, age, capacity factor and PPA. */
  plant: { fuel: string; capacityMw: string; commissionedYear: number | null; reportedCapacityFactor: string | null; computedCapacityFactor: string | null; ppaCounterparty: string | null; ppaExpiresOn: string | null; contractedShare: string | null } | null;
  /** INTEREST: the lease, decimals and production. */
  interest: { type: string; legalDescription: string | null; leaseId: string; operator: string | null; share: string; divisionOrderNri: string | null; recomputedNri: string | null; decimalOff: boolean; heldByProduction: boolean | null; leaseExpiresOn: string | null; trailingBoe: string; decline: string | null } | null;
  trailingRevenue: string;
}

/**
 * Energy generation & rights (T-142, ADR 0043): the asset and interest register, the production and
 * decline model, reserves as the third-party report states them, the decimal and lease checks, the
 * PPA coverage and the liability model, over the imported registers and schedules, the entries a
 * person confirmed from documents (`energy.extract` proposes them with exact quotes) and
 * deterministic reads of the documents. Only imports, confirmed entries and cited sentences feed the
 * math. The checks run the pack's rules over the same inputs and draft into the one findings
 * register. The buyer's own side (RLS and BUYER_ANALYSIS_READ). Diligence support only.
 */
@Injectable()
export class EnergyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(FindingsService) private readonly findings: FindingsService,
  ) {}

  /** The pact must be an energy package: the section and every route exist only for this pack. */
  private async requireEnergy(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'ENERGY_GENERATION') throw new UnprocessableEntityException({ code: 'NOT_AN_ENERGY_PACT', message: 'This pact is not an energy generation & rights pact' });
    return deal;
  }

  /** Verify a quote on its stored page; never people data, never a purged document. */
  private async verify(tx: TransactionClient, dealId: string, documentId: string, pageNumber: number, quote: string): Promise<DocumentCitation> {
    const page = await tx.documentPage.findFirst({
      where: { dealId, documentId, pageNumber },
      select: { text: true, document: { select: { fileName: true, dataClass: true, status: true } } },
    });
    if (!page || page.text === null || page.document.status !== 'AVAILABLE') throw new UnprocessableEntityException({ code: 'PAGE_UNAVAILABLE', message: 'That document page is not available' });
    if (PROHIBITED.has(page.document.dataClass) || !CITABLE.has(page.document.dataClass)) throw new UnprocessableEntityException({ code: 'NOT_CITABLE', message: 'That document cannot be cited for the register' });
    const citable: CitableSource = { citationId: `${documentId}:${pageNumber}`, documentId, documentName: page.document.fileName, pageNumber, text: page.text, classification: page.document.dataClass };
    const check = new SourceIndex([citable]).verify({ citationId: citable.citationId, quote });
    if (!check.ok) throw new UnprocessableEntityException({ code: check.reason, message: `Citation refused: ${check.reason}` });
    const { citationId: _id, ...citation } = check.citation;
    return citation;
  }

  /** No invented figures: the figure must be written in the quote. */
  private requireFigure(quote: string, value: string) {
    if (!figuresIn(quote).has(canonical(value))) throw new UnprocessableEntityException({ code: 'FIGURE_NOT_IN_QUOTE', message: 'The figure must appear in the quoted text' });
  }

  private requireShape(kind: EnergyItemKind, detail: string | null, value: string) {
    const definition = ENERGY_ITEM_REGISTRY[kind];
    if (definition.detail && (!detail || !(definition.detail.codes as readonly string[]).includes(detail))) throw new UnprocessableEntityException({ code: 'DETAIL', message: `${definition.detail.label}: one of ${definition.detail.codes.join(', ')}` });
    if (!definition.detail && detail) throw new UnprocessableEntityException({ code: 'DETAIL', message: 'This entry carries no category' });
    if (definition.value === 'PERCENT' && new D(value).gt(100)) throw new UnprocessableEntityException({ code: 'VALUE', message: 'A decline is at most 100%' });
  }

  /** Everything the models read: the imported registers and schedules, confirmed entries and readable pages. */
  private async inputs(tx: TransactionClient, dealId: string, currency: string) {
    let imported: PackRuleEvidence[];
    try {
      imported = await loadPackEvidence(tx, dealId, ENERGY_EVIDENCE_TYPES);
    } catch (error) {
      if (error instanceof TooMuchPackEvidenceError) throw new PayloadTooLargeException('Too much evidence for one energy package');
      throw error;
    }
    const confirmed = await tx.energyRegisterItem.findMany({
      where: { dealId, status: 'CONFIRMED' },
      select: { id: true, kind: true, assetRef: true, detail: true, value: true, citation: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_CONFIRMED + 1,
    });
    if (confirmed.length > MAX_CONFIRMED) throw new PayloadTooLargeException('Too many confirmed entries for one energy package');
    const pageRows = await tx.documentPage.findMany({
      where: { dealId, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } } },
      select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
      orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
      take: MAX_PAGES,
    });
    const pages = pageRows.flatMap((page) => (page.text ? [{ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text, documentName: page.document.fileName, classification: page.document.dataClass }] : []));
    // A confirmed entry stands in for the figure it states, with its quote as the citation.
    const quoted = new Map<string, PackRuleQuote>();
    const entries: PackRuleEvidence[] = confirmed.map((item) => {
      const citation = item.citation as unknown as DocumentCitation;
      quoted.set(item.id, { documentId: citation.documentId, pageNumber: citation.pageNumber, quote: citation.quote });
      const kind = item.kind as EnergyItemKind;
      const value = plain(item.value);
      const canonicalRow: Record<string, string | null> =
        kind === 'LIABILITY_ESTIMATE' ? { kind: item.detail, asset_ref: item.assetRef, value, currency } : kind === 'DECLINE_ASSUMPTION' ? { value, asset_ref: item.assetRef } : { category: item.detail, value, asset_ref: item.assetRef };
      return { id: item.id, evidenceType: ENERGY_ITEM_REGISTRY[kind].evidenceType, sourceRecordId: item.id, canonical: canonicalRow };
    });
    // An entry stating what a document sentence already states (same obligation and amount, or the same decline) corroborates it.
    const rulePages = pages.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text }));
    const read = documentEstimates(rulePages);
    const decline = documentDecline(rulePages);
    const corroborated = confirmed.filter((item) =>
      item.kind === 'LIABILITY_ESTIMATE' ? read.some((estimate) => estimate.kind === item.detail && estimate.amount.eq(plain(item.value))) : item.kind === 'DECLINE_ASSUMPTION' ? decline?.percent.eq(plain(item.value)) === true : false,
    ).length;
    return { evidence: [...imported, ...entries], quoted, pages, rulePages, confirmed: confirmed.length, corroborated };
  }

  private analysis(evidence: readonly PackRuleEvidence[], pages: readonly { documentId: string; pageNumber: number; text: string }[], holdYears: number | undefined) {
    const rows = energyRows(evidence);
    const production = productionModel(rows);
    const stated = energyHoldYears(pages);
    const hold = holdYears ? { years: holdYears, source: 'CHOSEN' as const } : { years: stated.years, source: stated.stated ? ('STATED' as const) : ('DEFAULT' as const) };
    return {
      rows,
      production,
      hold,
      leases: leaseExposure(rows, production.analysisDate, hold.years),
      decimals: decimalChecks(rows, production),
      liabilities: liabilityModel(rows, pages),
      cliffs: ppaCliffs(rows, production, hold.years),
      reserves: reservesByCategory(rows),
      decline: assumedDecline(rows, pages),
      reportOnFile: reserveReportOnFile(rows, pages),
    };
  }

  private assetViews(analysis: ReturnType<EnergyService['analysis']>): EnergyAssetView[] {
    const { rows, production, decimals } = analysis;
    const leases = new Map(rows.leases.map((lease) => [lease.id, lease]));
    const off = new Set(decimals.map((check) => check.interestId));
    const plants = rows.plants.map((plant): EnergyAssetView => {
      const asset = production.byAsset.get(plant.id);
      return {
        assetId: plant.id,
        family: 'PLANT',
        name: plant.name,
        plant: {
          fuel: plant.fuel,
          capacityMw: plant.capacityMw.toFixed(1),
          commissionedYear: plant.commissionedYear,
          reportedCapacityFactor: ratio(plant.capacityFactor),
          computedCapacityFactor: ratio(computedCapacityFactor(plant, production)),
          ppaCounterparty: plant.ppaCounterparty,
          ppaExpiresOn: plant.ppaExpiresOn,
          contractedShare: asset && asset.trailingRevenue.gt(0) ? ratio(asset.contractedRevenue.div(asset.trailingRevenue)) : null,
        },
        interest: null,
        trailingRevenue: cash(asset?.trailingRevenue ?? new D(0)),
      };
    });
    const interests = rows.interests.map((interest): EnergyAssetView => {
      const lease = leases.get(interest.leaseId);
      const asset = production.byAsset.get(interest.id);
      const computed = recomputedNri(interest, lease);
      return {
        assetId: interest.id,
        family: 'INTEREST',
        name: interest.name,
        plant: null,
        interest: {
          type: interest.type,
          legalDescription: interest.legalDescription,
          leaseId: interest.leaseId,
          operator: interest.operator,
          share: plain(interest.share),
          divisionOrderNri: interest.divisionOrderNri ? interest.divisionOrderNri.toFixed(8) : null,
          recomputedNri: computed ? computed.toFixed(8) : null,
          decimalOff: off.has(interest.id),
          heldByProduction: lease ? lease.heldByProduction : null,
          leaseExpiresOn: lease?.expiresOn ?? null,
          trailingBoe: (asset?.trailingBoe ?? new D(0)).toFixed(0),
          decline: ratio(asset?.decline ?? null),
        },
        trailingRevenue: cash(asset?.trailingRevenue ?? new D(0)),
      };
    });
    return [...plants, ...interests];
  }

  async view(tenant: TenantContext, dealId: string, holdYears: number | undefined, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'energy.assets.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireEnergy(tx, dealId);
      const { evidence, rulePages, quoted, confirmed, corroborated } = await this.inputs(tx, dealId, deal.baseCurrency);
      const analysis = this.analysis(evidence, rulePages, holdYears);
      const { rows, production, hold, leases, decimals, liabilities, cliffs, reserves, decline } = analysis;
      const proposed = await tx.energyRegisterItem.count({ where: { dealId, status: 'PROPOSED' } });
      // The documents a person can have read for the register; energy documents first. A pact's documents are tens, capped here.
      const documents = await tx.document.findMany({
        where: { dealId, status: 'AVAILABLE', aiExcluded: false, dataClass: { in: [...RULE_READABLE_CLASSES] } },
        select: { id: true, fileName: true, category: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const energyFirst = (category: string | null) => (category && ENERGY_DOCUMENT_CATEGORIES.has(category) ? 0 : 1);
      documents.sort((a, b) => energyFirst(a.category) - energyFirst(b.category));
      const names = new Map(documents.map((document) => [document.id, document.fileName]));
      const source = (quote: PackRuleQuote) => ({ documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote });
      const capacityMw = rows.plants.reduce((total, plant) => total.plus(plant.capacityMw), new D(0));
      return {
        guardrail: ENERGY_GUARDRAIL,
        noInventedFigures: ENERGY_NO_INVENTED_FIGURES,
        version: ENERGY_ASSETS_VERSION,
        currency: deal.baseCurrency,
        canEdit: canWrite(role),
        register: { plants: rows.plants.length, interests: rows.interests.length, leases: rows.leases.length, productionLines: rows.production.length, scheduleLines: rows.liabilities.length, confirmedEntries: confirmed, corroboratedEntries: corroborated, proposedEntries: proposed },
        production: {
          analysisDate: production.analysisDate,
          interestTrailingBoe: production.interestTrailingBoe.toFixed(0),
          interestPriorBoe: production.interestPriorBoe.toFixed(0),
          interestDecline: ratio(production.interestDecline),
          interestTrailingRevenue: cash(production.interestTrailingRevenue),
          plantTrailingRevenue: cash(production.plantTrailingRevenue),
          plantContractedRevenue: cash(production.plantContractedRevenue),
          contractedShare: production.plantTrailingRevenue.gt(0) ? ratio(production.plantContractedRevenue.div(production.plantTrailingRevenue)) : null,
          capacityMw: capacityMw.toFixed(1),
          capacityKw: capacityMw.times(1000).toFixed(0),
          conventions: [...ENERGY_CONVENTIONS.production, ...ENERGY_CONVENTIONS.plants],
        },
        reserves: {
          reportOnFile: analysis.reportOnFile,
          categories: reserves.map((category) => ({ category: category.category, label: ENERGY_RESERVE_LABELS[category.category], volume: category.volume ? plain(category.volume) : null, value: category.value ? cash(category.value) : null })),
          assumedDecline: decline ? { percent: plain(decline.percent), source: decline.evidenceId ? (quoted.get(decline.evidenceId) ? source(quoted.get(decline.evidenceId) as PackRuleQuote) : null) : decline.quote ? source(decline.quote) : null } : null,
          actualDecline: ratio(production.interestDecline),
          mismatch: decline !== null && production.interestDecline !== null && production.interestDecline.gt(decline.percent.plus(ENERGY_THRESHOLDS.declinePoints).div(100)),
          thresholdPoints: ENERGY_THRESHOLDS.declinePoints,
        },
        decimals: {
          checked: rows.interests.length,
          errors: decimals.map((check) => ({ interestId: check.interestId, name: check.name, leaseId: check.leaseId, stated: check.stated.toFixed(8), computed: check.computed.toFixed(8), direction: check.direction, yearly: cash(check.yearly) })),
          conventions: ENERGY_CONVENTIONS.decimals,
        },
        leases: {
          analysisDate: leases.analysisDate,
          holdYears: hold.years,
          holdSource: hold.source,
          holdEnds: leases.holdEnds,
          totalAcres: plain(leases.totalAcres),
          exposedAcres: plain(leases.exposedAcres),
          share: ratio(leases.share),
          material: leases.share !== null && leases.share.gte(ENERGY_THRESHOLDS.leaseExposedShare),
          threshold: ENERGY_THRESHOLDS.leaseExposedShare,
          exposed: leases.leases.slice(0, 50).map((lease) => ({ leaseId: lease.id, netAcres: plain(lease.netAcres), expiresOn: lease.expiresOn })),
          exposedCount: leases.leases.length,
          lapsed: leases.lapsed,
          conventions: ENERGY_CONVENTIONS.leases,
        },
        ppa: cliffs.map((cliff) => ({ plantId: cliff.plantId, name: cliff.name, expiresOn: cliff.expiresOn, counterparty: cliff.counterparty, trailingRevenue: cash(cliff.trailingRevenue), contractedRevenue: cash(cliff.contractedRevenue), contractedShare: ratio(cliff.contractedShare) })),
        liabilities: {
          lines: liabilities.lines.map((line) => ({
            kind: line.kind,
            label: ENERGY_LIABILITY_LABELS[line.kind as EnergyLiabilityKind] ?? line.kind,
            assetId: line.assetId,
            assetName: line.assetName,
            estimate: cash(line.estimate),
            booked: cash(line.booked),
            gap: cash(line.gap),
            status: line.status,
            sources: [...line.quotes.map(source), ...line.estimateIds.flatMap((id) => (quoted.get(id) ? [source(quoted.get(id) as PackRuleQuote)] : []))],
          })),
          bookedTotal: cash(liabilities.bookedTotal),
          estimateTotal: cash(liabilities.estimateTotal),
          bookedOnly: liabilities.bookedOnly.map((line) => ({ kind: line.kind, assetId: line.assetId, description: line.description, booked: cash(line.booked) })),
          aroMargin: ENERGY_THRESHOLDS.aroMargin,
          conventions: ENERGY_CONVENTIONS.liabilities,
        },
        documents: documents.map((document) => ({ id: document.id, fileName: document.fileName, category: document.category, energy: energyFirst(document.category) === 0 })),
      };
    });
  }

  /** The plant and interest register, keyset-paged by family (interests, then plants), then id. */
  async assets(tenant: TenantContext, dealId: string, query: AssetsQuery, requestId: string): Promise<Page<EnergyAssetView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'energy.assets.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireEnergy(tx, dealId);
      const { evidence, rulePages } = await this.inputs(tx, dealId, deal.baseCurrency);
      const all = this.assetViews(this.analysis(evidence, rulePages, query.holdYears)).sort((a, b) => a.family.localeCompare(b.family) || a.assetId.localeCompare(b.assetId));
      const position = decodeCursor(query.cursor, { textId: true });
      const key = String(position?.key ?? '');
      const after = position ? all.filter((asset) => asset.family > key || (asset.family === key && asset.assetId > position.id)) : all;
      const items = after.slice(0, query.limit);
      const last = items.at(-1);
      return { items, nextCursor: after.length > query.limit && last ? encodeCursor(last.family, last.assetId) : null, total: all.length, limit: query.limit };
    });
  }

  /** Entries read from documents, newest first, keyset-paged; optionally one status. */
  async items(tenant: TenantContext, dealId: string, query: ItemsQuery, requestId: string): Promise<Page<EnergyItemView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'energy.assets.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireEnergy(tx, dealId);
      const where = { dealId, ...(query.status ? { status: query.status } : {}) };
      const [rows, total] = await Promise.all([
        tx.energyRegisterItem.findMany({ where: { ...where, ...afterCursor('createdAt', query.cursor, { asDate: true }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
        tx.energyRegisterItem.count({ where }),
      ]);
      const cited = rows.map((row) => row.citation as unknown as DocumentCitation);
      const pairs = [...new Map(cited.map((c) => [`${c.documentId}:${c.pageNumber}`, c])).values()];
      // bounded: the pages the entries on this page cite (at most one per entry)
      const pages = pairs.length
        ? await tx.documentPage.findMany({
            where: { dealId, OR: pairs.map((c) => ({ documentId: c.documentId, pageNumber: c.pageNumber })) },
            select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, status: true } } },
          })
        : [];
      return toPage(rows, query, total, (row) => row.createdAt, (row) => this.itemView(row, pages));
    });
  }

  private itemView(row: ItemRow, pages: readonly { documentId: string; pageNumber: number; text: string | null; document: { fileName: string; status: string } }[]): EnergyItemView {
    const citation = row.citation as unknown as DocumentCitation;
    const page = pages.find((candidate) => candidate.documentId === citation.documentId && candidate.pageNumber === citation.pageNumber);
    const kind = row.kind as EnergyItemKind;
    return {
      id: row.id,
      kind,
      kindLabel: ENERGY_ITEM_REGISTRY[kind].label,
      asset: row.assetRef,
      detail: row.detail,
      value: plain(row.value),
      status: row.status,
      origin: row.origin,
      citation: {
        documentId: citation.documentId,
        documentName: page?.document.fileName ?? null,
        pageNumber: citation.pageNumber,
        quote: citation.quote,
        valid: page?.text != null && page.document.status === 'AVAILABLE' && citationStillValid({ citationId: '', ...citation }, page.text),
      },
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  /** AI reads one report or permit; grounded entries land PROPOSED. Re-reading adds only what is new. */
  async extract(tenant: TenantContext, dealId: string, body: ExtractBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'energy.extraction.requested', requestId });
    await withTenant(this.prisma, tenant, (tx) => this.requireEnergy(tx, dealId));
    const outcome = await this.documents.extractEnergy(tenant, dealId, body.documentId, requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      // bounded: the entries already read from this one document (the extraction caps each read at 60)
      const existing = await tx.energyRegisterItem.findMany({ where: { dealId, documentId: body.documentId }, select: { kind: true, citation: true, assetRef: true, detail: true }, take: 5_000 });
      const keyOf = (kind: string, citation: Pick<DocumentCitation, 'pageNumber' | 'quote'>, asset: string | null, detail: string | null) => `${kind}|${citation.pageNumber}|${citation.quote}|${asset ?? ''}|${detail ?? ''}`;
      const seen = new Set(existing.map((row) => keyOf(row.kind, row.citation as unknown as DocumentCitation, row.assetRef, row.detail)));
      let proposed = 0;
      let refused = 0;
      for (const item of outcome.items) {
        const key = keyOf(item.kind, item.citation, item.asset, item.detail);
        if (seen.has(key)) continue;
        try {
          this.requireShape(item.kind, item.detail, item.value);
        } catch {
          refused += 1;
          continue;
        }
        seen.add(key);
        const { citationId: _id, ...citation } = item.citation;
        await tx.energyRegisterItem.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId, documentId: body.documentId, kind: item.kind, assetRef: item.asset, detail: item.detail, value: item.value, citation, origin: 'AI', aiRunId: outcome.runId, createdBy: tenant.userId },
        });
        proposed += 1;
      }
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'energy.entries_proposed', targetType: 'document', targetId: body.documentId, outcome: 'SUCCEEDED', requestId });
      return { aiRunId: outcome.runId, proposed, duplicates: outcome.items.length - proposed - refused, refused, rejected: outcome.rejected };
    });
  }

  /** An entry typed by hand: cited, its figure in the quote, confirmed by the person who entered it. */
  async addItem(tenant: TenantContext, dealId: string, body: ItemBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'energy.entry_added', requestId });
    this.requireShape(body.kind, body.detail, body.value);
    this.requireFigure(body.quote, body.value);
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireEnergy(tx, dealId);
      const citation = await this.verify(tx, dealId, body.documentId, body.pageNumber, body.quote);
      const id = newId();
      await tx.energyRegisterItem.create({
        data: { id, organizationId: tenant.organizationId, dealId, documentId: body.documentId, kind: body.kind, assetRef: body.asset, detail: body.detail, value: body.value, citation: { ...citation }, origin: 'PERSON', status: 'CONFIRMED', decidedBy: tenant.userId, decidedAt: new Date(), createdBy: tenant.userId },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'energy.entry_added', targetType: 'energy_register_item', targetId: id, outcome: 'SUCCEEDED', requestId });
      return { id, status: 'CONFIRMED' };
    });
  }

  /** A person confirms (optionally correcting the reading) or rejects an entry. */
  async decide(tenant: TenantContext, dealId: string, itemId: string, body: DecisionBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'energy.entry_decided', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireEnergy(tx, dealId);
      const row = await tx.energyRegisterItem.findFirst({ where: { id: itemId, dealId } });
      if (!row) throw new NotFoundException();
      const quote = (row.citation as unknown as DocumentCitation).quote;
      const asset = body.asset !== undefined ? body.asset : row.assetRef;
      const detail = body.detail !== undefined ? body.detail : row.detail;
      const value = body.value !== undefined ? body.value : plain(row.value);
      if (body.decision === 'CONFIRM') {
        this.requireShape(row.kind as EnergyItemKind, detail, value);
        this.requireFigure(quote, value);
      }
      const status = body.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
      await tx.energyRegisterItem.update({
        where: { id: row.id },
        data: { status, assetRef: asset, detail, value, decisionNote: body.note ?? null, decidedBy: tenant.userId, decidedAt: new Date(), version: { increment: 1 }, updatedAt: new Date() },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: body.decision === 'CONFIRM' ? 'energy.entry_confirmed' : 'energy.entry_rejected', targetType: 'energy_register_item', targetId: row.id, outcome: 'SUCCEEDED', requestId });
      return { id: row.id, status };
    });
  }

  /**
   * The energy checks: the pack's rules over the imported registers, the confirmed entries and the
   * readable pages. A confirmed entry is cited by its quote, never as evidence it is not. Drafts go
   * to the findings register with the same fingerprints the pack-rule run uses, so running either
   * never duplicates a finding. Deterministic; nothing is accepted.
   */
  async runChecks(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'energy.checks_run', requestId });
    const { evidence, quoted, pages, rulePages } = await withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireEnergy(tx, dealId);
      return this.inputs(tx, dealId, deal.baseCurrency);
    });
    const index = new SourceIndex(pages.map((page) => ({ citationId: `${page.documentId}:${page.pageNumber}`, documentId: page.documentId, documentName: page.documentName, pageNumber: page.pageNumber, text: page.text, classification: page.classification })));
    const resolve = (quote: PackRuleQuote) => {
      const check = index.verify({ citationId: `${quote.documentId}:${quote.pageNumber}`, quote: quote.quote });
      if (!check.ok) return null;
      const { citationId: _id, ...citation } = check.citation;
      return citation;
    };
    // Entry ids leave the evidence list for their quotes; the rule's id and version (and so the fingerprint) are its own.
    const cited = (rule: PackRule): PackRule => ({
      ...rule,
      readsDocuments: true,
      detect: (context) =>
        rule.detect({ evidence: context.evidence, pages: rule.readsDocuments ? context.pages : [] }).map((proposal) => {
          const entries = proposal.evidenceIds.filter((id) => quoted.has(id));
          if (entries.length === 0) return proposal;
          const quotes = [...(proposal.quotes ?? []), ...entries.flatMap((id) => (quoted.get(id) ? [quoted.get(id) as PackRuleQuote] : []))];
          return { ...proposal, evidenceIds: proposal.evidenceIds.filter((id) => !quoted.has(id)), quotes: [...new Map(quotes.map((quote) => [`${quote.documentId}:${quote.pageNumber}:${quote.quote}`, quote])).values()] };
        }),
    });
    const runs = ENERGY_RULES.map((rule) => ruleProposals(cited(rule), { evidence, pages: rulePages }, resolve));
    const recorded = await this.findings.recordProposals(tenant, dealId, runs.flatMap((run) => run.proposals), { kind: 'SYSTEM', component: 'pack-rules' }, requestId);
    return { rules: ENERGY_RULES.map((rule) => ({ id: rule.id, version: rule.version })), evidenceRead: evidence.length, created: recorded.created.length, existing: recorded.existing, unresolvedQuotes: runs.reduce((total, run) => total + run.unresolved, 0) };
  }
}
