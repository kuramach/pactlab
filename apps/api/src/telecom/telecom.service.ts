import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  AGREEMENT,
  arpuFlat,
  CAPEX_YEAR,
  checkClaims,
  COUNTERPARTY_SHARE,
  INVOICE_LINE,
  MATERIAL_AGREEMENT_SHARE,
  MOVEMENT,
  movementMonths,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  REVENUE_MONTH,
  RIGHTS_WINDOW_MONTHS,
  rightsWindow,
  squeezeYears,
  streamWindows,
  subscriberYears,
  TELECOM_CONVENTIONS,
  TELECOM_KEY_EXPENSES,
  TELECOM_SUBSCRIBERS_VERSION,
  trailingSubscribers,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient } from '@pactlab/db';
import {
  permissionsForDealRole,
  PNL_LINE_EVIDENCE_TYPE,
  TELECOM_AGREEMENT_FLOW_LABELS,
  TELECOM_AGREEMENT_KIND_LABELS,
  TELECOM_AGREEMENT_STATE_LABELS,
  TELECOM_CLAIM_LABELS,
  TELECOM_GUARDRAIL,
  TELECOM_NO_INVENTED_FIGURES,
  TELECOM_REVENUE_STREAM_LABELS,
  type DealRole,
  type TelecomAgreementFlow,
  type TelecomAgreementKind,
  type TelecomRevenueStream,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for the deck's claims, the closing date and the agreements. */
const MAX_PAGES = 5_000;
/** Counterparties and agreements the view lists, largest first; the rest are counted. */
const ROWS_SHOWN = 25;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const ratio = (value: Decimal | null | undefined) => (value ? value.toFixed(4) : null);

/**
 * Telecom and media (T-168, ADR 0056): the Subscribers page. Subscribers, churn and ARPU from the movements
 * export, by year and against the deck's claims; the rights and carriage register against the expected
 * closing, the agreements' own end dates governing; advertising and affiliate revenue by counterparty;
 * content cost per subscriber and capex intensity against ARPU; and the P&L across every imported year.
 * Read-only and deterministic: the checks themselves are the pack's rules, run from Findings (or this page)
 * into the one findings register. The buyer's own side only. Documents, dates and arithmetic; never a
 * content or market judgment.
 */
@Injectable()
export class TelecomService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'telecom.subscribers.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
      if (!deal) throw new NotFoundException();
      if (deal.parties[0]?.companyType !== 'TELECOM_MEDIA') throw new UnprocessableEntityException({ code: 'NOT_A_TELECOM_PACT', message: 'This pact is not a telecom and media pact' });
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [MOVEMENT, AGREEMENT, REVENUE_MONTH, CAPEX_YEAR, INVOICE_LINE, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one telecom view');
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
      const source = (quote: PackRuleQuote | null) => (quote ? { documentId: quote.documentId, documentName: names.get(quote.documentId) ?? null, pageNumber: quote.pageNumber, quote: quote.quote } : null);

      const months = movementMonths(evidence);
      const trailing = trailingSubscribers(months);
      const rights = rightsWindow(evidence, pages);
      const streams = streamWindows(evidence);
      const squeeze = squeezeYears(evidence);
      const trend = pnlTrend(imported.periods, TELECOM_KEY_EXPENSES);

      return {
        guardrail: TELECOM_GUARDRAIL,
        noInventedFigures: TELECOM_NO_INVENTED_FIGURES,
        version: TELECOM_SUBSCRIBERS_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        conventions: TELECOM_CONVENTIONS,
        documentsRead: pages.length > 0,
        subscribers: {
          latestMonth: months.at(-1)?.month ?? null,
          movementRows: months.reduce((total, month) => total + month.rows.length, 0),
          trailing: trailing
            ? {
                from: trailing.from,
                to: trailing.to,
                missing: trailing.missing,
                opening: trailing.opening.toFixed(0),
                adds: trailing.adds.toFixed(0),
                disconnects: trailing.disconnects.toFixed(0),
                closing: trailing.closing.toFixed(0),
                netAdditions: trailing.adds.minus(trailing.disconnects).toFixed(0),
                revenue: cash(trailing.revenue),
                churn: ratio(trailing.churn),
                arpu: cash(trailing.arpu),
              }
            : null,
          // bounded: one row per complete calendar year in the export
          years: subscriberYears(months).map((year) => ({ year: year.year, closing: year.closing.toFixed(0), churn: ratio(year.churn), arpu: cash(year.arpu), revenue: cash(year.revenue) })),
        },
        // bounded: three claims at most (subscribers, churn, ARPU)
        claims: checkClaims(evidence, pages).map((check) => ({
          key: check.claim.key,
          label: TELECOM_CLAIM_LABELS[check.claim.key],
          status: check.status,
          stated: check.claim.key === 'SUBSCRIBERS' ? check.claim.value.toFixed(0) : check.claim.key === 'CHURN' ? check.claim.value.toFixed(4) : check.claim.value.toFixed(2),
          annual: check.claim.annual,
          measured: check.measured ? (check.claim.key === 'SUBSCRIBERS' ? check.measured.toFixed(0) : check.claim.key === 'CHURN' ? check.measured.toFixed(4) : check.measured.toFixed(2)) : null,
          source: source(check.claim.quote),
        })),
        rights: {
          windowMonths: RIGHTS_WINDOW_MONTHS,
          materialShare: MATERIAL_AGREEMENT_SHARE,
          from: rights.from ? { date: rights.from.date, basis: rights.from.basis, source: source(rights.from.quote) } : null,
          windowEnd: rights.windowEnd,
          revenue: rights.revenue ? { from: rights.revenue.from, to: rights.revenue.to, total: cash(rights.revenue.total) } : null,
          agreements: rights.agreements.slice(0, ROWS_SHOWN).map((status) => ({
            agreementId: status.agreement.agreementId,
            counterparty: status.agreement.counterparty,
            kind: TELECOM_AGREEMENT_KIND_LABELS[status.agreement.kind as TelecomAgreementKind] ?? status.agreement.kind,
            flow: TELECOM_AGREEMENT_FLOW_LABELS[status.agreement.flow as TelecomAgreementFlow] ?? status.agreement.flow,
            annualValue: cash(status.agreement.annualValue),
            share: ratio(status.share),
            material: status.material,
            endsOn: status.endsOn,
            registerEndsOn: status.agreement.endsOn,
            endBasis: status.endBasis,
            state: status.state,
            stateLabel: TELECOM_AGREEMENT_STATE_LABELS[status.state],
            monthsAfter: status.monthsAfter,
            renews: status.renews,
            source: source(status.endQuote),
            renewalSource: source(status.renewalQuote),
          })),
          agreementsTotal: rights.agreements.length,
        },
        concentration: {
          threshold: COUNTERPARTY_SHARE,
          // bounded: one entry per revenue stream (advertising, affiliate)
          streams: streams.map((stream) => ({
            stream: stream.stream,
            label: TELECOM_REVENUE_STREAM_LABELS[stream.stream as TelecomRevenueStream] ?? stream.stream,
            from: stream.from,
            to: stream.to,
            missing: stream.missing,
            total: cash(stream.total),
            counterparties: stream.counterparties.slice(0, ROWS_SHOWN).map((entry) => ({ counterparty: entry.counterparty, amount: cash(entry.amount), share: ratio(entry.share), rows: entry.rows.length })),
            counterpartiesTotal: stream.counterparties.length,
          })),
        },
        squeeze: {
          arpuFlat: arpuFlat(squeeze),
          // bounded: one row per year read in both the export and the P&L
          years: squeeze.map((year) => ({
            year: year.year,
            arpu: cash(year.arpu),
            contentPerSubscriber: cash(year.contentPerSubscriber),
            content: cash(year.content),
            pnlRevenue: cash(year.pnlRevenue),
            capex: cash(year.capex),
            capexIntensity: ratio(year.capexIntensity),
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
