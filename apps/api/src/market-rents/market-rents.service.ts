import { Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { floorPlanGroups, latestEstimates, MARKET_COMP_COUNT, MARKET_RENT, MAX_FLOOR_PLAN_CALLS, medianString, RENT_ROLL_UNIT, type FloorPlanGroup } from '@pactlab/calculations';
import { PropertyDataError, type MarketRentProvider, type RentEstimate } from '@pactlab/connectors';
import { appendAuditEvent, connections, executeSyncRun, sha256Hex, syncRuns, withTenant, type PrismaClient, type TransactionClient } from '@pactlab/db';
import { isBuyerSideRole, permissionsForDealRole, type DealRole, type EvidenceSource, type NormalizedEvidence, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { FindingsService } from '../findings/findings.service';
import { loadPackEvidence, type PackEvidenceRow } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';

export const MARKET_RENT_PROVIDER = Symbol('MARKET_RENT_PROVIDER');

/** The connection that holds a pact's market-rent estimates (its key is Pactlab's, never the tenant's). */
const PROVIDER = 'rentcast';
const SITE = 'api.rentcast.io';
const RESOURCE = 'avm/rent/long-term';

/** Market rents are buyer analysis: never a counterparty (seller contributor, bidder). */
const canRead = (role: DealRole) => isBuyerSideRole(role) && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Retrieving writes evidence and spends provider calls; storing the address changes the pact. */
const canRun = (role: DealRole) => canRead(role) && permissionsForDealRole(role).has('DEAL_WRITE');

export interface FloorPlanView {
  key: string;
  label: string;
  units: number;
  occupied: number;
  medianSquareFeet: string | null;
  /** Over the per-retrieval cap: not checked. */
  overCap: boolean;
  estimate: {
    evidenceId: string;
    rent: string;
    rentRangeLow: string;
    rentRangeHigh: string;
    currency: string;
    comparablesCount: number;
    retrievedOn: string;
    source: string;
    address: string;
  } | null;
}

export interface MarketRentsView {
  /** A provider is configured here (RentCast with its key; the fixture outside production). */
  available: boolean;
  source: string | null;
  address: string | null;
  /** Where the address comes from: the pact itself, or its listing / teaser page. */
  addressFrom: 'PACT' | 'LISTING' | null;
  /** RentCast covers US properties, in USD. */
  currencySupported: boolean;
  floorPlans: FloorPlanView[];
  /** Units whose type names no bedroom count: they have no floor plan to check. */
  unplannedUnits: number;
  callsPerRetrieval: number;
}

export interface MarketRentsRetrieval extends MarketRentsView {
  retrieval: {
    /** Provider calls this request made (0 for a same-day re-run). */
    calls: number;
    created: number;
    unchanged: number;
    /** Floor plans the provider had no estimate for. */
    noEstimate: string[];
    /** Floor plans over the cap, not checked. */
    overCap: string[];
  };
}

interface Loaded {
  baseCurrency: string;
  address: string | null;
  addressFrom: MarketRentsView['addressFrom'];
  groups: FloorPlanGroup[];
  unplanned: number;
  estimates: PackEvidenceRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Market rents for a rent roll (T-158, ADR 0045). The rent roll's units are grouped into floor plans;
 * one provider call per plan (capped per retrieval) returns a long-term rent estimate, stored as
 * `market.rent_estimate` evidence through the sync engine, so each figure keeps its source, retrieval
 * date and lineage. Fingerprint: address, floor plan and date: a same-day re-run calls nothing and adds
 * nothing. The calculator and the pack rule read the estimates; nothing here computes a figure.
 */
@Injectable()
export class MarketRentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(MARKET_RENT_PROVIDER) private readonly provider: MarketRentProvider | null,
    @Optional() @Inject(FindingsService) private readonly findings: FindingsService | null,
  ) {}

  async status(tenant: TenantContext, dealId: string, requestId: string): Promise<MarketRentsView> {
    await this.access.require(tenant, dealId, canRead, { action: 'market_rents.viewed', requestId });
    return this.view(await withTenant(this.prisma, tenant, (tx) => this.load(tx, dealId)));
  }

  async setAddress(tenant: TenantContext, dealId: string, address: string, requestId: string): Promise<MarketRentsView> {
    await this.access.require(tenant, dealId, canRun, { action: 'deal.property_address_set', requestId });
    const loaded = await withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.deal.updateMany({ where: { id: dealId }, data: { propertyAddress: address } });
      if (updated.count === 0) throw new NotFoundException();
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'deal.property_address_set', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      return this.load(tx, dealId);
    });
    return this.view(loaded);
  }

  async retrieve(tenant: TenantContext, dealId: string, requestId: string): Promise<MarketRentsRetrieval> {
    await this.access.require(tenant, dealId, canRun, { action: 'market_rents.retrieved', requestId });
    const provider = this.provider;
    if (!provider) throw new ServiceUnavailableException({ code: 'MARKET_RENTS_OFF' });
    const loaded = await withTenant(this.prisma, tenant, (tx) => this.load(tx, dealId));
    if (loaded.baseCurrency !== 'USD') throw new UnprocessableEntityException({ code: 'MARKET_RENTS_USD_ONLY' });
    const address = loaded.address;
    if (!address) throw new UnprocessableEntityException({ code: 'PROPERTY_ADDRESS_NEEDED' });
    if (loaded.groups.length === 0) throw new UnprocessableEntityException({ code: loaded.unplanned > 0 ? 'NO_FLOOR_PLANS' : 'RENT_ROLL_NEEDED' });

    const date = today();
    const checked = loaded.groups.slice(0, MAX_FLOOR_PLAN_CALLS);
    const overCap = loaded.groups.slice(MAX_FLOOR_PLAN_CALLS).map((group) => group.plan.key);
    // Already estimated today at this address: no call, nothing added.
    const fresh = new Set(loaded.estimates.filter((row) => row.canonical['address'] === address && row.canonical['retrieved_on'] === date).map((row) => row.canonical['floor_plan']));
    const todo = checked.filter((group) => !fresh.has(group.plan.key));
    const summary = { calls: 0, created: 0, unchanged: 0, noEstimate: [] as string[], overCap };

    if (todo.length > 0) {
      const { connectionId, runId, done } = await withTenant(this.prisma, tenant, async (tx) => {
        const existing = (await connections.list(tx, dealId)).find((row) => row.provider === PROVIDER && row.mode === provider.mode);
        const connection =
          existing ??
          (await connections.create(tx, {
            organizationId: tenant.organizationId,
            dealId,
            provider: PROVIDER,
            displayName: `${provider.name} market rents`,
            mode: provider.mode,
            credentialRef: null,
            config: {},
            evidenceVisibility: 'BUYER_ONLY',
            createdBy: tenant.userId,
          }));
        const requested = await syncRuns.request(tx, {
          organizationId: tenant.organizationId,
          dealId,
          connectionId: connection.id,
          connectorVersion: provider.version,
          idempotencyKey: `market-rents:${date}:${sha256Hex([address, ...todo.map((group) => group.plan.key)].join('|'))}`,
          requestedBy: tenant.userId,
          correlationId: requestId,
        });
        return { connectionId: connection.id, runId: requested.run.id, done: requested.run.status === 'SUCCEEDED' };
      });
      if (!done) {
        const source = this.source(provider, address, date, todo, summary);
        try {
          const outcome = await executeSyncRun(this.prisma, { organizationId: tenant.organizationId, dealId, requestedBy: tenant.userId, syncRunId: runId }, source);
          summary.created = outcome.recordsCreated;
          summary.unchanged = outcome.recordsUnchanged;
        } catch (error) {
          await this.audit(tenant, dealId, connectionId, 'FAILED', requestId);
          if (error instanceof PropertyDataError) throw new ServiceUnavailableException({ code: error.kind === 'RATE_LIMITED' ? 'MARKET_RENTS_RATE_LIMITED' : error.kind === 'AUTH' ? 'MARKET_RENTS_KEY_REFUSED' : 'MARKET_RENTS_UNAVAILABLE' });
          throw error;
        }
        // The estimates feed the pack's checks: draft what they show (idempotent; drafts only, a person decides).
        if (this.findings && summary.created > 0) {
          try {
            await this.findings.runPackRules(tenant, dealId, requestId);
          } catch {
            // A role that cannot draft findings still retrieves; the checks run on the next import or run.
          }
        }
      }
      await this.audit(tenant, dealId, connectionId, 'SUCCEEDED', requestId);
    } else {
      await this.audit(tenant, dealId, dealId, 'SUCCEEDED', requestId);
    }
    const view = this.view(await withTenant(this.prisma, tenant, (tx) => this.load(tx, dealId)));
    return { ...view, retrieval: summary };
  }

  /** The provider calls for the floor plans still to estimate, as normalized evidence (pulled by the sync engine, outside its transaction). */
  private source(provider: MarketRentProvider, address: string, date: string, todo: readonly FloorPlanGroup[], summary: MarketRentsRetrieval['retrieval']): EvidenceSource {
    return {
      provider: PROVIDER,
      version: provider.version,
      pull: async () => {
        const records: NormalizedEvidence[] = [];
        for (const group of todo) {
          summary.calls += 1;
          const estimate = await provider.estimateRent({
            address,
            propertyType: 'Apartment',
            bedrooms: group.plan.bedrooms,
            bathrooms: group.plan.bathrooms === null ? null : Number(group.plan.bathrooms),
            squareFootage: group.medianSquareFeet === null ? null : Number(group.medianSquareFeet),
            compCount: MARKET_COMP_COUNT,
          });
          if (!estimate) {
            summary.noEstimate.push(group.plan.key);
            continue;
          }
          records.push(record(provider.name, address, date, group, estimate));
        }
        return { records, issues: [] };
      },
    };
  }

  private async load(tx: TransactionClient, dealId: string): Promise<Loaded> {
    const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { baseCurrency: true, propertyAddress: true } });
    if (!deal) throw new NotFoundException();
    const listing = deal.propertyAddress ? null : await tx.dealListing.findFirst({ where: { dealId }, select: { propertyAddress: true } });
    const units = await loadPackEvidence(tx, dealId, [RENT_ROLL_UNIT]);
    const estimates = await loadPackEvidence(tx, dealId, [MARKET_RENT]);
    const { groups, unplanned } = floorPlanGroups(units);
    const address = deal.propertyAddress ?? listing?.propertyAddress ?? null;
    return { baseCurrency: deal.baseCurrency, address, addressFrom: deal.propertyAddress ? 'PACT' : address ? 'LISTING' : null, groups, unplanned, estimates };
  }

  private view(loaded: Loaded): MarketRentsView {
    const latest = latestEstimates(loaded.estimates);
    return {
      available: this.provider !== null,
      source: this.provider?.name ?? null,
      address: loaded.address,
      addressFrom: loaded.addressFrom,
      currencySupported: loaded.baseCurrency === 'USD',
      floorPlans: loaded.groups.map((group, index) => {
        const row = latest.get(group.plan.key);
        const field = (name: string) => row?.canonical[name] ?? '';
        return {
          key: group.plan.key,
          label: group.plan.label,
          units: group.units,
          occupied: group.occupied,
          medianSquareFeet: group.medianSquareFeet,
          overCap: index >= MAX_FLOOR_PLAN_CALLS,
          estimate: row
            ? { evidenceId: row.id, rent: field('rent'), rentRangeLow: field('rent_range_low'), rentRangeHigh: field('rent_range_high'), currency: field('currency'), comparablesCount: Number(field('comparables_count') || 0), retrievedOn: field('retrieved_on'), source: field('source'), address: field('address') }
            : null,
        };
      }),
      unplannedUnits: loaded.unplanned,
      callsPerRetrieval: MAX_FLOOR_PLAN_CALLS,
    };
  }

  private async audit(tenant: TenantContext, dealId: string, targetId: string, outcome: 'SUCCEEDED' | 'FAILED', requestId: string) {
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'market_rents.retrieved', targetType: targetId === dealId ? 'deal' : 'connection', targetId, outcome, requestId }),
    );
  }
}

