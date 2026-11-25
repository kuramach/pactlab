import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { citationStillValid, figuresIn, PROHIBITED_CLASSIFICATIONS, SourceIndex, type CitableSource } from '@pactlab/ai';
import {
  catalogRows,
  D,
  incomeModel,
  MUSIC_CATALOG_VERSION,
  MUSIC_EVIDENCE_TYPES,
  MUSIC_INCOME_CONVENTIONS,
  MUSIC_RULES,
  MUSIC_THRESHOLDS,
  statedHoldYears,
  statementGaps,
  terminationExposure,
  terminationWindow,
  type PackRule,
  type PackRuleEvidence,
  type PackRuleQuote,
} from '@pactlab/calculations';
import type { Page } from '@pactlab/contracts';
import { afterCursor, appendAuditEvent, decodeCursor, encodeCursor, toPage, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  MUSIC_CATEGORIES,
  MUSIC_GUARDRAIL,
  MUSIC_INCOME_SOURCE_LABELS,
  MUSIC_ITEM_REGISTRY,
  MUSIC_NO_INVENTED_INCOME,
  MUSIC_TITLE_EVIDENCE,
  newId,
  permissionsForDealRole,
  ruleProposals,
  type DealRole,
  type DocumentCitation,
  type MusicIncomeSource,
  type MusicItemKind,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { DocumentsService } from '../documents/documents.service';
import { FindingsService } from '../findings/findings.service';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import type { DecisionBody, ExtractBody, ItemBody, ItemsQuery, WorksQuery } from './music.schemas';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const PROHIBITED = new Set<string>(PROHIBITED_CLASSIFICATIONS);
const CITABLE = new Set<string>(RULE_READABLE_CLASSES);
const MUSIC_DOCUMENT_CATEGORIES = new Set<string>(MUSIC_CATEGORIES);
/** Most confirmed entries one catalog's math reads; above it the view refuses rather than read a partial set. */
const MAX_CONFIRMED = 20_000;
/** Pages the catalog reads for a stated hold period and the document checks. */
const MAX_PAGES = 5_000;

type Decimal = InstanceType<typeof D>;
type ItemRow = Awaited<ReturnType<TransactionClient['musicRegisterItem']['findMany']>>[number];

const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal | null) => (value === null ? null : value.toFixed(4));
/** A decimal column as a plain string ("55", "412500.5"), never a float. */
const plain = (value: { toFixed(digits: number): string } | null) => (value === null ? null : value.toFixed(6).replace(/\.?0+$/, '') || '0');
const canonical = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text).replace(/^0+(?=\d)/, '');
const isoDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

export interface MusicItemView {
  id: string;
  kind: MusicItemKind;
  kindLabel: string;
  work: string | null;
  detail: string | null;
  value: string | null;
  date: string | null;
  status: string;
  origin: string;
  citation: { documentId: string; documentName: string | null; pageNumber: number; quote: string; valid: boolean };
  decidedAt: string | null;
}

export interface CatalogWorkView {
  workId: string;
  title: string;
  type: string;
  pro: string | null;
  releaseYear: number | null;
  usWork: boolean;
  trailing: string;
  prior: string;
  share: string | null;
  bySource: { source: string; amount: string }[];
  /** Registration and assignment (or work-for-hire) evidence on the chain of title. */
  title_evidence: { registration: boolean; assignment: boolean };
  splitSheetTotal: string | null;
  termination: { statute: string; opens: string; closes: string; insideHold: boolean } | null;
}

/**
 * Music rights (T-140, ADR 0041): the works and rights register, the royalty income model and the
 * termination-exposure analysis, over the imported register and statements plus the entries a
 * person confirmed from rights documents (`music.extract` proposes them with exact quotes). Only
 * imported rows and CONFIRMED entries feed the math. The catalog checks run the pack's rules over
 * the same inputs and draft into the one findings register. Everything here is the buyer's own
 * side (RLS and BUYER_ANALYSIS_READ). Diligence support only — no legal advice, no determination
 * that title is good or that a termination notice is valid.
 */
