import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  capexSchedule,
  conditionItems,
  CRE_CAM,
  CRE_CAPEX,
  CRE_CLIFF_SHARE,
  CRE_CLIFF_YEARS,
  CRE_CONVENTIONS,
  CRE_KEY_EXPENSES,
  CRE_LEASE,
  CRE_LEASES_VERSION,
  CRE_RECOVERY_TOLERANCE,
  CRE_RENT_TOLERANCE,
  CRE_STATEMENT_TOLERANCE,
  expiryProfile,
  leaseDocuments,
  obligations,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  recoveryYears,
  rentChecks,
  statementRent,
  tenantRents,
  D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient } from '@pactlab/db';
import {
  CRE_CAPEX_STATUS_LABELS,
  CRE_GUARDRAIL,
  CRE_LEASE_TYPE_LABELS,
  CRE_NO_INVENTED_FIGURES,
  CRE_OBLIGATION_KIND_LABELS,
  CRE_RENT_CHECK_LABELS,
  PNL_LINE_EVIDENCE_TYPE,
  permissionsForDealRole,
  type CreCapexStatus,
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
/** Pages the checks read for the leases, the reports and the closing. */
const MAX_PAGES = 5_000;
/** Rent-roll suites and capex projects the view lists; the rest are counted. */
const ROWS_SHOWN = 200;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const ratio = (value: Decimal | null | undefined) => (value ? value.toFixed(4) : null);
const capexLabel = (status: string) => CRE_CAPEX_STATUS_LABELS[status as CreCapexStatus] ?? (status || 'Not stated');

/**
 * Commercial property (T-165, ADR 0055): the Leases page. Rent, escalations and expiries recomputed lease by
 * lease against the rent roll and the statements; NNN recoveries billed against recoverable under the leases,
 * by year; the obligations register (allowances, commissions, committed capex); rent share by tenant and the
 * expiry profile against the hold; condition items against the capex schedule; and the P&L across every
 * imported year. Read-only and deterministic: the checks themselves are the pack's rules, run from Findings
 * (or this page) into the one findings register. The buyer's own side only. It never values the property.
 */
@Injectable()
export class CommercialPropertyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'commercial_property.leases.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
      if (!deal) throw new NotFoundException();
      if (deal.parties[0]?.companyType !== 'COMMERCIAL_PROPERTY') throw new UnprocessableEntityException({ code: 'NOT_A_COMMERCIAL_PROPERTY_PACT', message: 'This pact is not a commercial property pact' });
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [CRE_LEASE, CRE_CAM, CRE_CAPEX, PNL_LINE_EVIDENCE_TYPE, 'billing.invoice_line']);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one commercial property view');
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

      const leases = leaseDocuments(pages);
      const { asOf, checks } = rentChecks(evidence, pages);
      const statements = statementRent(evidence, pages);
      const recoveries = recoveryYears(evidence, pages);
      const register = obligations(evidence, pages);
      const { hold, tenants, total } = tenantRents(evidence, pages);
      const profile = expiryProfile(tenants, total, hold);
      const condition = conditionItems(evidence, pages);
      const schedule = capexSchedule(evidence);
      const trend = pnlTrend(imported.periods, CRE_KEY_EXPENSES);
      const outstanding = register.filter((entry) => entry.outstanding);

      return {
        guardrail: CRE_GUARDRAIL,
        noInventedFigures: CRE_NO_INVENTED_FIGURES,
        version: CRE_LEASES_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        conventions: CRE_CONVENTIONS,
        asOf,
        hold: hold ? { from: hold.from, to: hold.to, basis: hold.basis, years: hold.years, yearsStated: hold.yearsStated, closingSource: source(hold.closingQuote) } : null,
        leasesRead: leases.length,
        rentRoll: {
          suites: checks.length,
          tolerance: CRE_RENT_TOLERANCE,
          rows: checks.slice(0, ROWS_SHOWN).map((check) => ({
            evidenceId: check.row.id,
            tenant: check.row.tenant,
            suite: check.row.suite,
            rollRent: cash(check.row.rent),
            leaseRent: cash(check.leaseRent),
            difference: cash(check.difference),
            relative: ratio(check.relative),
            state: check.state,
            stateLabel: CRE_RENT_CHECK_LABELS[check.state],
            escalations: check.escalations,
            escalation: ratio(check.lease?.escalation),
            rollEnd: check.row.leaseEnd,
            leaseEnd: check.lease?.expiry ?? null,
            expiryMatches: check.expiryMatches,
            leaseType: check.lease?.leaseType ?? null,
            leaseTypeLabel: check.lease ? CRE_LEASE_TYPE_LABELS[check.lease.leaseType] : null,
            share: ratio(check.lease?.share),
            source: source(check.lease?.rentQuote ?? check.lease?.heading),
          })),
        },
        statementRent: {
          complete: statements.complete,
          tolerance: CRE_STATEMENT_TOLERANCE,
          years: statements.years.map((year) => ({ year: year.year, statement: cash(year.statement), leases: cash(year.leases), difference: year.difference.toFixed(2), relative: ratio(year.relative), ties: year.relative ? year.relative.abs().lte(CRE_STATEMENT_TOLERANCE) : null })),
        },
        recoveries: {
          tolerance: CRE_RECOVERY_TOLERANCE,
          netLeases: recoveries.netLeases.length,
          netShare: ratio(recoveries.netLeases.reduce((sum, lease) => sum.plus(lease.share ?? 0), new D(0))),
          years: recoveries.years.map((year) => ({ year: year.year, pool: cash(year.pool), poolAccounts: year.poolAccounts, recoverable: cash(year.recoverable), billed: cash(year.billed), shortfall: year.shortfall.toFixed(2), relative: ratio(year.relative), short: year.short })),
          persistent: recoveries.years.length >= 2 && recoveries.years.every((year) => year.short),
        },
        // bounded: the allowances and commissions the documents state and the committed projects in the schedule
        obligations: register.map((entry) => ({
          kind: entry.kind,
          kindLabel: CRE_OBLIGATION_KIND_LABELS[entry.kind],
          party: entry.party,
          amount: cash(entry.amount),
          currency: entry.currency ?? deal.baseCurrency,
          due: entry.due,
          outstanding: entry.outstanding,
          source: source(entry.quote),
        })),
        obligationsOutstanding: cash(outstanding.reduce((sum, entry) => sum.plus(entry.amount), new D(0))),
        tenants: {
          total: cash(total),
          cliffShare: CRE_CLIFF_SHARE,
          cliffYears: CRE_CLIFF_YEARS,
          rows: tenants.slice(0, ROWS_SHOWN).map((entry) => ({
            tenant: entry.tenant,
            suite: entry.suite,
            rent: cash(entry.rent),
            source: entry.source,
            share: ratio(entry.share),
            expiry: entry.expiry,
            holdYear: entry.holdYear,
            afterHold: entry.afterHold,
            cliff: Boolean(entry.share?.gte(CRE_CLIFF_SHARE) && entry.holdYear !== null && entry.holdYear >= 1 && entry.holdYear <= CRE_CLIFF_YEARS),
          })),
          // bounded: one bucket per year of the hold, plus before closing and after it
          expiryProfile: profile.map((bucket) => ({ label: bucket.label, holdYear: bucket.holdYear, rent: cash(bucket.rent) ?? '0.00', share: ratio(bucket.share), tenants: bucket.tenants.length })),
        },
        condition: {
          scheduleImported: schedule.length > 0,
          // bounded: the items the reports recommend with a cost, a handful per property
          items: condition.map((item) => ({ element: item.element, label: item.label, amount: cash(item.amount), currency: item.currency, covered: item.covered.map((entry) => entry.item), source: source(item.quote) })),
        },
        capex: {
          total: schedule.length,
          rows: schedule.slice(0, ROWS_SHOWN).map((item) => ({ evidenceId: item.id, item: item.item, category: item.category, year: item.year, amount: cash(item.amount), status: item.status, statusLabel: capexLabel(item.status) })),
        },
        rowsShown: ROWS_SHOWN,
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
