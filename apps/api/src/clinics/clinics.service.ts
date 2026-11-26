import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  CLINICIAN_MONTH,
  CLINICS_PRACTICE_VERSION,
  clinicsAnalysisDate,
  isSelfReferral,
  OWNER_SHARE_THRESHOLD,
  ownerOnlyLines,
  ownerShare,
  PREMISES_SHORT_TERM_MONTHS,
  premisesStatuses,
  REFERRAL_CONCENTRATION_THRESHOLD,
  REFERRAL_MONTH,
  referralMonths,
  referralWindow,
  sellingOwner,
  SERVICE_LINE_MONTH,
  serviceLineMonths,
  serviceLineWindow,
  successionEvidence,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { CLINICS_GUARDRAIL, CLINICS_LEASE_TERM_LABELS, CLINICS_NO_INVENTED_FIGURES, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for the owner, succession, the closing date and the lease. */
const MAX_PAGES = 5_000;
/** Referral sources the view lists, largest first; the rest are counted. */
const SOURCES_SHOWN = 25;
/** Service lines the view lists, highest margin first; a clinic has a handful. */
const LINES_SHOWN = 25;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const rate = (value: Decimal | null | undefined) => (value ? value.toFixed(6) : null);

/**
 * Small clinics (T-161, ADR 0052): the Clinic page — what concentrates in a clinic of a few sites. The
 * selling owner (named by pseudonymous reference in a document) and their share of visits and
 * collections; each service line's margin and providers, and the lines only the owner delivers;
 * whether the documents describe succession or associate coverage; visits by referral source; and the
 * clinic lease — the term left after the expected closing, renewal and assignment on a sale. The
 * healthcare evidence (collections, credentials, payer contracts, the P&L trend) is the Practice page,
 * reused as it is. Read-only and deterministic: the checks are the pack's rules, run into Findings.
 * The buyer's own side only. Documents, dates and arithmetic: never clinical or legal judgment.
 */
@Injectable()
export class ClinicsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async requireClinics(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'SMALL_CLINICS') throw new UnprocessableEntityException({ code: 'NOT_A_CLINICS_PACT', message: 'This pact is not a small clinics pact' });
    return deal;
  }

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'clinics.practice.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await this.requireClinics(tx, dealId);
      let evidence;
      try {
        evidence = await loadPackEvidence(tx, dealId, [SERVICE_LINE_MONTH, REFERRAL_MONTH, CLINICIAN_MONTH, 'healthcare.remittance_month']);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError) throw new PayloadTooLargeException('Too much evidence for one clinic view');
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

      const asOf = clinicsAnalysisDate(evidence);
      const owner = sellingOwner(pages);
      const share = owner ? ownerShare(evidence, owner.providerRef) : null;
      const succession = successionEvidence(pages);
      const window = serviceLineWindow(serviceLineMonths(evidence));
      const sole = window && owner ? new Set(ownerOnlyLines(window, owner.providerRef).map((line) => line.serviceLine)) : new Set<string>();
      const referrals = referralWindow(referralMonths(evidence));
      const premises = premisesStatuses(pages, asOf);
      const closing = premises[0]?.from ?? null;

      return {
        guardrail: CLINICS_GUARDRAIL,
        noInventedFigures: CLINICS_NO_INVENTED_FIGURES,
        version: CLINICS_PRACTICE_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        analysisDate: asOf,
        owner: {
          threshold: OWNER_SHARE_THRESHOLD,
          providerRef: owner?.providerRef ?? null,
          source: source(owner?.quote),
          share: share
            ? {
                source: share.source,
                from: share.from,
                to: share.to,
                collected: cash(share.collected),
                collectionShare: rate(share.collectionShare),
                visits: share.visits ? share.visits.toFixed(0) : null,
                visitShare: rate(share.visitShare),
              }
            : null,
          succession: succession ? { inPlace: succession.inPlace, source: source(succession.quote) } : null,
        },
        serviceLines: window
          ? {
              from: window.from,
              to: window.to,
              missing: window.missing,
              collected: cash(window.collected),
              count: window.lines.length,
              // bounded: a clinic's service lines, at most LINES_SHOWN
              lines: window.lines.slice(0, LINES_SHOWN).map((line) => ({
                serviceLine: line.serviceLine,
                collected: cash(line.collected),
                share: rate(line.share),
                directCost: cash(line.directCost),
                margin: rate(line.margin),
                visits: line.visits.toFixed(0),
                ownerOnly: sole.has(line.serviceLine),
                // bounded: the providers who collected on the line in the window
                providers: line.providers.map((provider) => ({ providerRef: provider.providerRef, share: rate(provider.share) })),
              })),
            }
          : null,
        referrals: referrals
          ? {
              threshold: REFERRAL_CONCENTRATION_THRESHOLD,
              from: referrals.from,
              to: referrals.to,
              missing: referrals.missing,
              visits: referrals.visits.toFixed(0),
              count: referrals.sources.length,
              // bounded: the largest SOURCES_SHOWN by visits; the rest are counted
              sources: referrals.sources.slice(0, SOURCES_SHOWN).map((entry) => ({ source: entry.source, sourceType: entry.sourceType, visits: entry.visits.toFixed(0), share: rate(entry.share), selfReferral: isSelfReferral(entry) })),
            }
          : null,
        premises: {
          shortTermMonths: PREMISES_SHORT_TERM_MONTHS,
          terms: CLINICS_LEASE_TERM_LABELS,
          measuredFrom: closing ? { date: closing.date, basis: closing.basis, source: source(closing.quote) } : null,
          // bounded: one entry per lease document in the pact
          leases: premises.map((status) => ({
            documentId: status.lease.documentId,
            documentName: names.get(status.lease.documentId) ?? null,
            heading: source(status.lease.heading),
            expiresOn: status.lease.expiresOn,
            expiry: source(status.lease.expiry),
            monthsRemaining: status.monthsRemaining,
            short: status.short,
            renewal: status.lease.renewal,
            renewalSource: source(status.lease.renewalQuote),
            assignment: status.lease.assignment,
            assignmentSource: source(status.lease.assignmentQuote),
          })),
        },
      };
    });
  }
}
