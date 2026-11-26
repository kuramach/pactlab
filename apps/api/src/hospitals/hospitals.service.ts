import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  CAPEX_FALL_FACTOR,
  capexYears,
  CENSUS_MONTH,
  censusWindow,
  conditionAssessments,
  CONTRACT_WINDOW_MONTHS,
  COST_REPORT_CLAIM_TOLERANCE,
  COST_REPORT_FIGURE_LABELS,
  COST_REPORT_PNL_TOLERANCE,
  costReportReconciliations,
  costReports,
  DEPARTMENT_CLUSTER_SIZE,
  departmentClusters,
  HOSPITALS_COST_REPORT_RECONCILIATION,
  HOSPITALS_KEY_EXPENSES,
  HOSPITALS_OPERATIONS_VERSION,
  HOSPITALS_QUALITY_CLAIMS,
  hospitalPayerContracts,
  hospitalsAnalysisDate,
  MATERIAL_PAYER_SHARE,
  MEDICAL_STAFF,
  medicalStaff,
  modernPlantClaim,
  PAYER_MONTH,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  PRIVILEGES_DUE_DAYS,
  qualityReports,
  staffStatuses,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { PNL_LINE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { HOSPITALS_CONTRACT_TERM_LABELS, HOSPITALS_GUARDRAIL, HOSPITALS_NO_INVENTED_FIGURES, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for the cost report, the deck, the agreements, the condition assessment and the quality reporting. */
const MAX_PAGES = 5_000;
/** Payers the view lists, largest first; the rest are counted. */
const PAYERS_SHOWN = 25;
/** Staff exceptions (lapsed privileges, expired licences) the view lists; the rest are counted. */
const EXCEPTIONS_SHOWN = 50;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const rate = (value: Decimal | null | undefined) => (value ? value.toFixed(6) : null);

/**
 * Hospitals (T-162, ADR 0053): the Hospital page — what only hospitals carry. The filed cost report
 * (beds, inpatient days, occupancy, payer shares of days, total costs) with the deck's figures set
 * against it and its costs reconciled to the P&L; the payer contract register, each contracted payer in
 * the payer mix with its agreement's rate basis, term and renewal window measured from the expected
 * closing; the medical-staff register by department, with departments whose privileges lapse together;
 * capital spend as a share of revenue across the imported P&L years beside the property condition
 * assessment and the deck's plant claim; and the deck's quality rating against the reporting supplied.
 * Read-only and deterministic: the checks are the pack's rules, run into Findings. The buyer's own side
 * only. Documents, dates and arithmetic: never a survey, clinical or legal judgment.
 */
@Injectable()
export class HospitalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async requireHospital(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'HOSPITALS') throw new UnprocessableEntityException({ code: 'NOT_A_HOSPITALS_PACT', message: 'This pact is not a hospitals pact' });
    return deal;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'hospitals.operations.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireHospital(tx, dealId);
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [CENSUS_MONTH, PAYER_MONTH, MEDICAL_STAFF, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one hospital view');
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

      const asOf = hospitalsAnalysisDate(evidence);
      const reports = costReports(pages);
      const claimed = (proposals: readonly { title: string; claim?: { status: string; statement: string; rationale: string } | null; quotes?: readonly PackRuleQuote[] }[]) =>
        proposals.flatMap((proposal) => (proposal.claim ? [{ title: proposal.title, status: proposal.claim.status, statement: proposal.claim.statement, rationale: proposal.claim.rationale, source: source(proposal.quotes?.[0]) }] : []));
      const census = censusWindow(evidence);
      const latestReport = [...reports].sort((a, b) => (a.fiscalYear ?? '').localeCompare(b.fiscalYear ?? '')).at(-1) ?? null;
      const contracts = hospitalPayerContracts(evidence, pages);
      const staff = medicalStaff(evidence);
      const statuses = staffStatuses(staff, pages, asOf);
      const exceptions = statuses.filter((status) => status.licenceExpired || status.privilegesLapsed);
      const departments = [...new Set(staff.map((row) => row.department))].sort();
      const capex = capexYears(evidence);
      const trend = pnlTrend(imported.periods, HOSPITALS_KEY_EXPENSES);
      const ratings = qualityReports(pages);

      return {
        guardrail: HOSPITALS_GUARDRAIL,
        noInventedFigures: HOSPITALS_NO_INVENTED_FIGURES,
        version: HOSPITALS_OPERATIONS_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        analysisDate: asOf,
        census: census
          ? {
              from: census.from,
              to: census.to,
              missing: census.missing,
              admissions: census.admissions.toFixed(0),
              patientDays: census.patientDays.toFixed(0),
              averageDailyCensus: census.averageDailyCensus ? census.averageDailyCensus.toFixed(1) : null,
              averageLengthOfStay: census.averageLengthOfStay ? census.averageLengthOfStay.toFixed(2) : null,
              // Occupancy needs the beds the cost report states: trailing census days ÷ (beds × days in the window).
              occupancy: latestReport?.beds && census.averageDailyCensus ? rate(census.averageDailyCensus.div(latestReport.beds.value)) : null,
            }
          : null,
        costReport: {
          tolerance: COST_REPORT_CLAIM_TOLERANCE,
          pnlTolerance: COST_REPORT_PNL_TOLERANCE,
          // bounded: one entry per cost report document in the pact
          reports: reports.map((report) => ({
            documentId: report.documentId,
            documentName: names.get(report.documentId) ?? null,
            heading: source(report.heading),
            fiscalYear: report.fiscalYear,
            beds: report.beds ? { value: report.beds.value.toFixed(0), source: source(report.beds.quote) } : null,
            patientDays: report.patientDays ? { value: report.patientDays.value.toFixed(0), source: source(report.patientDays.quote) } : null,
            // bounded: the five figures the reconciliation reads
            figures: report.figures.map((figure) => ({ key: figure.key, label: COST_REPORT_FIGURE_LABELS[figure.key], value: figure.key === 'TOTAL_COSTS' ? figure.value.toFixed(2) : figure.value.toFixed(1), currency: figure.currency, source: source(figure.quote) })),
          })),
          claims: claimed(HOSPITALS_COST_REPORT_RECONCILIATION.detect({ evidence, pages })),
          reconciliation: costReportReconciliations(evidence, pages).map((entry) => ({
            fiscalYear: entry.fiscalYear,
            costReportCosts: cash(entry.costReportCosts),
            pnlCosts: cash(entry.pnlCosts),
            difference: entry.difference.toFixed(2),
            share: entry.share.toFixed(4),
            agrees: entry.agrees,
          })),
        },
        payerContracts: {
          materialShare: MATERIAL_PAYER_SHARE,
          windowMonths: CONTRACT_WINDOW_MONTHS,
          terms: HOSPITALS_CONTRACT_TERM_LABELS,
          measuredFrom: contracts.from ? { date: contracts.from.date, basis: contracts.from.basis, source: source(contracts.from.quote) } : null,
          count: contracts.payers.length,
          // bounded: the largest PAYERS_SHOWN payers in the mix; the rest are counted
          payers: contracts.payers.slice(0, PAYERS_SHOWN).map((status) => ({
            payer: status.payer.payer,
            netRevenue: cash(status.payer.netRevenue),
            share: rate(status.payer.share),
            contracted: status.payer.contracted,
            material: status.material,
            largestContracted: status.largestContracted,
            state: status.state,
            monthsAfterClose: status.monthsAfterClose,
            agreement: status.agreement
              ? {
                  documentId: status.agreement.documentId,
                  documentName: names.get(status.agreement.documentId) ?? null,
                  expiresOn: status.agreement.expiresOn,
                  autoRenews: status.agreement.autoRenews,
                  expiry: source(status.agreement.expiry),
                  rateBasis: source(status.agreement.rateBasis),
                  renegotiation: source(status.agreement.renegotiation),
                }
              : null,
          })),
        },
        medicalStaff: {
          clusterSize: DEPARTMENT_CLUSTER_SIZE,
          dueDays: PRIVILEGES_DUE_DAYS,
          count: staff.length,
          // bounded: one row per department in the register
          departments: departments.map((department) => {
            const mine = statuses.filter((status) => status.row.department === department);
            return { department, staff: mine.length, privilegesLapsed: mine.filter((status) => status.privilegesLapsed).length, licencesExpired: mine.filter((status) => status.licenceExpired).length };
          }),
          // bounded: departments × shared dates, each at least DEPARTMENT_CLUSTER_SIZE staff
          clusters: departmentClusters(staff, asOf).map((cluster) => ({ department: cluster.department, date: cluster.date, state: cluster.state, staff: cluster.staff.map((row) => row.staffRef), departmentSize: cluster.departmentSize })),
          exceptionCount: exceptions.length,
          // bounded: the first EXCEPTIONS_SHOWN; the rest are counted
          exceptions: exceptions.slice(0, EXCEPTIONS_SHOWN).map((status) => ({
            staffRef: status.row.staffRef,
            department: status.row.department,
            licenceExpiresOn: status.licenceExpiresOn,
            licenceExpired: status.licenceExpired,
            licenceVerified: source(status.licenceVerified),
            privilegesExpireOn: status.row.privilegesExpireOn,
            privilegeStatus: status.row.privilegeStatus,
            privilegesLapsed: status.privilegesLapsed,
          })),
        },
        plant: {
          fallFactor: CAPEX_FALL_FACTOR,
          // bounded: one per imported fiscal year
          years: capex.years.map((year) => ({ year: year.year, amount: cash(year.amount), revenue: cash(year.revenue), ratio: rate(year.ratio), files: filesOf(imported, year.evidenceIds).map((file) => ({ uploadId: file.uploadId, fileName: file.fileName })) })),
          claim: source(modernPlantClaim(pages)),
          // bounded: one per condition assessment document in the pact
          assessments: conditionAssessments(pages).map((assessment) => ({
            documentId: assessment.documentId,
            documentName: names.get(assessment.documentId) ?? null,
            heading: source(assessment.heading),
            statements: assessment.statements.slice(0, 10).map((quote) => source(quote)),
            deferredMaintenance: assessment.deferredMaintenance ? { amount: cash(assessment.deferredMaintenance.amount), currency: assessment.deferredMaintenance.currency, source: source(assessment.deferredMaintenance.quote) } : null,
          })),
        },
        quality: {
          // bounded: one per quality-reporting document in the pact
          reports: ratings.map((report) => ({ documentId: report.documentId, documentName: names.get(report.documentId) ?? null, heading: source(report.heading), stars: report.stars?.value ?? null, source: source(report.stars?.quote) })),
          claims: claimed(HOSPITALS_QUALITY_CLAIMS.detect({ evidence, pages })),
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
