import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  holdWindow,
  INVOICE_LINE,
  KEY_SCIENTIST_SHARE,
  keyScientists,
  manufacturingDependence,
  OBLIGATION,
  obligationChecks,
  patentEstate,
  PATENT,
  PHARMA_KEY_EXPENSES,
  PHARMA_PIPELINE_VERSION,
  pipelineClaims,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  productCliffs,
  PROGRAMME,
  programmes,
  RD_FLAT_TOLERANCE,
  rdBurn,
  REGISTRY_TRIAL,
  registryTrials,
  SCIENTIST,
  timelineAccelerations,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  PHARMA_CLAIM_ASPECT_LABELS,
  PHARMA_GUARDRAIL,
  PHARMA_NO_INVENTED_FIGURES,
  PHARMA_OBLIGATION_KIND_LABELS,
  PHARMA_OBLIGATION_STATE_LABELS,
  PNL_LINE_EVIDENCE_TYPE,
  permissionsForDealRole,
  type DealRole,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for correspondence, patent records, agreements, the closing date and the hold. */
const MAX_PAGES = 5_000;
/** Rows of a list the view shows; the rest are counted. */
const SHOWN = 50;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const rate = (value: Decimal | null | undefined) => (value ? value.toFixed(6) : null);

/**
 * Pharma and biotech (T-163, ADR 0053): the Pipeline page. Each programme's phase, timeline and status claim
 * against the trial-registry records and the regulatory correspondence supplied; the patent estate (a patent
 * record's expiry governing the schedule's) and each product's cliff against the hold after closing; the
 * milestones, royalties and fees the agreements state, looked for in the seller's model; single-source
 * manufacturing and key-scientist concentration; R&D spend by imported year against a timeline the documents
 * say was brought forward; the P&L trend. Read-only and deterministic: the checks are the pack's rules, run
 * into Findings. The buyer's own side only. Documents, dates and consistency: never a view on efficacy,
 * approvability or trial design.
 */
