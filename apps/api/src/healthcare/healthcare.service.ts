import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  CLINICIAN_CONCENTRATION_THRESHOLD,
  CLINICIAN_MONTH,
  clinicianMonths,
  clinicianShares,
  CODING_AUDIT_STALE_DAYS,
  collectionsReconciliation,
  COLLECTIONS_RECONCILIATION_TOLERANCE,
  collectionYears,
  CONTRACT_WINDOW_DAYS,
  covenantFor,
  CREDENTIAL,
  CREDENTIAL_NEAR_EXPIRY_DAYS,
  credentialRows,
  credentialStatuses,
  HEALTHCARE_COLLECTIONS_VERSION,
  HEALTHCARE_KEY_EXPENSES,
  HEALTHCARE_PRACTICE_CLAIMS,
  healthcareAnalysisDate,
  healthcareComplianceDocuments,
  PAYER_CLASS_LABELS,
  PAYER_CONTRACT,
  payerContracts,
  payerContractStatuses,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  REMITTANCE,
  remittanceMonths,
  trailingCollections,
  unlicensedRoster,
  type CollectionsPeriod,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  HEALTHCARE_COMPLIANCE_KINDS,
  HEALTHCARE_COMPLIANCE_LABELS,
  HEALTHCARE_CREDENTIAL_KIND_LABELS,
  HEALTHCARE_GUARDRAIL,
  HEALTHCARE_NO_INVENTED_FIGURES,
  PNL_LINE_EVIDENCE_TYPE,
  permissionsForDealRole,
  type DealRole,
  type HealthcareCredentialKind,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const ROSTER = 'healthcare.provider';
const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for claims, licence dates, covenants and compliance headings. */
const MAX_PAGES = 5_000;
/** Documents a person filed under a compliance category; a pact's are tens, capped here. */
const MAX_FILED = 200;
/** Clinicians the view lists by share (the largest first); the rest are counted. */
const CLINICIANS_SHOWN = 25;
/** Credentials the view lists: every exception (expired, expiring, pending), up to this many; active ones are counted. */
const CREDENTIALS_SHOWN = 100;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const rate = (value: Decimal | null | undefined) => (value ? value.toFixed(6) : null);

const periodView = (period: CollectionsPeriod) => ({
  label: period.label,
  from: period.from,
  to: period.to,
  missing: period.missing,
  claims: period.claims.toFixed(0),
  denied: period.denied.toFixed(0),
  billed: cash(period.billed),
  collected: cash(period.collected),
  denialRate: rate(period.denialRate),
  collectionRate: rate(period.collectionRate),
  daysInAr: period.daysInAr ? period.daysInAr.toFixed(1) : null,
  rows: period.rows.length,
  // bounded: one entry per payer class, five at most
  byClass: period.byClass.map((entry) => ({
    payerClass: entry.payerClass,
    label: PAYER_CLASS_LABELS[entry.payerClass],
    collected: cash(entry.collected),
    share: rate(entry.share),
    claimShare: rate(entry.claimShare),
    yieldPerClaim: cash(entry.yieldPerClaim),
  })),
});

/**
 * Healthcare services (T-160, ADR 0051): the Practice page. Collections, charges, denials and days in
 * AR by year and for the trailing twelve months, and the payer mix, recomputed from the remittance
 * export; the deck's claims set against them; the P&L reconciled to collections and read across every
 * imported year; every rostered clinician's licences at the analysis date, with dates from the
 * verification documents where they state them; clinician concentration against the non-compete and
 * retention schedule; the payer contract register; and compliance evidence as present or absent.
 * Read-only and deterministic: the checks themselves are the pack's rules, run from Findings (or this
 * page) into the one findings register. The buyer's own side only. Documents, dates and arithmetic:
 * never the quality of care or whether anything is lawful.
 */
