import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  complianceDocuments,
  FINTECH_KEY_EXPENSES,
  FINTECH_PAYMENTS_VERSION,
  FINTECH_VOLUME_CLAIMS,
  fintechAnalysisDate,
  LICENCE,
  licenceRows,
  licenceStatuses,
  NEAR_EXPIRY_DAYS,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  PROCESSOR_MONTH,
  processorMonths,
  quarterlyRates,
  RECONCILIATION_TOLERANCE,
  revenueReconciliation,
  statedThresholds,
  volumeModel,
  type D,
  type PackRuleQuote,
  type VolumeWindow,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  FINTECH_COMPLIANCE_KINDS,
  FINTECH_COMPLIANCE_LABELS,
  FINTECH_GUARDRAIL,
  FINTECH_LICENCE_KIND_LABELS,
  FINTECH_NO_INVENTED_FIGURES,
  PNL_LINE_EVIDENCE_TYPE,
  permissionsForDealRole,
  type DealRole,
  type FintechLicenceKind,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for claims, thresholds, licence dates and compliance headings. */
const MAX_PAGES = 5_000;
/** Quarters the view shows: the latest eight (two years), oldest first. */
const QUARTERS_SHOWN = 8;
/** Documents a person filed under a compliance category; a pact's are tens, capped here. */
const MAX_FILED = 200;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const rate = (value: Decimal | null | undefined) => (value ? value.toFixed(6) : null);

const windowView = (window: VolumeWindow | null) =>
  window ? { from: window.from, to: window.to, missing: window.missing, volume: cash(window.volume), transactions: window.transactions.toFixed(0), netRevenue: cash(window.netRevenue), takeRate: rate(window.takeRate), rows: window.rows.length } : null;

/**
 * Fintech (T-159, ADR 0050): the Payments page. Processed volume, transactions, net revenue and the
 * effective take rate recomputed from the processor exports; the deck's claims set against them;
 * chargeback and fraud-loss rates by quarter against the thresholds the documents state; the licence
 * and sponsor register at the analysis date, with dates from the documents where they state them;
 * compliance evidence as present or absent; the P&L reconciled to the exports and read across every
 * imported year. Read-only and deterministic: the checks themselves are the pack's rules, run from
 * Findings (or this page) into the one findings register. The buyer's own side only. Diligence
 * support: status and dates, never whether a licence is required or a programme is compliant.
 */
@Injectable()
export class FintechService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async requireFintech(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'FINTECH') throw new UnprocessableEntityException({ code: 'NOT_A_FINTECH_PACT', message: 'This pact is not a fintech pact' });
    return deal;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'fintech.payments.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireFintech(tx, dealId);
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [PROCESSOR_MONTH, LICENCE, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one fintech view');
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
      const filed = await tx.document.findMany({
        where: { dealId, status: 'AVAILABLE', category: { in: [...FINTECH_COMPLIANCE_KINDS] } },
        select: { id: true, fileName: true, category: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_FILED,
      });
      for (const document of filed) names.set(document.id, document.fileName);
      const source = (quote: PackRuleQuote) => ({ documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote });

      const rows = processorMonths(evidence);
      const model = volumeModel(rows);
      const asOf = fintechAnalysisDate(rows);
      const quarters = quarterlyRates(rows);
      const thresholds = statedThresholds(pages);
      const latest = quarters.at(-1) ?? null;
      const claims = FINTECH_VOLUME_CLAIMS.detect({ evidence, pages }).flatMap((proposal) =>
        proposal.claim ? [{ title: proposal.title, status: proposal.claim.status, statement: proposal.claim.statement, rationale: proposal.claim.rationale, source: proposal.quotes?.[0] ? source(proposal.quotes[0]) : null }] : [],
      );
      const recognised = complianceDocuments(pages);
      const trend = pnlTrend(imported.periods, FINTECH_KEY_EXPENSES);

      return {
        guardrail: FINTECH_GUARDRAIL,
        noInventedFigures: FINTECH_NO_INVENTED_FIGURES,
        version: FINTECH_PAYMENTS_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        analysisDate: asOf,
        volume: {
          latestMonth: model.latestMonth,
          processors: model.processors,
          processorRows: rows.length,
          trailing: windowView(model.trailing),
          prior: windowView(model.prior),
          growth: model.growth ? model.growth.toFixed(4) : null,
        },
        claims,
        thresholds: thresholds.map((threshold) => {
          const value = !latest ? null : threshold.measure === 'FRAUD' ? latest.fraudRate : threshold.basis === 'COUNT' ? latest.chargebackRate : latest.chargebackValueRate;
          return {
            measure: threshold.measure,
            basis: threshold.basis,
            limit: threshold.limit.toFixed(6),
            latestQuarter: latest?.quarter ?? null,
            latestRate: rate(value),
            breached: value ? (threshold.strict ? value.gte(threshold.limit) : value.gt(threshold.limit)) : null,
            source: source(threshold.quote),
          };
        }),
        quarters: quarters.slice(-QUARTERS_SHOWN).map((quarter) => ({
          quarter: quarter.quarter,
          volume: cash(quarter.volume),
          transactions: quarter.transactions.toFixed(0),
          chargebacks: quarter.chargebacks.toFixed(0),
          chargebackRate: rate(quarter.chargebackRate),
          fraudLosses: cash(quarter.fraudLosses),
          fraudRate: rate(quarter.fraudRate),
        })),
        quartersShown: QUARTERS_SHOWN,
        // bounded: one row per licence or agreement, at most a few per jurisdiction
        licences: licenceStatuses(licenceRows(evidence), pages, asOf).map((status) => ({
          evidenceId: status.row.id,
          licenceId: status.row.licenceId,
          kind: status.row.kind,
          kindLabel: FINTECH_LICENCE_KIND_LABELS[status.row.kind as FintechLicenceKind] ?? status.row.kind,
          jurisdiction: status.row.jurisdiction,
          authority: status.row.authority,
          registerStatus: status.row.status,
          registerExpiresOn: status.row.expiresOn,
          expiresOn: status.expiresOn,
          state: status.state,
          registerDiffers: status.registerDiffers,
          source: status.document ? source(status.document.quote) : null,
        })),
        nearExpiryDays: NEAR_EXPIRY_DAYS,
        compliance: FINTECH_COMPLIANCE_KINDS.map((kind) => {
          const byHeading = recognised.filter((document) => document.kind === kind);
          const byCategory = filed.filter((document) => document.category === kind && !byHeading.some((found) => found.documentId === document.id));
          return {
            kind,
            label: FINTECH_COMPLIANCE_LABELS[kind],
            present: byHeading.length + byCategory.length > 0,
            documents: [
              ...byHeading.map((document) => ({ documentId: document.documentId, documentName: names.get(document.documentId) ?? null, date: document.date, consentOrder: document.consentOrder, recognisedBy: 'HEADING' as const, source: source(document.quote) })),
              ...byCategory.map((document) => ({ documentId: document.id, documentName: document.fileName, date: null, consentOrder: false, recognisedBy: 'CATEGORY' as const, source: null })),
            ],
          };
        }),
        reconciliation: {
          tolerance: RECONCILIATION_TOLERANCE,
          years: revenueReconciliation(evidence).map((year) => ({
            year: year.year,
            processorNetRevenue: cash(year.processor),
            pnlPaymentsRevenue: cash(year.pnl),
            difference: year.difference.toFixed(2),
            relative: year.relative ? year.relative.toFixed(4) : null,
            accounts: year.accounts,
            reconciles: year.relative ? year.relative.abs().lte(RECONCILIATION_TOLERANCE) : null,
          })),
        },
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