@Injectable()
export class PharmaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async requirePharma(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'PHARMA_BIOTECH') throw new UnprocessableEntityException({ code: 'NOT_A_PHARMA_PACT', message: 'This pact is not a pharma and biotech pact' });
    return deal;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'pharma.pipeline.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requirePharma(tx, dealId);
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [PROGRAMME, REGISTRY_TRIAL, PATENT, OBLIGATION, SCIENTIST, INVOICE_LINE, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one pipeline view');
        throw error;
      }
      const pageRows = await tx.documentPage.findMany({
        where: { dealId, text: { not: null }, document: { status: 'AVAILABLE', dataClass: { in: [...RULE_READABLE_CLASSES] } } },
        select: { documentId: true, pageNumber: true, text: true, document: { select: { fileName: true } } },
        orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
        take: MAX_PAGES,
      });
      const pages = pageRows.flatMap((page) => (page.text ? [{ documentId: page.documentId, pageNumber: page.pageNumber, text: page.text }] : []));
      const names = new Map(pageRows.map((page) => [page.documentId, page.document.fileName]));
      const source = (quote: PackRuleQuote | null | undefined) => (quote ? { documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote } : null);

      const pipeline = programmes(evidence);
      const trials = registryTrials(evidence);
      const claims = pipelineClaims(evidence, pages);
      const estate = patentEstate(evidence, pages);
      const hold = holdWindow(evidence, pages);
      const cliffs = productCliffs(estate, hold, evidence);
      const obligations = obligationChecks(evidence, pages);
      const hasModel = evidence.some((row) => row.evidenceType === OBLIGATION);
      const products = [...new Set([...estate.map((entry) => entry.product), ...pipeline.map((entry) => entry.programme)])];
      const manufacturing = manufacturingDependence(pages, products);
      const scientists = keyScientists(evidence, pages);
      const concentrated = scientists.filter((entry) => entry.concentrated);
      const burn = rdBurn(evidence);
      const faster = timelineAccelerations(pages);
      const trend = pnlTrend(imported.periods, PHARMA_KEY_EXPENSES);

      return {
        guardrail: PHARMA_GUARDRAIL,
        noInventedFigures: PHARMA_NO_INVENTED_FIGURES,
        version: PHARMA_PIPELINE_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        claims: {
          programmes: pipeline.length,
          registeredTrials: trials.length,
          aspects: PHARMA_CLAIM_ASPECT_LABELS,
          count: claims.length,
          // bounded: up to three claims per pipeline programme, at most SHOWN
          items: claims.slice(0, SHOWN).map((claim) => ({
            programme: claim.programme,
            aspect: claim.aspect,
            statement: claim.statement,
            status: claim.status,
            rationale: claim.rationale,
            sources: claim.quotes.map((quote) => source(quote)),
          })),
          // bounded: the registry records supplied, at most SHOWN
          trials: trials.slice(0, SHOWN).map((trial) => ({ registryId: trial.registryId, programme: trial.programme, phase: trial.phase, status: trial.status, startDate: trial.startDate, primaryCompletion: trial.primaryCompletion })),
        },
        patents: {
          hold: hold ? { from: hold.from, basis: hold.basis, closingSource: source(hold.closingQuote), years: hold.years, yearsStated: hold.yearsStated, to: hold.to } : null,
          count: estate.length,
          // bounded: the patent schedule's rows, at most SHOWN
          estate: estate.slice(0, SHOWN).map((entry) => ({
            family: entry.family,
            product: entry.product,
            jurisdiction: entry.jurisdiction,
            type: entry.type,
            core: entry.core,
            scheduleExpiry: entry.scheduleExpiry,
            expiry: entry.expiry,
            basis: entry.basis,
            source: source(entry.quote),
          })),
          // bounded: one per product in the patent schedule, at most SHOWN
          cliffs: cliffs.slice(0, SHOWN).map((cliff) => ({
            product: cliff.product,
            coreBasis: cliff.coreBasis,
            cliff: cliff.cliff,
            jurisdiction: cliff.jurisdiction,
            state: cliff.state,
            monthsAfterClosing: cliff.monthsAfterClosing,
            yearsOfHoldAfter: cliff.yearsOfHoldAfter ? cliff.yearsOfHoldAfter.toFixed(2) : null,
            revenue: cliff.revenue ? { annual: cash(cliff.revenue.annual), currency: cliff.revenue.currency, from: cliff.revenue.from, to: cliff.revenue.to, lines: cliff.revenue.evidenceIds.length } : null,
          })),
        },
        obligations: {
          modelImported: hasModel,
          kinds: PHARMA_OBLIGATION_KIND_LABELS,
          states: PHARMA_OBLIGATION_STATE_LABELS,
          count: obligations.checks.length,
          // bounded: the obligations the agreements state, at most SHOWN
          checks: obligations.checks.slice(0, SHOWN).map((check) => ({
            kind: check.obligation.kind,
            payee: check.obligation.payee,
            trigger: check.obligation.trigger,
            amount: cash(check.obligation.amount),
            currency: check.obligation.currency,
            rate: rate(check.obligation.rate),
            source: source(check.obligation.quote),
            state: hasModel ? check.state : null,
            model: check.model ? { obligationId: check.model.obligationId, amount: cash(check.model.amount), rate: rate(check.model.rate), expected: check.model.expected || null } : null,
            gap: cash(check.gap),
            expected: check.expected ? { programme: check.expected.programme, milestone: check.expected.milestone, expected: check.expected.expected } : null,
          })),
          // bounded: model lines no agreement in the evidence states, at most SHOWN
          unmatched: obligations.unmatched.slice(0, SHOWN).map((row) => ({ obligationId: row.obligationId, counterparty: row.counterparty, kind: row.kind, trigger: row.trigger || null, amount: cash(row.amount), rate: rate(row.rate) })),
        },
        dependence: {
          // bounded: one per product or programme a document names with a single manufacturer
          manufacturing: manufacturing.map((entry) => ({ product: entry.product, singleSource: entry.singleSource, sole: source(entry.sole), secondSource: entry.secondSource ? { inPlace: entry.secondSource.inPlace, source: source(entry.secondSource.quote) } : null })),
          scientistThreshold: KEY_SCIENTIST_SHARE,
          scientists: scientists.length,
          // bounded: concentrated roster entries, at most SHOWN
          concentrated: concentrated.slice(0, SHOWN).map((entry) => ({
            scientistRef: entry.scientistRef,
            function: entry.function,
            programmesLed: entry.programmesLed.toFixed(0),
            programmeShare: rate(entry.programmeShare),
            patentFamilies: entry.patentFamilies.toFixed(0),
            familyShare: rate(entry.familyShare),
            retention: source(entry.retention),
          })),
        },
        burn: {
          flatTolerance: RD_FLAT_TOLERANCE,
          flat: burn.flat,
          change: burn.change ? burn.change.toFixed(4) : null,
          // bounded: one per imported fiscal year
          years: burn.years.map((year) => ({ year: year.year, amount: cash(year.amount), lines: year.evidenceIds.length, files: filesOf(imported, year.evidenceIds).map((file) => ({ uploadId: file.uploadId, fileName: file.fileName })) })),
          // bounded: the sentences that say a milestone was brought forward
          accelerations: faster.map((entry) => ({ from: entry.from, to: entry.to, source: source(entry.quote) })),
        },
        trend: {
          version: trend.version,
          partialYears: trend.partialYears,
          conventions: PNL_TREND_CONVENTIONS,
          // bounded: one per imported fiscal year
          years: trend.years.map((year) => ({
            year: year.year,
            basis: year.basis,
            revenue: year.revenue,
            revenueGrowth: year.revenueGrowth,
            grossMargin: year.grossMargin,
            operatingMargin: year.operatingMargin,
            ratios: year.ratios.map((entry) => ({ key: entry.key, label: entry.label, amount: entry.amount, ratio: entry.ratio })),
            lines: year.evidenceIds.length,
            files: filesOf(imported, year.evidenceIds).map((file) => ({ uploadId: file.uploadId, fileName: file.fileName })),
          })),
        },
      };
    });
  }
}
