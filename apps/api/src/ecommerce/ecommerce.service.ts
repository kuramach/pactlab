import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  accountOwnership,
  AD_SPEND_MONTH,
  AGED_STOCK_DAYS,
  CHANNEL_MONTH,
  CHANNEL_RECONCILIATION_TOLERANCE,
  channelModel,
  channelMonths,
  channelReconciliation,
  channelWindow,
  channelYears,
  COHORT_MONTH,
  cohortValue,
  ECOMMERCE_CHANNELS_VERSION,
  ECOMMERCE_CONVENTIONS,
  ECOMMERCE_KEY_EXPENSES,
  ECOMMERCE_UNIT_ECONOMICS_CLAIMS,
  inventoryAgeing,
  MATERIAL_ACCOUNT_SHARE,
  paidAcquisition,
  PNL_TREND_CONVENTIONS,
  pnlTrend,
  STOCK_LOT,
  stockLots,
  unitEconomicsByYear,
  type D,
  type PackRuleQuote,
} from '@pactlab/calculations';
import { withTenant, type PrismaClient } from '@pactlab/db';
import {
  ECOMMERCE_ACCOUNT_OWNER_LABELS,
  ECOMMERCE_GUARDRAIL,
  ECOMMERCE_NO_INVENTED_FIGURES,
  ECOMMERCE_PLATFORM_KIND_LABELS,
  PNL_LINE_EVIDENCE_TYPE,
  permissionsForDealRole,
  type DealRole,
  type EcommercePlatformKind,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { RULE_READABLE_CLASSES } from '../findings/pack-rules';
import { loadPackEvidence, TooMuchPackEvidenceError } from '../packs/pack-evidence';
import { filesOf, loadImportedPnl, TooManyPnlLinesError } from '../qoe/pnl-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Pages the checks read for claims and account ownership. */
const MAX_PAGES = 5_000;
/** Aged stock lots the view lists, oldest first; the rest are counted. */
const AGED_LOTS_SHOWN = 25;

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal | null | undefined) => (value ? value.toFixed(2) : null);
const ratio = (value: Decimal | null | undefined) => (value ? value.toFixed(4) : null);
const platformLabel = (platform: string | null) => (platform ? (ECOMMERCE_PLATFORM_KIND_LABELS[platform as EcommercePlatformKind] ?? platform) : null);

/**
 * E-commerce and DTC (T-164, ADR 0054): the Channels page. Net sales by channel and platform account
 * recomputed from the storefront and marketplace exports and reconciled to the P&L by year; cohort value
 * on a contribution basis and paid acquisition cost against the deck's claims; who each account is
 * registered to, as the documents state it; the return rate, contribution and acquisition cost by year;
 * the stock report aged; and the P&L across every imported year. Read-only and deterministic: the checks
 * themselves are the pack's rules, run from Findings (or this page) into the one findings register. The
 * buyer's own side only. Exports and documents only: nothing is scraped from a platform.
 */
