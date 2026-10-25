import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { billedMrr, capTableOf, D, liquidationPreference, roundScenario, RoundModelError, type RoundScenario } from '@pactlab/calculations';
import type { CreateOfferInput, OfferView, UpdateOfferInput, VentureSettingsInput, VentureSettingsView } from '@pactlab/contracts';
import { appendAuditEvent, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  IMPORT_TARGET_DEFINITIONS,
  permissionsForDealRole,
  readinessOf,
  strictestCounterparty,
  type CounterpartyType,
  type DealRole,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { loadPackEvidence } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const canWrite = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && role !== 'TARGET_CONTRIBUTOR';
const CAP_TABLE = 'venture.cap_table_row';
const ACTIVE: readonly string[] = ['PROSPECT', 'TERM_SHEET', 'SIGNED'];
const text = (value: { toString(): string } | null) => (value === null ? null : value.toString());
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

type OfferRow = Awaited<ReturnType<PrismaClient['ventureOffer']['findMany']>>[number];
const offerView = (row: OfferRow): OfferView => ({
  id: row.id,
  investorName: row.investorName,
  counterpartyType: row.counterpartyType as CounterpartyType,
  status: row.status as OfferView['status'],
  preMoney: text(row.preMoney),
  amount: text(row.amount),
  poolTargetPct: text(row.poolTargetPct),
  liquidationMultiple: row.liquidationMultiple.toString(),
  participating: row.participating,
  investorBoardSeats: row.investorBoardSeats,
  proRata: row.proRata,
  mfn: row.mfn,
  receivedOn: day(row.receivedOn),
  version: row.version,
});

/**
 * Venture Raise (T-083), founder-side: the round being raised, the investors'
 * competing offers, the round model for each, the readiness checklist for the
 * investor type, and the one outward surface — an investor view that holds
 * verified facts only. Founder side only (RLS: buyer side of the deal).
 */
@Injectable()
export class VentureService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string, action: string, targetType: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType, targetId, outcome: 'SUCCEEDED', requestId });
  }

  private async requireVenturePact(tx: TransactionClient, dealId: string) {
    const seller = await tx.dealParty.findFirst({ where: { dealId, role: 'SELLER' }, select: { companyType: true, name: true } });
    if (seller?.companyType !== 'VENTURE_RAISE') throw new UnprocessableEntityException({ code: 'NOT_A_VENTURE_RAISE' });
    return seller;
  }

  // --- The round ---------------------------------------------------------------

  async settings(tenant: TenantContext, dealId: string, requestId: string): Promise<{ settings: VentureSettingsView | null; canEdit: boolean }> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'venture.settings_viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const row = await tx.ventureRaiseSettings.findFirst({ where: { dealId } });
      return {
        settings: row
          ? { roundType: row.roundType as VentureSettingsView['roundType'], currency: row.currency, targetPreMoney: row.targetPreMoney.toString(), raiseAmount: row.raiseAmount.toString(), poolTargetPct: row.poolTargetPct.toString(), sector: row.sector, version: row.version }
          : null,
        canEdit: canWrite(role),
      };
    });
  }

  async saveSettings(tenant: TenantContext, dealId: string, input: VentureSettingsInput, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'venture.settings_updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const existing = await tx.ventureRaiseSettings.findFirst({ where: { dealId } });
      if ((existing?.version ?? null) !== input.expectedVersion) throw new ConflictException();
      const data = { roundType: input.roundType, currency: input.currency, targetPreMoney: input.targetPreMoney, raiseAmount: input.raiseAmount, poolTargetPct: input.poolTargetPct, sector: input.sector, updatedBy: tenant.userId, updatedAt: new Date() };
      const row = existing
        ? await tx.ventureRaiseSettings.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.ventureRaiseSettings.create({ data: { ...data, organizationId: tenant.organizationId, dealId } });
      await this.audit(tx, tenant, dealId, 'venture.settings_updated', 'venture_raise_settings', row.id, requestId);
    });
    return this.settings(tenant, dealId, requestId);
  }

  // --- Competing offers ---------------------------------------------------------

  async offers(tenant: TenantContext, dealId: string, requestId: string): Promise<{ items: OfferView[]; canEdit: boolean }> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'venture.offers_viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const rows = await tx.ventureOffer.findMany({ where: { dealId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return { items: rows.map(offerView), canEdit: canWrite(role) };
    });
  }

  async createOffer(tenant: TenantContext, dealId: string, input: CreateOfferInput, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'venture.offer_created', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const row = await tx.ventureOffer.create({
        data: { ...this.offerData(input), organizationId: tenant.organizationId, dealId, createdBy: tenant.userId, updatedBy: tenant.userId },
      });
      await this.audit(tx, tenant, dealId, 'venture.offer_created', 'venture_offer', row.id, requestId);
    });
    return this.offers(tenant, dealId, requestId);
  }

  async updateOffer(tenant: TenantContext, dealId: string, offerId: string, input: UpdateOfferInput, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'venture.offer_updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const { expectedVersion, ...fields } = input;
      const { count } = await tx.ventureOffer.updateMany({
        where: { id: offerId, dealId, version: expectedVersion },
        data: { ...this.offerData(fields), version: { increment: 1 }, updatedBy: tenant.userId, updatedAt: new Date() },
      });
      if (count === 0) {
        if (!(await tx.ventureOffer.findFirst({ where: { id: offerId, dealId }, select: { id: true } }))) throw new NotFoundException();
        throw new ConflictException();
      }
      await this.audit(tx, tenant, dealId, 'venture.offer_updated', 'venture_offer', offerId, requestId);
    });
    return this.offers(tenant, dealId, requestId);
  }

  private offerData(input: CreateOfferInput) {
    return {
      investorName: input.investorName,
      counterpartyType: input.counterpartyType,
      status: input.status,
      preMoney: input.preMoney,
      amount: input.amount,
      poolTargetPct: input.poolTargetPct,
      liquidationMultiple: input.liquidationMultiple,
      participating: input.participating,
      investorBoardSeats: input.investorBoardSeats,
      proRata: input.proRata,
      mfn: input.mfn,
      receivedOn: input.receivedOn ? new Date(`${input.receivedOn}T00:00:00Z`) : null,
    };
  }

  // --- Readiness ----------------------------------------------------------------

  /** The checklist for the most demanding active offer's investor type, or the one requested. */
  async readiness(tenant: TenantContext, dealId: string, requested: CounterpartyType | undefined, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'venture.readiness_viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const offers = await tx.ventureOffer.findMany({ where: { dealId, status: { in: [...ACTIVE] } }, select: { counterpartyType: true } });
      const counterparty = requested ?? strictestCounterparty(offers.map((offer) => offer.counterpartyType as CounterpartyType));
      return readinessOf(counterparty, await this.held(tx, dealId));
    });
  }

  private async held(tx: TransactionClient, dealId: string) {
    const types = await tx.evidenceItem.findMany({ where: { dealId }, distinct: ['evidenceType'], select: { evidenceType: true } });
    const present = new Set(types.map((row) => row.evidenceType));
    const importTargets = Object.values(IMPORT_TARGET_DEFINITIONS).filter((definition) => present.has(definition.evidenceType)).map((definition) => definition.target);
    const documents = await tx.document.findMany({ where: { dealId, status: 'AVAILABLE' }, select: { fileName: true }, orderBy: { fileName: 'asc' } });
    const connections = await tx.connection.findMany({ where: { dealId, status: 'ACTIVE' }, select: { provider: true } });
    return { importTargets, documentNames: documents.map((document) => document.fileName), connectionProviders: [...new Set(connections.map((connection) => connection.provider))] };
  }

  // --- Round model --------------------------------------------------------------

  private async capTable(tx: TransactionClient, dealId: string) {
    const rows = capTableOf(await loadPackEvidence(tx, dealId, [CAP_TABLE]));
    if (rows.length === 0) throw new UnprocessableEntityException({ code: 'CAP_TABLE_REQUIRED' });
    return rows;
  }

  private scenario(rows: Parameters<typeof roundScenario>[0], round: Parameters<typeof roundScenario>[1]): RoundScenario {
    try {
      return roundScenario(rows, round);
    } catch (error) {
      if (error instanceof RoundModelError) throw new UnprocessableEntityException({ code: 'ROUND_NOT_PRICEABLE' });
      throw error;
    }
  }

  /** The cap table through priced-round scenarios at the given pre-money values (default: the ask, and 20% either side). */
  async roundModel(tenant: TenantContext, dealId: string, preMoneys: readonly string[] | undefined, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'venture.round_model_viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const settings = await tx.ventureRaiseSettings.findFirst({ where: { dealId } });
      if (!settings) throw new UnprocessableEntityException({ code: 'ROUND_SETTINGS_REQUIRED' });
      const rows = await this.capTable(tx, dealId);
      const ask = new D(settings.targetPreMoney.toString());
      const values = preMoneys?.length ? preMoneys.map((value) => new D(value)) : [ask.times('0.8'), ask, ask.times('1.2')];
      return {
        currency: settings.currency,
        scenarios: values.map((preMoney) => this.scenario(rows, { preMoney, amount: new D(settings.raiseAmount.toString()), poolTarget: new D(settings.poolTargetPct.toString()) })),
      };
    });
  }

  /** Every offer with numbers through the same model, side by side. Mechanics only: no ranking, no recommendation. */
  async compare(tenant: TenantContext, dealId: string, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'venture.offers_compared', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireVenturePact(tx, dealId);
      const settings = await tx.ventureRaiseSettings.findFirst({ where: { dealId } });
      const offers = await tx.ventureOffer.findMany({ where: { dealId, status: { not: 'DECLINED' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const rows = offers.some((offer) => offer.preMoney && offer.amount) ? await this.capTable(tx, dealId) : [];
      return {
        currency: settings?.currency ?? null,
        offers: offers.map((offer) => {
          const pool = offer.poolTargetPct ?? settings?.poolTargetPct ?? null;
          const terms = liquidationPreference(new D(offer.liquidationMultiple.toString()), offer.participating);
          return {
            offer: offerView(offer),
            scenario:
              offer.preMoney && offer.amount && pool !== null
                ? this.scenario(rows, { preMoney: new D(offer.preMoney.toString()), amount: new D(offer.amount.toString()), poolTarget: new D(pool.toString()) })
                : null,
            missing: offer.preMoney && offer.amount ? (pool === null ? ['pool target'] : []) : ['pre-money and amount'],
            terms: {
              liquidationPreference: terms.statement,
              standardPreference: terms.standard,
              board: offer.investorBoardSeats === null ? null : `The investor takes ${offer.investorBoardSeats} board seat${offer.investorBoardSeats === 1 ? '' : 's'}.`,
              proRata: offer.proRata ? 'The investor may buy its share of later rounds (pro-rata right).' : null,
              mfn: offer.mfn ? 'The investor takes any better terms given to later investors in this round (most-favoured-nation).' : null,
            },
          };
        }),
        note: 'Mechanics and consequences only. Pactlab does not rank offers or recommend one; that decision is yours with your advisers.',
      };
    });
  }

  // --- The investor view: the one outward surface ------------------------------

  /**
   * What the founder may share with an investor: company and round basics,
   * that investor's own terms, VERIFIED claims, billed revenue, the cap table
   * by holder type and the documents in the data room. Never a finding of any
   * direction, never a contradicted or unverified claim, never another
   * investor's bid, never runway or cash. Every read is audited.
   */
  async investorView(tenant: TenantContext, dealId: string, offerId: string | undefined, requestId: string) {
    await this.access.require(tenant, dealId, canWrite, { action: 'venture.investor_view_read', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      const seller = await this.requireVenturePact(tx, dealId);
      const settings = await tx.ventureRaiseSettings.findFirst({ where: { dealId } });
      const offer = offerId ? await tx.ventureOffer.findFirst({ where: { id: offerId, dealId } }) : null;
      if (offerId && !offer) throw new NotFoundException();
      const claims = await tx.dealClaim.findMany({ where: { dealId, status: 'VERIFIED' }, select: { statement: true, evidenceItemIds: true }, orderBy: { createdAt: 'asc' } });
      const evidence = await loadPackEvidence(tx, dealId, ['billing.invoice_line', CAP_TABLE]);
      const billed = billedMrr(evidence);
      const cap = capTableOf(evidence).filter((row) => row.instrument !== 'safe' && row.instrument !== 'note');
      const total = cap.reduce((sum, row) => sum.plus(row.shares ?? 0), new D(0));
      const byType = new Map<string, InstanceType<typeof D>>();
      for (const row of cap) byType.set(row.holderType, (byType.get(row.holderType) ?? new D(0)).plus(row.shares ?? 0));
      const converting = capTableOf(evidence).filter((row) => row.instrument === 'safe' || row.instrument === 'note');
      // The data room as the checklist sees it: only documents and imports that satisfy a checklist item.
      const counterparty = offer ? (offer.counterpartyType as CounterpartyType) : 'VC';
      const dataRoom = readinessOf(counterparty, await this.held(tx, dealId)).items.filter((item) => item.present).map((item) => ({ item: item.label, evidence: item.evidence }));
      await this.audit(tx, tenant, dealId, 'venture.investor_view_read', offer ? 'venture_offer' : 'deal', offer?.id ?? dealId, requestId);
      return {
        company: seller.name,
        round: settings ? { roundType: settings.roundType, currency: settings.currency, raiseAmount: settings.raiseAmount.toString() } : null,
        offer: offer ? { investorName: offer.investorName, preMoney: text(offer.preMoney), amount: text(offer.amount), liquidationMultiple: offer.liquidationMultiple.toString(), participating: offer.participating } : null,
        verifiedClaims: claims.map((claim) => ({ statement: claim.statement, evidenceCount: claim.evidenceItemIds.length })),
        revenue: billed ? { month: billed.month, currency: billed.currency, mrr: billed.mrr.toFixed(2), arr: billed.mrr.times(12).toFixed(2) } : null,
        capTable: total.gt(0)
          ? {
              sharesOutstanding: total.toFixed(0),
              byHolderType: [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([holderType, shares]) => ({ holderType, shares: shares.toFixed(0), percent: shares.div(total).times(100).toFixed(2) })),
              convertingInstruments: converting.length,
              convertingPrincipal: converting.reduce((sum, row) => sum.plus(row.principal ?? 0), new D(0)).toFixed(2),
            }
          : null,
        dataRoom,
        excludes: 'Findings, unverified or contradicted claims, other investors’ offers, cash and runway are never part of this view.',
      };
    });
  }
}