@Injectable()
export class HealthcareService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async requireHealthcare(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'HEALTHCARE') throw new UnprocessableEntityException({ code: 'NOT_A_HEALTHCARE_PACT', message: 'This pact is not a healthcare services pact' });
    return deal;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'healthcare.practice.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireHealthcare(tx, dealId);
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [REMITTANCE, CLINICIAN_MONTH, CREDENTIAL, PAYER_CONTRACT, ROSTER, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one practice view');
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
        where: { dealId, status: 'AVAILABLE', category: { in: [...HEALTHCARE_COMPLIANCE_KINDS] } },
        select: { id: true, fileName: true, category: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_FILED,
      });
      for (const document of filed) names.set(document.id, document.fileName);
      const source = (quote: PackRuleQuote) => ({ documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote });

      const rows = remittanceMonths(evidence);
      const asOf = healthcareAnalysisDate(rows);
      const { years, partialYears } = collectionYears(rows);
      const trailing = trailingCollections(rows);
      const claims = HEALTHCARE_PRACTICE_CLAIMS.detect({ evidence, pages }).flatMap((proposal) =>
        proposal.claim ? [{ title: proposal.title, status: proposal.claim.status, statement: proposal.claim.statement, rationale: proposal.claim.rationale, source: proposal.quotes?.[0] ? source(proposal.quotes[0]) : null }] : [],
      );
      const collections = clinicianMonths(evidence);
      const shares = clinicianShares(collections);
      const credentialList = credentialRows(evidence);
      const statuses = credentialStatuses(credentialList, pages, asOf, collections);
      const exceptions = statuses.filter((status) => status.state !== 'ACTIVE' && status.state !== 'NO_EXPIRY');
      const recognised = healthcareComplianceDocuments(pages);
      const trend = pnlTrend(imported.periods, HEALTHCARE_KEY_EXPENSES);

      return {
        guardrail: HEALTHCARE_GUARDRAIL,
        noInventedFigures: HEALTHCARE_NO_INVENTED_FIGURES,
        version: HEALTHCARE_COLLECTIONS_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        analysisDate: asOf,
        collections: {
          remittanceRows: rows.length,
          payers: [...new Set(rows.map((row) => row.payer))].length,
          trailing: trailing ? periodView(trailing) : null,
          // bounded: one entry per calendar year the export covers in full
          years: years.map(periodView),
          partialYears,
        },
        claims,
        clinicians: shares
          ? {
              from: shares.from,
              to: shares.to,
              missing: shares.missing,
              total: cash(shares.total),
              threshold: CLINICIAN_CONCENTRATION_THRESHOLD,
              count: shares.clinicians.length,
              shown: CLINICIANS_SHOWN,
              // bounded: the largest CLINICIANS_SHOWN by share; the rest are counted
              items: shares.clinicians.slice(0, CLINICIANS_SHOWN).map((clinician) => {
                const covenant = covenantFor(pages, clinician.providerRef);
                return { providerRef: clinician.providerRef, collected: cash(clinician.collected), share: rate(clinician.share), covenant: covenant ? source(covenant) : null };
              }),
            }
          : null,
        credentials: {
          nearExpiryDays: CREDENTIAL_NEAR_EXPIRY_DAYS,
          total: statuses.length,
          active: statuses.length - exceptions.length,
          // bounded: exceptions only (expired, expiring, pending), at most CREDENTIALS_SHOWN; active rows are counted
          exceptions: exceptions.slice(0, CREDENTIALS_SHOWN).map((status) => ({
            evidenceId: status.row.id,
            providerRef: status.row.providerRef,
            credentialRef: status.row.credentialRef,
            kind: status.row.kind,
            kindLabel: HEALTHCARE_CREDENTIAL_KIND_LABELS[status.row.kind as HealthcareCredentialKind] ?? status.row.kind,
            jurisdiction: status.row.jurisdiction,
            issuer: status.row.issuer,
            registerStatus: status.row.status,
            registerExpiresOn: status.row.expiresOn,
            expiresOn: status.expiresOn,
            state: status.state,
            registerDiffers: status.registerDiffers,
            collectedAfter: status.collectedAfter ? { months: status.collectedAfter.months.length, collected: cash(status.collectedAfter.collected) } : null,
            source: status.document ? source(status.document.quote) : null,
          })),
          // bounded: rostered clinicians with no licence on file, at most CREDENTIALS_SHOWN
          unlicensed: unlicensedRoster(evidence, credentialList, pages).slice(0, CREDENTIALS_SHOWN).map((row) => row.canonical['provider_ref'] ?? ''),
        },
        contracts: {
          windowDays: CONTRACT_WINDOW_DAYS,
          registerRows: payerContracts(evidence).length,
          // bounded: one row per payer that remitted in the trailing twelve months
          payers: payerContractStatuses(rows, payerContracts(evidence), asOf).map((status) => ({
            payer: status.payer,
            payerClass: status.payerClass,
            collected: cash(status.collected),
            share: rate(status.share),
            contractId: status.contract?.contractId ?? null,
            expiresOn: status.contract?.expiresOn ?? null,
            autoRenews: status.contract?.autoRenews ?? null,
            state: status.state,
            daysToExpiry: status.daysToExpiry,
          })),
        },
        compliance: {
          codingAuditStaleDays: CODING_AUDIT_STALE_DAYS,
          kinds: HEALTHCARE_COMPLIANCE_KINDS.map((kind) => {
            const byHeading = recognised.filter((document) => document.kind === kind);
            const byCategory = filed.filter((document) => document.category === kind && !byHeading.some((found) => found.documentId === document.id));
            return {
              kind,
              label: HEALTHCARE_COMPLIANCE_LABELS[kind],
              present: byHeading.length + byCategory.length > 0,
              documents: [
                ...byHeading.map((document) => ({ documentId: document.documentId, documentName: names.get(document.documentId) ?? null, date: document.date, recognisedBy: 'HEADING' as const, source: source(document.quote) })),
                ...byCategory.map((document) => ({ documentId: document.id, documentName: document.fileName, date: null, recognisedBy: 'CATEGORY' as const, source: null })),
              ],
            };
          }),
        },
        reconciliation: {
          tolerance: COLLECTIONS_RECONCILIATION_TOLERANCE,
          years: collectionsReconciliation(evidence).map((year) => ({
            year: year.year,
            collected: cash(year.collected),
            pnlPatientRevenue: cash(year.pnl),
            difference: year.difference.toFixed(2),
            relative: year.relative ? year.relative.toFixed(4) : null,
            accounts: year.accounts,
            reconciles: year.relative ? year.relative.abs().lte(COLLECTIONS_RECONCILIATION_TOLERANCE) : null,
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