/**
 * One floor plan's estimate as evidence. No people: the provider returns none for a rent estimate, and
 * comparables keep only their listing (address as returned, rent, distance, similarity) for the citation view.
 */
function record(source: string, address: string, date: string, group: FloorPlanGroup, estimate: RentEstimate): NormalizedEvidence {
  const comps = estimate.comparables;
  const canonical: Record<string, string | null> = {
    floor_plan: group.plan.key,
    floor_plan_label: group.plan.label,
    bedrooms: String(group.plan.bedrooms),
    bathrooms: group.plan.bathrooms,
    square_feet: group.medianSquareFeet,
    units: String(group.units),
    address,
    property_type: 'Apartment',
    rent: estimate.rent,
    rent_range_low: estimate.rentRangeLow,
    rent_range_high: estimate.rentRangeHigh,
    currency: estimate.currency,
    comparables_count: String(comps.length),
    comparables_median_distance: medianString(comps.map((comp) => comp.distance), 2),
    comparables_median_correlation: medianString(comps.map((comp) => comp.correlation), 4),
    comparables: comps.map((comp) => `${comp.formattedAddress ?? 'Address not given'}: ${comp.price} a month, ${comp.distance ?? '?'} mi, similarity ${comp.correlation ?? '?'}`).join('\n') || null,
    retrieved_on: date,
    source,
  };
  return {
    evidenceType: MARKET_RENT,
    sourceSystem: PROVIDER,
    sourceRecordId: group.plan.key,
    observedAt: `${date}T00:00:00.000Z`,
    canonical,
    locator: { kind: 'provider_record', system: source, site: SITE, resource: RESOURCE, id: `${group.plan.key}@${date}` },
    quote: JSON.stringify({ address, floorPlan: group.plan.key, rent: estimate.rent, rentRangeLow: estimate.rentRangeLow, rentRangeHigh: estimate.rentRangeHigh, comparables: comps.length }),
  };
}