@Injectable()
export class MusicService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(FindingsService) private readonly findings: FindingsService,
  ) {}

  /** The pact must be a music catalog: the section and every route exist only for this pack. */
  private async requireMusic(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'MUSIC_RIGHTS') throw new UnprocessableEntityException({ code: 'NOT_A_MUSIC_CATALOG', message: 'This pact is not a music rights catalog' });
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

  /** No invented income: the figure, and the year of the date, must be written in the quote. */
  private requireFigures(quote: string, value: string | null, date: string | null) {
    const written = figuresIn(quote);
    const figures = [value, date ? date.slice(0, 4) : null].filter((figure): figure is string => figure !== null);
    if (figures.some((figure) => !written.has(canonical(figure)))) throw new UnprocessableEntityException({ code: 'FIGURE_NOT_IN_QUOTE', message: 'Every figure and date must appear in the quoted text' });
  }

  private requireShape(kind: MusicItemKind, work: string | null, detail: string | null, value: string | null, date: string | null) {
    const definition = MUSIC_ITEM_REGISTRY[kind];
    if (definition.work !== (work !== null)) throw new UnprocessableEntityException({ code: 'WORK', message: definition.work ? 'Name the work the entry belongs to' : 'This entry is catalog-wide: leave the work empty' });
    if (definition.detail && !detail && kind !== 'ENCUMBRANCE') throw new UnprocessableEntityException({ code: 'DETAIL', message: `Give the ${definition.detail.toLowerCase()}` });
    if (kind === 'GRANT' && detail && !['registration', 'assignment', 'license', 'administration', 'work_for_hire'].includes(detail)) throw new UnprocessableEntityException({ code: 'GRANT_TYPE', message: 'Grant type: registration, assignment, license, administration or work_for_hire' });
    if (kind === 'INCOME' && detail && !Object.keys(MUSIC_INCOME_SOURCE_LABELS).includes(detail)) throw new UnprocessableEntityException({ code: 'INCOME_SOURCE', message: 'Income source: performance, mechanical, sync, neighbouring or streaming' });
    if (definition.value !== 'NONE' && value === null && kind !== 'ENCUMBRANCE') throw new UnprocessableEntityException({ code: 'VALUE', message: 'Give the figure the document states' });
    if (definition.value === 'NONE' && value !== null) throw new UnprocessableEntityException({ code: 'VALUE', message: 'This entry carries no figure' });
    if (definition.date && !date && kind === 'INCOME') throw new UnprocessableEntityException({ code: 'DATE', message: 'Give the statement period end' });
    if (!definition.date && date) throw new UnprocessableEntityException({ code: 'DATE', message: 'This entry carries no date' });
    if (kind === 'SPLIT' && value !== null && new D(value).gt(100)) throw new UnprocessableEntityException({ code: 'VALUE', message: 'A share is at most 100%' });
  }

  /** Everything the catalog math reads: the imported register and statements, confirmed entries and readable pages. */
  private async inputs(tx: TransactionClient, dealId: string) {
    let imported: PackRuleEvidence[];
    try {
      imported = await loadPackEvidence(tx, dealId, MUSIC_EVIDENCE_TYPES);
    } catch (error) {
      if (error instanceof TooMuchPackEvidenceError) throw new PayloadTooLargeException('Too much evidence for one catalog');
      throw error;
    }
    const confirmed = await tx.musicRegisterItem.findMany({
      where: { dealId, status: 'CONFIRMED' },
      select: { id: true, documentId: true, kind: true, workRef: true, detail: true, value: true, date: true, citation: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_CONFIRMED + 1,
    });
    if (confirmed.length > MAX_CONFIRMED) throw new PayloadTooLargeException('Too many confirmed register entries for one catalog');
    const documentIds = [...new Set(confirmed.map((item) => item.documentId))];
    // bounded: the documents the confirmed entries were read from (a pact's documents are tens)
    const sourceDocuments = documentIds.length ? await tx.document.findMany({ where: { dealId, id: { in: documentIds } }, select: { id: true, fileName: true, category: true } }) : [];
    const documentOf = new Map(sourceDocuments.map((document) => [document.id, document]));
    const pageRows = await tx.documentPage.findMany({
      where: { dealId, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } } },
      select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true, dataClass: true } } },
      orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
      take: MAX_PAGES,
    });
    const works = imported.filter((row) => row.evidenceType === 'music.work');
    const resolveWork = (ref: string) => {
      const exact = works.find((row) => row.canonical['work_id'] === ref);
      const titled = works.find((row) => (row.canonical['title'] ?? '').toLowerCase() === ref.toLowerCase());
      return (exact ?? titled)?.canonical['work_id'] ?? ref;
    };
    // A confirmed entry stands in for the register row it describes, with its quote as the citation.
    // One the import already holds (same work, writer and source; grant type and date; period and
    // income source) corroborates it and is not counted twice.
    const importedKey = (row: PackRuleEvidence) => {
      const c = row.canonical;
      if (row.evidenceType === 'music.split') return `split|${c['work_id']}|${c['writer_ref']}|${c['source']}`;
      if (row.evidenceType === 'music.grant') return `grant|${c['work_id']}|${c['grant_type']}|${(c['executed_on'] ?? '').slice(0, 10)}`;
      if (row.evidenceType === 'music.royalty_line') return `income|${c['work_id']}|${(c['period_end'] ?? '').slice(0, 10)}|${c['income_source']}`;
      return null;
    };
    const held = new Set(imported.map(importedKey).filter((key): key is string => key !== null));
    let corroborated = 0;
    const quoted = new Map<string, PackRuleQuote>();
    const entries: PackRuleEvidence[] = confirmed.flatMap((item): PackRuleEvidence[] => {
      const citation = item.citation as unknown as DocumentCitation;
      const work = item.workRef ? resolveWork(item.workRef) : '';
      const value = plain(item.value);
      const date = isoDay(item.date);
      const document = documentOf.get(item.documentId);
      let row: PackRuleEvidence | null = null;
      if (item.kind === 'SPLIT') row = { id: item.id, evidenceType: 'music.split', sourceRecordId: item.id, canonical: { split_id: item.id, work_id: work, writer_ref: item.detail, share_pct: value, source: document?.category === 'ROYALTY_STATEMENT' ? 'statement' : 'split_sheet' } };
      if (item.kind === 'GRANT') row = { id: item.id, evidenceType: 'music.grant', sourceRecordId: item.id, canonical: { grant_id: item.id, work_id: work, grant_type: item.detail, executed_on: date } };
      if (item.kind === 'INCOME') row = { id: item.id, evidenceType: 'music.royalty_line', sourceRecordId: item.id, canonical: { line_id: item.id, period_end: date, work_id: work, income_source: item.detail, payer: document?.fileName ?? 'Confirmed statement', amount: value } };
      if (!row) return [];
      const key = importedKey(row);
      if (key && held.has(key)) {
        corroborated += 1;
        return [];
      }
      if (key) held.add(key);
      quoted.set(item.id, { documentId: citation.documentId, pageNumber: citation.pageNumber, quote: citation.quote });
      return [row];
    });
    const pages = pageRows.flatMap((page) => (page.text ? [{ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text, documentName: page.document.fileName, classification: page.document.dataClass }] : []));
    return { evidence: [...imported, ...entries], quoted, pages, confirmed: confirmed.length, corroborated };
  }

  private analysis(evidence: readonly PackRuleEvidence[], pages: readonly { text: string }[], holdYears: number | undefined) {
    const rows = catalogRows(evidence);
    const income = incomeModel(rows);
    const stated = statedHoldYears(pages);
    const hold = holdYears ? { years: holdYears, source: 'CHOSEN' as const } : { years: stated.years, source: stated.stated ? ('STATED' as const) : ('DEFAULT' as const) };
    const exposure = terminationExposure(rows, income, hold.years);
    return { rows, income, hold, exposure };
  }

  private workViews(analysis: ReturnType<MusicService['analysis']>): CatalogWorkView[] {
    const { rows, income, exposure } = analysis;
    const exposedWorks = new Set(exposure.grants.map((grant) => grant.workId));
    const registered = new Map(rows.works.map((work) => [work.id, work]));
    const ids = [...new Set([...rows.works.map((work) => work.id), ...income.byWork.keys()])];
    return ids.map((workId) => {
      const work = registered.get(workId);
      const earned = income.byWork.get(workId);
      const grants = rows.grants.filter((grant) => grant.workId === workId);
      const sheet = rows.splits.filter((split) => split.workId === workId && split.source === 'split_sheet');
      const windows = work?.usWork ? grants.map((grant) => terminationWindow(grant, true)).filter((window) => window !== null).sort((a, b) => a.opens.localeCompare(b.opens)) : [];
      const [window] = windows;
      return {
        workId,
        title: work?.title ?? workId,
        type: work?.type ?? 'unregistered',
        pro: work?.pro || null,
        releaseYear: work?.releaseYear ?? null,
        usWork: work?.usWork ?? false,
        trailing: cash(earned?.trailing ?? new D(0)),
        prior: cash(earned?.prior ?? new D(0)),
        share: income.trailing.gt(0) ? ratio((earned?.trailing ?? new D(0)).div(income.trailing)) : null,
        bySource: [...(earned?.bySource.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0])).map(([source, amount]) => ({ source, amount: cash(amount) })),
        title_evidence: { registration: grants.some((grant) => grant.type === 'registration'), assignment: grants.some((grant) => MUSIC_TITLE_EVIDENCE.includes(grant.type as never) && grant.type !== 'registration') },
        splitSheetTotal: sheet.length ? plain(sheet.reduce((sum, split) => sum.plus(split.share), new D(0))) : null,
        termination: window ? { statute: window.statute, opens: window.opens, closes: window.closes, insideHold: exposedWorks.has(workId) } : null,
      };
    });
  }

  async view(tenant: TenantContext, dealId: string, holdYears: number | undefined, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'music.catalog.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireMusic(tx, dealId);
      const { evidence, pages, confirmed, corroborated } = await this.inputs(tx, dealId);
      const analysis = this.analysis(evidence, pages, holdYears);
      const { income, exposure, hold, rows } = analysis;
      const works = this.workViews(analysis);
      const proposed = await tx.musicRegisterItem.count({ where: { dealId, status: 'PROPOSED' } });
      // The documents a person can have read for the register; rights documents first. A pact's documents are tens, capped here.
      const documents = await tx.document.findMany({
        where: { dealId, status: 'AVAILABLE', aiExcluded: false, dataClass: { in: [...RULE_READABLE_CLASSES] } },
        select: { id: true, fileName: true, category: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const rightsFirst = (category: string | null) => (category && MUSIC_DOCUMENT_CATEGORIES.has(category) ? 0 : 1);
      documents.sort((a, b) => rightsFirst(a.category) - rightsFirst(b.category));
      const top = [...works].sort((a, b) => new D(b.trailing).comparedTo(a.trailing) || a.workId.localeCompare(b.workId)).slice(0, 10);
      return {
        guardrail: MUSIC_GUARDRAIL,
        noInventedIncome: MUSIC_NO_INVENTED_INCOME,
        version: MUSIC_CATALOG_VERSION,
        currency: deal.baseCurrency,
        canEdit: canWrite(role),
        register: {
          works: rows.works.length,
          splits: rows.splits.length,
          grants: rows.grants.length,
          statementLines: rows.lines.length,
          confirmedEntries: confirmed,
          corroboratedEntries: corroborated,
          proposedEntries: proposed,
          withoutTitleEvidence: works.filter((work) => new D(work.trailing).gt(0) && !(work.title_evidence.registration && work.title_evidence.assignment)).length,
        },
        income: {
          latestPeriodEnd: income.latestPeriodEnd,
          periods: income.periods,
          trailing: cash(income.trailing),
          prior: cash(income.prior),
          change: income.prior.gt(0) ? ratio(income.trailing.div(income.prior).minus(1)) : null,
          decayAdjusted: cash(income.decayAdjusted),
          bySource: [...income.bySource.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([source, amount]) => ({ source, label: MUSIC_INCOME_SOURCE_LABELS[source as MusicIncomeSource] ?? source, amount: cash(amount) })),
          bands: income.bands.map((band) => ({ key: band.key, label: band.label, works: band.works, trailing: cash(band.trailing), prior: cash(band.prior), change: ratio(band.change), decayAdjusted: cash(band.decayAdjusted) })),
          conventions: MUSIC_INCOME_CONVENTIONS,
          gaps: statementGaps(rows).map((gap) => ({ payer: gap.payer, missing: gap.missing })),
        },
        topWorks: top,
        termination: {
          analysisDate: exposure.analysisDate,
          holdYears: hold.years,
          holdSource: hold.source,
          holdEnds: exposure.holdEnds,
          exposedIncome: cash(exposure.exposedIncome),
          share: ratio(exposure.share),
          material: exposure.share !== null && exposure.share.gte(MUSIC_THRESHOLDS.terminationShare),
          threshold: MUSIC_THRESHOLDS.terminationShare,
          grants: exposure.grants.slice(0, 25).map((grant) => ({ workId: grant.workId, title: grant.title, statute: grant.window.statute, opens: grant.window.opens, closes: grant.window.closes, share: ratio(grant.share), exposedIncome: cash(grant.exposedIncome) })),
          grantCount: exposure.grants.length,
          undated: exposure.undated,
          conventions: exposure.conventions,
        },
        documents: documents.map((document) => ({ id: document.id, fileName: document.fileName, category: document.category, rights: rightsFirst(document.category) === 0 })),
      };
    });
  }

  /** The works register with income and title status, keyset-paged by trailing income (largest first), then work id. */
  async works(tenant: TenantContext, dealId: string, query: WorksQuery, requestId: string): Promise<Page<CatalogWorkView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'music.catalog.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMusic(tx, dealId);
      const { evidence, pages } = await this.inputs(tx, dealId);
      const all = this.workViews(this.analysis(evidence, pages, query.holdYears)).sort((a, b) => new D(b.trailing).comparedTo(a.trailing) || a.workId.localeCompare(b.workId));
      const position = decodeCursor(query.cursor, { textId: true });
      const after = position ? all.filter((work) => new D(work.trailing).lt(String(position.key ?? '0')) || (new D(work.trailing).eq(String(position.key ?? '0')) && work.workId > position.id)) : all;
      const items = after.slice(0, query.limit);
      const last = items.at(-1);
      return { items, nextCursor: after.length > query.limit && last ? encodeCursor(last.trailing, last.workId) : null, total: all.length, limit: query.limit };
    });
  }

  /** Register entries read from documents, newest first, keyset-paged; optionally one status. */
  async items(tenant: TenantContext, dealId: string, query: ItemsQuery, requestId: string): Promise<Page<MusicItemView>> {
    await this.access.require(tenant, dealId, canRead, { action: 'music.catalog.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMusic(tx, dealId);
      const where = { dealId, ...(query.status ? { status: query.status } : {}) };
      const [rows, total] = await Promise.all([
        tx.musicRegisterItem.findMany({ where: { ...where, ...afterCursor('createdAt', query.cursor, { asDate: true }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
        tx.musicRegisterItem.count({ where }),
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

  private itemView(row: ItemRow, pages: readonly { documentId: string; pageNumber: number; text: string | null; document: { fileName: string; status: string } }[]): MusicItemView {
    const citation = row.citation as unknown as DocumentCitation;
    const page = pages.find((candidate) => candidate.documentId === citation.documentId && candidate.pageNumber === citation.pageNumber);
    const kind = row.kind as MusicItemKind;
    return {
      id: row.id,
      kind,
      kindLabel: MUSIC_ITEM_REGISTRY[kind].label,
      work: row.workRef,
      detail: row.detail,
      value: plain(row.value),
      date: isoDay(row.date),
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

  /** AI reads one rights document; grounded entries land PROPOSED. Re-reading adds only what is new. */
  async extract(tenant: TenantContext, dealId: string, body: ExtractBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'music.extraction.requested', requestId });
    await withTenant(this.prisma, tenant, (tx) => this.requireMusic(tx, dealId));
    const outcome = await this.documents.extractMusic(tenant, dealId, body.documentId, requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      // bounded: the entries already read from this one document (the extraction caps each read at 80)
      const existing = await tx.musicRegisterItem.findMany({ where: { dealId, documentId: body.documentId }, select: { kind: true, citation: true, workRef: true, detail: true }, take: 5_000 });
      const keyOf = (kind: string, citation: Pick<DocumentCitation, 'pageNumber' | 'quote'>, work: string | null, detail: string | null) => `${kind}|${citation.pageNumber}|${citation.quote}|${work ?? ''}|${detail ?? ''}`;
      const seen = new Set(existing.map((row) => keyOf(row.kind, row.citation as unknown as DocumentCitation, row.workRef, row.detail)));
      let proposed = 0;
      let refused = 0;
      for (const item of outcome.items) {
        const key = keyOf(item.kind, item.citation, item.work, item.detail);
        if (seen.has(key)) continue;
        try {
          this.requireShape(item.kind, item.work, item.detail, item.value, item.date);
        } catch {
          refused += 1;
          continue;
        }
        seen.add(key);
        const { citationId: _id, ...citation } = item.citation;
        await tx.musicRegisterItem.create({
          data: { id: newId(), organizationId: tenant.organizationId, dealId, documentId: body.documentId, kind: item.kind, workRef: item.work, detail: item.detail, value: item.value, date: item.date ? new Date(`${item.date}T00:00:00Z`) : null, citation, origin: 'AI', aiRunId: outcome.runId, createdBy: tenant.userId },
        });
        proposed += 1;
      }
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'music.entries_proposed', targetType: 'document', targetId: body.documentId, outcome: 'SUCCEEDED', requestId });
      return { aiRunId: outcome.runId, proposed, duplicates: outcome.items.length - proposed - refused, refused, rejected: outcome.rejected };
    });
  }

  /** An entry typed by hand: cited, figure and date in the quote, confirmed by the person who entered it. */
  async addItem(tenant: TenantContext, dealId: string, body: ItemBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'music.entry_added', requestId });
    this.requireShape(body.kind, body.work, body.detail, body.value, body.date);
    this.requireFigures(body.quote, body.value, body.date);
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMusic(tx, dealId);
      const citation = await this.verify(tx, dealId, body.documentId, body.pageNumber, body.quote);
      const id = newId();
      await tx.musicRegisterItem.create({
        data: { id, organizationId: tenant.organizationId, dealId, documentId: body.documentId, kind: body.kind, workRef: body.work, detail: body.detail, value: body.value, date: body.date ? new Date(`${body.date}T00:00:00Z`) : null, citation: { ...citation }, origin: 'PERSON', status: 'CONFIRMED', decidedBy: tenant.userId, decidedAt: new Date(), createdBy: tenant.userId },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'music.entry_added', targetType: 'music_register_item', targetId: id, outcome: 'SUCCEEDED', requestId });
      return { id, status: 'CONFIRMED' };
    });
  }

  /** A person confirms (optionally correcting the reading) or rejects an entry. */
  async decide(tenant: TenantContext, dealId: string, itemId: string, body: DecisionBody, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'music.entry_decided', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMusic(tx, dealId);
      const row = await tx.musicRegisterItem.findFirst({ where: { id: itemId, dealId } });
      if (!row) throw new NotFoundException();
      const quote = (row.citation as unknown as DocumentCitation).quote;
      const work = body.work !== undefined ? body.work : row.workRef;
      const detail = body.detail !== undefined ? body.detail : row.detail;
      const value = body.value !== undefined ? body.value : plain(row.value);
      const date = body.date !== undefined ? body.date : isoDay(row.date);
      if (body.decision === 'CONFIRM') {
        this.requireShape(row.kind as MusicItemKind, work, detail, value, date);
        this.requireFigures(quote, value, date);
      }
      const status = body.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
      await tx.musicRegisterItem.update({
        where: { id: row.id },
        data: { status, workRef: work, detail, value, date: date ? new Date(`${date}T00:00:00Z`) : null, decisionNote: body.note ?? null, decidedBy: tenant.userId, decidedAt: new Date(), version: { increment: 1 }, updatedAt: new Date() },
      });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: body.decision === 'CONFIRM' ? 'music.entry_confirmed' : 'music.entry_rejected', targetType: 'music_register_item', targetId: row.id, outcome: 'SUCCEEDED', requestId });
      return { id: row.id, status };
    });
  }

  /**
   * The catalog checks: the pack's rules over the imported register, the confirmed entries and the
   * readable pages. A confirmed entry is cited by its quote, never as evidence it is not. Drafts go
   * to the findings register with the same fingerprints the pack-rule run uses, so running either
   * never duplicates a finding. Deterministic; nothing is accepted.
   */
  async runChecks(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'music.checks_run', requestId });
    const { evidence, quoted, pages } = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMusic(tx, dealId);
      return this.inputs(tx, dealId);
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
    const rulePages = pages.map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text }));
    const runs = MUSIC_RULES.map((rule) => ruleProposals(cited(rule), { evidence, pages: rulePages }, resolve));
    const recorded = await this.findings.recordProposals(tenant, dealId, runs.flatMap((run) => run.proposals), { kind: 'SYSTEM', component: 'pack-rules' }, requestId);
    return { rules: MUSIC_RULES.map((rule) => ({ id: rule.id, version: rule.version })), evidenceRead: evidence.length, created: recorded.created.length, existing: recorded.existing, unresolvedQuotes: runs.reduce((total, run) => total + run.unresolved, 0) };
  }
}