@Injectable()
export class EcommerceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  async view(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'ecommerce.channels.read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { baseCurrency: true, parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
      if (!deal) throw new NotFoundException();
      if (deal.parties[0]?.companyType !== 'ECOMMERCE_DTC') throw new UnprocessableEntityException({ code: 'NOT_AN_ECOMMERCE_PACT', message: 'This pact is not an e-commerce and DTC pact' });
      let evidence;
      let imported;
      try {
        evidence = await loadPackEvidence(tx, dealId, [CHANNEL_MONTH, COHORT_MONTH, AD_SPEND_MONTH, STOCK_LOT, PNL_LINE_EVIDENCE_TYPE]);
        imported = await loadImportedPnl(tx, dealId);
      } catch (error) {
        if (error instanceof TooMuchPackEvidenceError || error instanceof TooManyPnlLinesError) throw new PayloadTooLargeException('Too much evidence for one e-commerce view');
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

      const rows = channelMonths(evidence);
      const model = channelModel(rows);
      const value = cohortValue(evidence);
      const paid = paidAcquisition(evidence);
      const ownership = accountOwnership(evidence, pages);
      const ageing = inventoryAgeing(stockLots(evidence));
      const years = channelYears(rows);
      const unit = unitEconomicsByYear(evidence);
      const trend = pnlTrend(imported.periods, ECOMMERCE_KEY_EXPENSES);
      const claims = ECOMMERCE_UNIT_ECONOMICS_CLAIMS.detect({ evidence, pages }).flatMap((proposal) =>
        proposal.claim ? [{ title: proposal.title, status: proposal.claim.status, statement: proposal.claim.statement, rationale: proposal.claim.rationale, source: proposal.quotes?.[0] ? source(proposal.quotes[0]) : null }] : [],
      );
      const trailing = model.trailing;

      return {
        guardrail: ECOMMERCE_GUARDRAIL,
        noInventedFigures: ECOMMERCE_NO_INVENTED_FIGURES,
        version: ECOMMERCE_CHANNELS_VERSION,
        currency: deal.baseCurrency,
        canRunChecks: canRun(role),
        conventions: ECOMMERCE_CONVENTIONS,
        channels: {
          latestMonth: model.latestMonth,
          orderRows: rows.length,
          trailing: trailing ? { from: trailing.from, to: trailing.to, missing: trailing.missing, net: cash(trailing.net), gross: cash(trailing.gross), orders: trailing.orders.toFixed(0), returnRate: ratio(trailing.returnRate), contributionMargin: ratio(trailing.contributionMargin) } : null,
          // bounded: one row per sales channel, a handful per brand
          byChannel: trailing
            ? model.channels.map((channel) => {
                const window = channelWindow(rows, trailing.to, (row) => row.channel === channel);
                return {
                  channel,
                  platform: window.rows[0]?.platform ?? null,
                  platformLabel: platformLabel(window.rows[0]?.platform ?? null),
                  net: cash(window.net),
                  share: trailing.net.gt(0) ? ratio(window.net.div(trailing.net)) : null,
                  contributionMargin: ratio(window.contributionMargin),
                  returnRate: ratio(window.returnRate),
                };
              })
            : [],
        },
        // bounded: one row per platform account, a handful per brand
        accounts: ownership.accounts.map((entry) => ({
          account: entry.account,
          channel: entry.channel,
          platformLabel: platformLabel(entry.platform),
          net: cash(entry.net),
          share: ratio(entry.share),
          material: entry.share ? entry.share.gte(MATERIAL_ACCOUNT_SHARE) : false,
          owner: entry.owner,
          ownerLabel: ECOMMERCE_ACCOUNT_OWNER_LABELS[entry.owner],
          source: entry.record ? source(entry.record.quote) : null,
        })),
        materialShare: MATERIAL_ACCOUNT_SHARE,
        unitEconomics: {
          cohortValue: value
            ? {
                horizon: value.repeat.horizon,
                cohorts: value.repeat.cohorts,
                ordersPerCustomer: value.repeat.ordersPerCustomer.toFixed(4),
                from: value.window.from,
                to: value.window.to,
                netOrderValue: cash(value.netOrderValue),
                grossOrderValue: cash(value.grossOrderValue),
                contributionMargin: ratio(value.contributionMargin),
                ltvContribution: cash(value.ltvContribution),
                ltvGross: cash(value.ltvGross),
              }
            : null,
          paid: paid ? { from: paid.from, to: paid.to, missing: paid.missing, spend: cash(paid.spend), newCustomers: paid.newCustomers.toFixed(0), cac: cash(paid.cac) } : null,
          ltvToCac: value && paid?.cac && paid.missing.length === 0 ? value.ltvContribution.div(paid.cac).toFixed(2) : null,
        },
        claims,
        years: years.map((year) => {
          const economics = unit.find((entry) => entry.year === year.year);
          return {
            year: year.year,
            net: cash(year.net),
            returnRate: ratio(year.returnRate),
            contributionMargin: ratio(year.consumer.contributionMargin),
            newCustomers: year.consumer.newCustomers.toFixed(0),
            marketing: cash(economics?.marketing),
            cac: cash(economics?.cac),
          };
        }),
        reconciliation: {
          tolerance: CHANNEL_RECONCILIATION_TOLERANCE,
          years: channelReconciliation(evidence).map((year) => ({
            year: year.year,
            exportsNet: cash(year.exports),
            pnlRevenue: cash(year.pnl),
            difference: year.difference.toFixed(2),
            relative: year.relative ? year.relative.toFixed(4) : null,
            accounts: year.accounts,
            reconciles: year.relative ? year.relative.abs().lte(CHANNEL_RECONCILIATION_TOLERANCE) : null,
          })),
        },
        inventory: ageing
          ? {
              asOf: ageing.asOf,
              lots: ageing.lots.length,
              value: cash(ageing.value),
              agedValue: cash(ageing.agedValue),
              agedShare: ratio(ageing.agedShare),
              agedDays: AGED_STOCK_DAYS,
              bands: ageing.bands.map((band) => ({ key: band.key, label: band.label, value: cash(band.value) ?? '0.00', lots: band.lots })),
              agedLots: ageing.aged.slice(0, AGED_LOTS_SHOWN).map((lot) => ({ evidenceId: lot.id, sku: lot.sku, location: lot.location, units: lot.units.toFixed(0), value: cash(lot.value), receivedOn: lot.receivedOn, ageDays: lot.ageDays })),
              agedLotsTotal: ageing.aged.length,
            }
          : null,
        agedLotsShown: AGED_LOTS_SHOWN,
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
