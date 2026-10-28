import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  anchorCounterPrice,
  D,
  ANCHORS_VERSION,
  arrGrowthFrom,
  askingImpliedMultiple,
  benchmarkMultiple,
  computeSaasMetrics,
  effectiveBridgeAssumptions,
  evToArrMultiple,
  riskAdjustedEnterpriseValue,
  type MoneyValue,
  type MultipleBenchmark,
} from '@pactlab/calculations';
import type {
  AnchorInput,
  AnchorView,
  AnchorsView,
  BenchmarkFilter,
  BenchmarkQuery,
  BenchmarkView,
  ComparableEntry,
  ComparableView,
  MultipleJudgementInput,
  MultipleJudgementView,
} from '@pactlab/contracts';
import { NotConfiguredComparablesProvider, type ComparablesProvider } from '@pactlab/connectors';
import {
  appendAuditEvent,
  askingPrices,
  comparables,
  dealParties,
  deals,
  multipleJudgements,
  negotiationAnchors,
  withTenant,
  type ComparableRecord,
  type MultipleJudgementRecord,
  type PrismaClient,
  type TransactionClient,
} from '@pactlab/db';
import { isCounterpartyRole, permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { defaultAsOfMonth, loadMetricsEvidence } from '../metrics/metrics.inputs';
import { PRISMA } from '../tokens';
import { ValuationService } from '../valuation/valuation.service';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const isLead = (role: DealRole) => role === 'DEAL_LEAD';
const isOrgAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';

type ScenarioItem = Awaited<ReturnType<ValuationService['list']>>['items'][number];

function toView(record: ComparableRecord): ComparableView {
  return {
    ...record,
    multiple: evToArrMultiple({ amount: record.enterpriseValue, currency: record.currency }, { amount: record.arr, currency: record.currency }) ?? '0.00',
    recordedAt: record.recordedAt.toISOString(),
  };
}

/** The headline scenario: the one asked for, else the approved one, else the first that has run. */
function pickScenario(items: readonly ScenarioItem[], scenarioId: string | undefined): ScenarioItem | null {
  if (scenarioId) {
    const found = items.find((item) => item.scenario.id === scenarioId);
    if (!found) throw new NotFoundException();
    return found;
  }
  return (
    items.find((item) => item.scenario.status === 'APPROVED' && item.latestRun) ??
    items.find((item) => item.latestRun) ??
    items[0] ??
    null
  );
}

function withinYears(announcedOn: string | null, years: number, today: Date): boolean {
  if (years === 0 || announcedOn === null) return true;
  const since = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()));
  return announcedOn >= since.toISOString().slice(0, 10);
}

/** "1350000.0000" → "USD 1,350,000". Grouping on the decimal string; no floating point. */
export function formatAmount(amount: string, currency: string): string {
  const [whole = '0'] = amount.replace('-', '').split('.');
  return `${amount.startsWith('-') ? '-' : ''}${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** "-0.3250" → "32.5%" (magnitude only). */
export function formatRatio(ratio: string): string {
  const [whole = '0', fraction = ''] = ratio.replace('-', '').split('.');
  const digits = `${whole}${fraction.padEnd(4, '0')}`.replace(/^0+(?=\d)/, '').padStart(5, '0');
  const integer = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  const rest = digits.slice(-2).replace(/0+$/, '');
  return `${integer}${rest ? `.${rest}` : ''}%`;
}

/**
 * The anchor as a sentence the deal lead can adapt: who bought whom, at what
 * multiple, the source, and what that multiple means for this target against
 * the ask. Built only from stored figures; Pactlab never sends it anywhere.
 */
export function talkingPoint(input: {
  comparable: ComparableRecord;
  multiple: string;
  targetName: string;
  arr: MoneyValue;
  counterPrice: MoneyValue;
  gapRatio: string;
  verdict: 'BELOW' | 'AT' | 'ABOVE';
  asking: MoneyValue;
}): string {
  const c = input.comparable;
  const who = c.kind === 'PUBLIC_PEER' ? `${c.targetName} trades at` : `${c.acquirerName ?? 'An acquirer'} bought ${c.targetName} for ${formatAmount(c.enterpriseValue, c.currency)} —`;
  const basis = c.arrBasis === 'REVENUE' ? 'revenue' : 'ARR';
  const when = c.announcedOn ? `${c.announcedOn}; ` : '';
  const source = [c.sourceCitation, c.sourceUrl].filter(Boolean).join(' ');
  const direction = input.verdict === 'BELOW' ? `${formatRatio(input.gapRatio)} below` : input.verdict === 'ABOVE' ? `${formatRatio(input.gapRatio)} above` : 'equal to';
  const text = `${who} ${input.multiple}× ${basis} (${when}source: ${source || 'not recorded'}). At ${input.multiple}×, ${input.targetName}'s ${formatAmount(input.arr.amount, input.arr.currency)} ARR implies ${formatAmount(input.counterPrice.amount, input.counterPrice.currency)}, ${direction} the ${formatAmount(input.asking.amount, input.asking.currency)} ask.`;
  return c.origin === 'SYNTHETIC' ? `DEMO DATA — do not cite. ${text}` : text;
}

