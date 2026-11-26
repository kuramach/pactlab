import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  AGEING_BAND,
  ageingByYear,
  ageingReports,
  BILLING_MONTH,
  billingRows,
  billingYears,
  coverageFor,
  FEE_RECONCILIATION_TOLERANCE,
  feeReconciliation,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  practiceModel,
  RAINMAKER_SHARE,
  SERVICES_CONCENTRATION_CLAIMS,
  SERVICES_CONVENTIONS,
  SERVICES_KEY_EXPENSES,
  SERVICES_PRACTICE_VERSION,
  servicesUtilization,
  TIMESHEET_MONTH,
  type D,
  type FeeShare,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient } from '@pactlab/db';
import {
  permissionsForDealRole,
  PNL_LINE_EVIDENCE_TYPE,
  SERVICES_AGEING_BAND_LABELS,
  SERVICES_COVERAGE_STATE_LABELS,
  SERVICES_ENGAGEMENT_KIND_LABELS,
  SERVICES_GUARDRAIL,
  SERVICES_LEDGER_LABELS,
  SERVICES_NO_INVENTED_FIGURES,
  type DealRole,
  type ServicesAgeingBand,
  type ServicesEngagementKind,
  type ServicesLedger,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for the deck's ceilings and the covenant register. */
const MAX_PAGES = 5_000;
/** Clients and fee-earners the view lists, largest first; the rest are counted. */
const SHARES_SHOWN = 25;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const ratio = (value: Decimal | null | undefined) => (value ? value.toFixed(4) : null);
const shareRow = (entry: FeeShare) => ({ key: entry.key, billed: cash(entry.billed), share: ratio(entry.share), rows: entry.rows.length });

/**
 * IT and professional services (T-167, ADR 0055): the Practice page. Fees, realization and collection from
 * the time-and-billing export, by year and reconciled to the P&L; utilization from the timesheets; fees by
 * client, fee-earner and partner book against the deck's ceilings; the recurring split; WIP and debtor
 * ageing by year; the covenant register against each rainmaker; and the P&L across every imported year.
 * Read-only and deterministic: the checks themselves are the pack's rules, run from Findings (or this page)
 * into the one findings register. The buyer's own side only. Fee-earners are pseudonymous references; the
 * page reports documents and arithmetic, never an assessment of a person.
 */
@Injectable()
export class ProfessionalServicesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'services.practice.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
      if (!deal) throw new NotFoundException();
      if (deal.parties[0]?.companyType !== 'PROFESSIONAL_SERVICES') throw new UnprocessableEntityException({ code: 'NOT_A_SERVICES_PACT', message: 'This pact is not an IT and professional services pact' });
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [BILLING_MONTH, TIMESHEET_MONTH, AGEING_BAND, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one services view');
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
      const source = (quote: PackRuleQuote) => ({ documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote });

      const rows = billingRows(evidence);
      const model = practiceModel(rows);
      const trailing = model.trailing;
      const usage = servicesUtilization(evidence);
      const ageing = ageingByYear(ageingReports(evidence));
      const trend = pnlTrend(imported.periods, SERVICES_KEY_EXPENSES);
      const claims = SERVICES_CONCENTRATION_CLAIMS.detect({ evidence, pages }).flatMap((proposal) =>
        proposal.claim ? [{ title: proposal.title, status: proposal.claim.status, statement: proposal.claim.statement, rationale: proposal.claim.rationale, source: proposal.quotes?.[0] ? source(proposal.quotes[0]) : null }] : [],
      );

      return {
        guardrail: SERVICES_GUARDRAIL,
        noInventedFigures: SERVICES_NO_INVENTED_FIGURES,
        version: SERVICES_PRACTICE_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        conventions: SERVICES_CONVENTIONS,
        fees: {
          latestMonth: model.latestMonth,
          billingRows: rows.length,
          trailing: trailing
            ? {
                from: trailing.from,
                to: trailing.to,
                missing: trailing.missing,
                billed: cash(trailing.billed),
                standard: cash(trailing.standard),
                collected: cash(trailing.collected),
                hoursWorked: trailing.hoursWorked.toFixed(1),
                hoursBilled: trailing.hoursBilled.toFixed(1),
                realization: ratio(trailing.realization),
                collection: ratio(trailing.collection),
              }
            : null,
          utilization: usage ? { from: usage.from, to: usage.to, months: usage.months, available: usage.available.toFixed(0), billable: usage.billable.toFixed(0), rate: ratio(usage.rate) } : null,
          recurringShare: ratio(model.recurringShare),
          // bounded: one row per engagement kind, four at most
          byEngagement: model.byEngagement.map((entry) => ({ ...shareRow(entry), label: SERVICES_ENGAGEMENT_KIND_LABELS[entry.key as ServicesEngagementKind] ?? entry.key })),
        },
        clients: model.clients.slice(0, SHARES_SHOWN).map(shareRow),
        clientsTotal: model.clients.length,
        feeEarners: model.feeEarners.slice(0, SHARES_SHOWN).map(shareRow),
        feeEarnersTotal: model.feeEarners.length,
        sharesShown: SHARES_SHOWN,
        claims,
        // bounded: one row per relationship partner, a handful per firm
        partners: model.partners.slice(0, SHARES_SHOWN).map((partner) => {
          const rainmaker = partner.share ? partner.share.gte(RAINMAKER_SHARE) : false;
          const cover = coverageFor(pages, partner.key);
          return {
            ...shareRow(partner),
            clients: new Set(partner.rows.map((row) => row.client)).size,
            rainmaker,
            coverage: cover.state,
            coverageLabel: SERVICES_COVERAGE_STATE_LABELS[cover.state],
            source: cover.quote ? source(cover.quote) : null,
          };
        }),
        partnerBasis: model.partnerBasis,
        rainmakerShare: RAINMAKER_SHARE,
        documentsRead: pages.length > 0,
        years: billingYears(rows).map((year) => ({ year: year.year, billed: cash(year.billed), standard: cash(year.standard), realization: ratio(year.realization), collection: ratio(year.collection) })),
        reconciliation: {
          tolerance: FEE_RECONCILIATION_TOLERANCE,
          years: feeReconciliation(evidence).map((year) => ({
            year: year.year,
            exportsBilled: cash(year.exports),
            pnlRevenue: cash(year.pnl),
            difference: year.difference.toFixed(2),
            relative: year.relative ? year.relative.toFixed(4) : null,
            accounts: year.accounts,
            reconciles: year.relative ? year.relative.abs().lte(FEE_RECONCILIATION_TOLERANCE) : null,
          })),
        },
        // bounded: two ledgers, one report per year
        ageing: Object.entries(ageing).map(([ledger, years]) => ({
          ledger,
          label: SERVICES_LEDGER_LABELS[ledger as ServicesLedger] ?? ledger,
          years: years.map((year) => ({
            year: year.year,
            asOf: year.asOf,
            total: cash(year.total) ?? '0.00',
            over90: cash(year.over90) ?? '0.00',
            over90Share: ratio(year.over90Share),
            bands: year.bands.map((band) => ({ band: band.band, label: SERVICES_AGEING_BAND_LABELS[band.band as ServicesAgeingBand] ?? band.band, amount: cash(band.amount) ?? '0.00' })),
          })),
        })),
        trend: {
          version: trend.version,
          partialYears: trend.partialYears,
          conventions: PNL_TREND_CONVENTIONS,
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