interface TargetFacts {
  arr: MoneyValue | null;
  arrGrowth: string | null;
  nrr: string | null;
  grr: string | null;
  asOfMonth: string | null;
}

/**
 * Comparables and the multiple benchmark. Comparables are the buying firm's
 * market knowledge — entered with a cited source, recorded from its own
 * approved deals, from a licensed provider (later), or synthetic for demos —
 * and each one says which. The benchmark is deterministic description; the
 * deal lead's judgement of the asking price is a separate, audited human act.
 */
@Injectable()
export class ComparablesService {
  private readonly provider: ComparablesProvider = new NotConfiguredComparablesProvider();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(ValuationService) private readonly valuation: ValuationService,
  ) {}

  private async denied(tenant: TenantContext, action: string, requestId: string): Promise<never> {
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId: null,
        actorUserId: tenant.userId,
        action,
        targetType: 'comparable',
        targetId: tenant.organizationId,
        outcome: 'DENIED',
        requestId,
      }),
    );
    throw new ForbiddenException();
  }

  /** Buy-side roles on any deal, or organization admins. Target contributors are not. */
  private async buyerRoles(tenant: TenantContext): Promise<DealRole[]> {
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.dealMembership.findMany({ where: { userId: tenant.userId, status: 'ACTIVE' }, select: { role: true } }),
    );
    return rows.map((row) => row.role).filter((role) => !isCounterpartyRole(role));
  }

  private async requireReader(tenant: TenantContext, action: string, requestId: string) {
    if (isOrgAdmin(tenant) || (await this.buyerRoles(tenant)).length > 0) return;
    await this.denied(tenant, action, requestId);
  }

  /** Organization admins and deal leads maintain the firm's comparables. */
  private async requireWriter(tenant: TenantContext, action: string, requestId: string) {
    if (isOrgAdmin(tenant) || (await this.buyerRoles(tenant)).includes('DEAL_LEAD')) return;
    await this.denied(tenant, action, requestId);
  }

  async list(tenant: TenantContext, requestId: string): Promise<{ items: ComparableView[]; canWrite: boolean; provider: 'NOT_CONFIGURED' | 'CONFIGURED' }> {
    await this.requireReader(tenant, 'comparables.list', requestId);
    const items = await withTenant(this.prisma, tenant, (tx) => comparables.list(tx));
    const canWrite = isOrgAdmin(tenant) || (await this.buyerRoles(tenant)).includes('DEAL_LEAD');
    const provider = (await this.provider.search({ companyType: 'SOFTWARE_SAAS', since: null, limit: 0 })).status === 'OK' ? 'CONFIGURED' : 'NOT_CONFIGURED';
    return { items: items.map(toView), canWrite, provider };
  }

  async create(tenant: TenantContext, input: ComparableEntry, requestId: string): Promise<ComparableView> {
    await this.requireWriter(tenant, 'comparable.recorded', requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      const record = await comparables.record(tx, {
        ...input,
        origin: 'ENTERED',
        provider: null,
        providerVersion: null,
        sourceDealId: null,
        organizationId: tenant.organizationId,
        recordedBy: tenant.userId,
      });
      await this.audit(tx, tenant, null, 'comparable.recorded', record.id, requestId);
      return toView(record);
    });
  }

  async retire(tenant: TenantContext, comparableId: string, requestId: string): Promise<ComparableView> {
    await this.requireWriter(tenant, 'comparable.retired', requestId);
    return withTenant(this.prisma, tenant, async (tx) => {
      const existing = await comparables.get(tx, comparableId);
      if (!existing) throw new NotFoundException();
      if (!(await comparables.retire(tx, comparableId, tenant.userId))) throw new ConflictException('Already retired');
      await this.audit(tx, tenant, null, 'comparable.retired', comparableId, requestId);
      return toView((await comparables.get(tx, comparableId)) as ComparableRecord);
    });
  }

  /**
   * The deal lead adds this deal to the firm's precedents: the approved
   * scenario's risk-adjusted enterprise value over its ARR, plus the
   * measured drivers. Numbers only — no documents or source data.
   */
  async addFromDeal(tenant: TenantContext, dealId: string, requestId: string): Promise<ComparableView> {
    await this.access.require(tenant, dealId, isLead, { action: 'comparable.from_deal', requestId });
    const { items } = await this.valuation.list(tenant, dealId, requestId);
    const approved = items.find((item) => item.scenario.status === 'APPROVED' && item.latestRun);
    if (!approved?.latestRun) throw new UnprocessableEntityException('Approve a valuation scenario first');
    const run = approved.latestRun;
    const facts = await this.targetFacts(tenant, dealId);
    const arr = run.inputs.assumptions.method === 'ARR_MULTIPLE' ? { amount: run.inputs.assumptions.arr, currency: run.result.currency } : facts.arr;
    if (!arr || arr.currency !== run.result.currency) throw new UnprocessableEntityException('ARR is not available in the valuation currency');
    const ev = riskAdjustedEnterpriseValue(run.result);
    return withTenant(this.prisma, tenant, async (tx) => {
      if (await comparables.forDeal(tx, dealId)) throw new ConflictException('This deal is already a precedent');
      const deal = await deals.get(tx, dealId);
      const parties = await dealParties.list(tx, dealId);
      const seller = parties.find((party) => party.role === 'SELLER');
      const buyer = parties.find((party) => party.role === 'BUYER');
      const decidedAt = approved.decisions.find((decision) => decision.decision === 'APPROVED')?.decidedAt ?? run.ranAt;
      const record = await comparables.record(tx, {
        kind: 'OWN_DEAL',
        origin: 'OWN_DEAL',
        name: `${deal?.name ?? 'Deal'} (own deal)`,
        targetName: seller?.name ?? deal?.targetName ?? 'Target',
        acquirerName: buyer?.name ?? null,
        announcedOn: decidedAt.slice(0, 10),
        companyType: seller?.companyType ?? 'OTHER',
        region: null,
        enterpriseValue: ev.amount,
        arr: arr.amount,
        currency: ev.currency,
        arrGrowth: facts.arrGrowth,
        nrr: facts.nrr,
        grr: facts.grr,
        sourceCitation: `Approved Sextant scenario "${approved.scenario.name}" (risk-adjusted enterprise value)`,
        sourceUrl: null,
        provider: null,
        providerVersion: null,
        sourceDealId: dealId,
        organizationId: tenant.organizationId,
        recordedBy: tenant.userId,
      });
      await this.audit(tx, tenant, dealId, 'comparable.from_deal', record.id, requestId);
      return toView(record);
    });
  }

  /** ARR, growth and retention measured from the deal's billing evidence. */
  private async targetFacts(tenant: TenantContext, dealId: string): Promise<TargetFacts> {
    const none: TargetFacts = { arr: null, arrGrowth: null, nrr: null, grr: null, asOfMonth: null };
    return withTenant(this.prisma, tenant, async (tx) => {
      const evidence = await loadMetricsEvidence(tx, dealId).catch(() => null);
      if (!evidence || evidence.lines.length === 0) return none;
      const asOfMonth = defaultAsOfMonth(evidence);
      const report = computeSaasMetrics({ lines: evidence.lines, fxRates: evidence.fxRates, baseCurrency: evidence.baseCurrency, asOfMonth });
      const value = (key: string) => report.metrics.find((metric) => metric.key === key)?.value ?? null;
      const arr = value('ARR');
      return {
        arr: arr ? { amount: arr, currency: report.baseCurrency } : null,
        arrGrowth: arrGrowthFrom(report.series, asOfMonth),
        nrr: value('NRR'),
        grr: value('GRR'),
        asOfMonth,
      };
    });
  }

  private async compute(tenant: TenantContext, dealId: string, query: BenchmarkQuery, requestId: string) {
    const { items } = await this.valuation.list(tenant, dealId, requestId);
    const item = pickScenario(items, query.scenarioId);
    const facts = await this.targetFacts(tenant, dealId);
    const { seller, asking, pool } = await withTenant(this.prisma, tenant, async (tx: TransactionClient) => ({
      seller: (await dealParties.list(tx, dealId)).find((party) => party.role === 'SELLER') ?? null,
      asking: (await askingPrices.currentFor(tx, [dealId])).get(dealId) ?? null,
      pool: await comparables.list(tx),
    }));
    const filter: BenchmarkView['filter'] = {
      companyType: query.companyType ?? seller?.companyType ?? 'ALL',
      years: query.years,
      synthetic: query.synthetic,
    };
    const today = new Date();
    const selected = pool.filter(
      (c) =>
        c.sourceDealId !== dealId &&
        (filter.companyType === 'ALL' || c.companyType === filter.companyType) &&
        (filter.synthetic === 'include' || c.origin !== 'SYNTHETIC') &&
        withinYears(c.announcedOn, filter.years, today),
    );

    const run = item?.latestRun ?? null;
    const assumptions = run?.inputs.assumptions ?? item?.assumptions.values.assumptions ?? null;
    const currency = item?.scenario.currency ?? null;
    let arr: MoneyValue | null = null;
    let arrSource: BenchmarkView['target']['arrSource'] = null;
    if (assumptions?.method === 'ARR_MULTIPLE' && currency) {
      arr = { amount: assumptions.arr, currency };
      arrSource = 'SCENARIO';
    } else if (facts.arr) {
      arr = facts.arr;
      arrSource = 'METRICS';
    }
    const chosenMultiple =
      assumptions?.method === 'ARR_MULTIPLE' ? assumptions.multiple : run && arr ? evToArrMultiple(run.result.enterpriseValue, arr) : null;
    const askingMultiple =
      asking && arr
        ? askingImpliedMultiple({ asking, arr, bridge: run ? effectiveBridgeAssumptions(run.inputs) : (item?.assumptions.values.bridge ?? null) })
        : null;

    const benchmark: MultipleBenchmark = benchmarkMultiple({
      comparables: selected.map((c) => ({ ...c })),
      target: { arrGrowth: facts.arrGrowth, nrr: facts.nrr, grr: facts.grr },
      chosenMultiple,
      askingImpliedMultiple: askingMultiple,
    });
    // The run's bridge including its evidence-backed items; a draft that has not run uses the entered amounts.
    const bridge = run ? effectiveBridgeAssumptions(run.inputs) : (item?.assumptions.values.bridge ?? null);
    return { items, item, facts, asking, filter, arr, arrSource, benchmark, selected, pool, seller, bridge };
  }

  async benchmark(tenant: TenantContext, dealId: string, query: BenchmarkQuery, requestId: string): Promise<BenchmarkView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'benchmark.viewed', requestId });
    const { items, item, facts, asking, filter, arr, arrSource, benchmark, selected, pool } = await this.compute(tenant, dealId, query, requestId);
    const byId = new Map(selected.map((c) => [c.id, c]));
    const history = await withTenant(this.prisma, tenant, (tx) => multipleJudgements.history(tx, dealId));
    const latest = history[0] ?? null;
    return {
      version: benchmark.version,
      filter,
      scenario: item
        ? {
            id: item.scenario.id,
            name: item.scenario.name,
            method: (item.latestRun?.inputs.assumptions ?? item.assumptions.values.assumptions).method,
            status: item.scenario.status,
          }
        : null,
      target: { arr, arrSource, arrGrowth: facts.arrGrowth, nrr: facts.nrr, grr: facts.grr, asOfMonth: facts.asOfMonth },
      asking: asking ? { version: asking.version, amount: asking.amount, currency: asking.currency, basis: asking.basis } : null,
      count: benchmark.count,
      syntheticCount: benchmark.syntheticCount,
      byOrigin: benchmark.byOrigin,
      sufficient: benchmark.sufficient,
      stats: benchmark.stats,
      chosen: benchmark.chosen,
      askingImplied: benchmark.asking,
      drivers: [...benchmark.drivers],
      comparables: benchmark.comparables.map((c) => toView(byId.get(c.id) as ComparableRecord)),
      comparableSetHash: benchmark.comparableSetHash,
      judgement: latest ? await this.judgementView(tenant, latest, asking?.version ?? null, benchmark.comparableSetHash) : null,
      canJudge: isLead(role),
      ownDeal: {
        eligible: items.some((candidate) => candidate.scenario.status === 'APPROVED' && candidate.latestRun),
        added: pool.some((c) => c.sourceDealId === dealId),
      },
    };
  }

  private async judgementView(
    tenant: TenantContext,
    record: MultipleJudgementRecord,
    askingVersion: number | null,
    setHash: string | null,
  ): Promise<MultipleJudgementView> {
    const user = await withTenant(this.prisma, tenant, (tx) =>
      tx.user.findFirst({ where: { id: record.decidedBy }, select: { displayName: true } }),
    );
    return {
      ...record,
      decidedByName: user?.displayName ?? null,
      decidedAt: record.decidedAt.toISOString(),
      current: record.askingVersion === askingVersion && (setHash === null || record.comparableSetHash === setHash),
    };
  }

  async judgements(tenant: TenantContext, dealId: string, requestId: string): Promise<{ items: MultipleJudgementView[] }> {
    await this.access.require(tenant, dealId, canRead, { action: 'multiple_judgement.list', requestId });
    const { history, asking } = await withTenant(this.prisma, tenant, async (tx) => ({
      history: await multipleJudgements.history(tx, dealId),
      asking: (await askingPrices.currentFor(tx, [dealId])).get(dealId) ?? null,
    }));
    return { items: await Promise.all(history.map((record) => this.judgementView(tenant, record, asking?.version ?? null, null))) };
  }

  /** Only the deal lead records the call on the asking price; it is bound to the benchmark it was made against. */
  async recordJudgement(tenant: TenantContext, dealId: string, input: MultipleJudgementInput, requestId: string): Promise<MultipleJudgementView> {
    await this.access.require(tenant, dealId, isLead, { action: 'multiple_judgement.recorded', requestId });
    const filter: BenchmarkFilter = { companyType: input.companyType, years: input.years, synthetic: input.synthetic };
    const { asking, benchmark } = await this.compute(tenant, dealId, { ...filter, scenarioId: input.scenarioId }, requestId);
    if (!asking) throw new UnprocessableEntityException('Record the asking price first');
    const record = await withTenant(this.prisma, tenant, async (tx) => {
      const created = await multipleJudgements.record(tx, {
        organizationId: tenant.organizationId,
        dealId,
        verdict: input.verdict,
        rationale: input.rationale,
        askingVersion: asking.version,
        askingMultiple: benchmark.asking?.multiple ?? null,
        benchmarkVersion: benchmark.version,
        comparableSetHash: benchmark.comparableSetHash,
        comparableCount: benchmark.count,
        decidedBy: tenant.userId,
      });
      await this.audit(tx, tenant, dealId, 'multiple_judgement.recorded', created.id, requestId);
      return created;
    });
    return this.judgementView(tenant, record, asking.version, benchmark.comparableSetHash);
  }

  /** Comparables cited against the ask, each priced as a counter-offer with the reasons a seller could dismiss it. */
  async anchors(tenant: TenantContext, dealId: string, requestId: string): Promise<AnchorsView> {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'negotiation_anchor.list', requestId });
    const { facts, asking, arr, pool, seller, bridge } = await this.compute(tenant, dealId, { years: 0, synthetic: 'include' }, requestId);
    const { active, deal } = await withTenant(this.prisma, tenant, async (tx) => ({
      active: await negotiationAnchors.active(tx, dealId),
      deal: await deals.get(tx, dealId),
    }));
    const byId = new Map(pool.map((c) => [c.id, c]));
    const names = await this.userNames(tenant, active.map((anchor) => anchor.addedBy));
    const targetName = seller?.name ?? deal?.targetName ?? 'The target';
    const today = new Date().toISOString().slice(0, 10);
    const items: AnchorView[] = [];
    for (const anchor of active) {
      // A retired comparable keeps its anchor visible until the lead removes it.
      const comparable = byId.get(anchor.comparableId) ?? (await withTenant(this.prisma, tenant, (tx) => comparables.get(tx, anchor.comparableId)));
      if (!comparable) continue;
      const base = {
        id: anchor.id,
        comparable: toView(comparable),
        note: anchor.note,
        addedBy: anchor.addedBy,
        addedByName: names.get(anchor.addedBy) ?? null,
        addedAt: anchor.addedAt.toISOString(),
      };
      if (!asking || !arr) {
        items.push({ ...base, counter: null, unavailable: asking ? 'NO_ARR' : 'NO_ASK', talkingPoint: null });
        continue;
      }
      const result = anchorCounterPrice({
        anchor: { ...comparable, arrBasis: comparable.arrBasis },
        target: { arr, companyType: seller?.companyType ?? null, arrGrowth: facts.arrGrowth, nrr: facts.nrr },
        asking,
        bridge,
        today,
      });
      if ('unavailable' in result) {
        items.push({ ...base, counter: null, unavailable: result.unavailable, talkingPoint: null });
        continue;
      }
      items.push({
        ...base,
        counter: { ...result, flags: [...result.flags] },
        unavailable: null,
        talkingPoint: talkingPoint({
          comparable,
          multiple: result.multiple,
          targetName,
          arr,
          counterPrice: result.counterPrice,
          gapRatio: result.gapRatio,
          verdict: result.verdict,
          asking: { amount: asking.amount, currency: asking.currency },
        }),
      });
    }
    let strongest: { id: string; price: string } | null = null;
    for (const item of items) {
      if (!item.counter || item.counter.flags.length > 0) continue;
      const price = item.counter.counterPrice.amount;
      if (!strongest || new D(price).lessThan(strongest.price)) strongest = { id: item.id, price };
    }
    const anchored = new Set(active.map((anchor) => anchor.comparableId));
    return {
      version: ANCHORS_VERSION,
      asking: asking ? { version: asking.version, amount: asking.amount, currency: asking.currency, basis: asking.basis } : null,
      target: { name: targetName, arr },
      items,
      strongestId: strongest?.id ?? null,
      eligible: pool
        .filter((c) => c.origin !== 'OWN_DEAL' && !anchored.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, multiple: toView(c).multiple, origin: c.origin })),
      canEdit: isLead(role),
    };
  }

  /** Only the deal lead cites a comparable. The firm's own deals are confidential and never anchors. */
  async addAnchor(tenant: TenantContext, dealId: string, input: AnchorInput, requestId: string): Promise<AnchorsView> {
    await this.access.require(tenant, dealId, isLead, { action: 'negotiation_anchor.added', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const comparable = await comparables.get(tx, input.comparableId);
      if (!comparable) throw new NotFoundException();
      if (comparable.origin === 'OWN_DEAL') throw new UnprocessableEntityException('Your own deals are confidential and cannot be cited to a seller');
      if (comparable.status !== 'ACTIVE') throw new UnprocessableEntityException('This comparable is retired');
      if ((await negotiationAnchors.active(tx, dealId)).some((anchor) => anchor.comparableId === input.comparableId)) {
        throw new ConflictException('Already an anchor');
      }
      const anchor = await negotiationAnchors.add(tx, {
        organizationId: tenant.organizationId,
        dealId,
        comparableId: input.comparableId,
        note: input.note,
        addedBy: tenant.userId,
      });
      await this.audit(tx, tenant, dealId, 'negotiation_anchor.added', anchor.id, requestId);
    });
    return this.anchors(tenant, dealId, requestId);
  }

  async removeAnchor(tenant: TenantContext, dealId: string, anchorId: string, requestId: string): Promise<AnchorsView> {
    await this.access.require(tenant, dealId, isLead, { action: 'negotiation_anchor.removed', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      if (!(await negotiationAnchors.remove(tx, dealId, anchorId, tenant.userId))) throw new NotFoundException();
      await this.audit(tx, tenant, dealId, 'negotiation_anchor.removed', anchorId, requestId);
    });
    return this.anchors(tenant, dealId, requestId);
  }

  private async userNames(tenant: TenantContext, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await withTenant(this.prisma, tenant, (tx) =>
      tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, displayName: true } }),
    );
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  private audit(tx: TransactionClient, tenant: TenantContext, dealId: string | null, action: string, targetId: string, requestId: string) {
    return appendAuditEvent(tx, {
      organizationId: tenant.organizationId,
      dealId,
      actorUserId: tenant.userId,
      action,
      targetType: action.startsWith('multiple_judgement') ? 'multiple_judgement' : action.startsWith('negotiation_anchor') ? 'negotiation_anchor' : 'comparable',
      targetId,
      outcome: 'SUCCEEDED',
      requestId,
    });
  }
}
