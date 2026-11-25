import { D } from '../../metrics/decimal';
import { moneyIn } from '../common';
import { addYears } from '../music/catalog';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * Energy generation & rights (T-142, ADR 0043): the asset and interest register, the production
 * and decline model, the decimal and lease checks and the liability model, over the imported
 * registers and schedules, the entries a person confirmed from documents, and deterministic reads
 * of document sentences. Decimal-only. Absence is shown as absence: the platform never estimates
 * reserves, production or liabilities — engineering figures are the third-party report's.
 */
export const ENERGY_ASSETS_VERSION = 'energy-assets-1';

export const ENERGY_EVIDENCE = {
  PLANT: 'energy.plant',
  INTEREST: 'energy.interest',
  LEASE: 'energy.lease',
  PRODUCTION: 'energy.production',
  LIABILITY: 'energy.liability',
} as const;
/** The imported evidence types (CSV targets). */
export const ENERGY_EVIDENCE_TYPES = Object.values(ENERGY_EVIDENCE);

/** Evidence types a confirmed document entry stands in for (never imported; built from confirmed entries). */
export const ENERGY_ENTRY = {
  RESERVES: 'energy.reserves',
  RESERVE_VALUE: 'energy.reserve_value',
  DECLINE: 'energy.decline_assumption',
  ESTIMATE: 'energy.liability_estimate',
} as const;

type Decimal = InstanceType<typeof D>;

/** Thresholds the checks use; every finding states the one it applied. */
export const ENERGY_THRESHOLDS = {
  /** Actual annual decline this many points steeper than the report's assumption is a mismatch. */
  declinePoints: '5',
  /** Net acres not held by production and expiring inside the hold at or above this share are drafted. */
  leaseExposedShare: '0.10',
  /** A division-order decimal further than this from the recomputed lease chain is an error. */
  decimalTolerance: '0.00001',
  /** The evidence-based retirement estimate above the booked ARO by more than this margin is a shortfall. */
  aroMargin: '0.10',
} as const;

/** The hold the lease and PPA analyses assume when no document states "hold period of N years". */
export const ENERGY_DEFAULT_HOLD_YEARS = 5;

export const ENERGY_CONVENTIONS = {
  production: [
    'Analysis date: the last production period end. Trailing year: periods ending in the twelve months to it; prior year: the twelve months before.',
    'Barrels of oil equivalent: oil and NGL barrels plus gas mcf ÷ 6.',
    'Decline: 1 − trailing ÷ prior-year BOE (an exponential, year-on-year reading of the history). The reserve report’s own decline assumption is compared, never replaced.',
    'Reserves and their discounted values are the third-party engineering report’s, as a person confirmed them: Pactlab never estimates reserves.',
  ],
  decimals: [
    'Working interest: NRI = working interest × (1 − lessor royalty − overriding royalty).',
    'Mineral or royalty interest: NRI = the share owned × the lessor royalty.',
    `A division-order decimal more than ${ENERGY_THRESHOLDS.decimalTolerance} from the recomputed chain is flagged; the yearly over- or underpayment is the difference × the interest’s trailing gross (8/8ths) revenue.`,
  ],
  leases: [
    'A lease is exposed when it is not held by production and its primary term ends between the analysis date and the end of the hold.',
    'Exposed share: exposed net acres ÷ all net acres on the lease schedule. Whether a lease is in fact held (by production, a unit or a savings clause) is for counsel.',
  ],
  liabilities: [
    'Evidence estimates are read from reports and permits (a sentence stating an estimate and an amount) and from entries a person confirmed; booked figures are the seller’s liability schedule.',
    'An obligation is unbooked when the schedule holds nothing for its kind and asset; the asset-retirement obligation is short when the estimate exceeds the booked figure by more than the margin.',
  ],
  plants: [
    'Capacity factor: trailing net generation ÷ (net capacity × 8,760 hours), where twelve months of generation are on file.',
    'Contract coverage: trailing revenue sold under contract ÷ the plant’s trailing revenue. A PPA ending inside the hold leaves that share merchant.',
  ],
} as const;

const field = (row: PackRuleEvidence, name: string) => (row.canonical[name] ?? '').trim();
const decimal = (row: PackRuleEvidence, name: string): Decimal | null => {
  const text = field(row, name).replaceAll(',', '');
  return /^-?\d+(\.\d+)?$/.test(text) ? new D(text) : null;
};
const isDate = (text: string) => /^\d{4}-\d{2}-\d{2}/.test(text);
const dateField = (row: PackRuleEvidence, name: string) => (isDate(field(row, name)) ? field(row, name).slice(0, 10) : null);
const yes = (text: string) => ['yes', 'y', 'true', 'hbp'].includes(text.toLowerCase());

export interface Plant {
  readonly id: string;
  readonly evidenceId: string;
  readonly name: string;
  readonly fuel: string;
  readonly capacityMw: Decimal;
  readonly commissionedYear: number | null;
  readonly capacityFactor: Decimal | null;
  readonly ppaCounterparty: string | null;
  readonly ppaExpiresOn: string | null;
}

export interface Interest {
  readonly id: string;
  readonly evidenceId: string;
  readonly name: string;
  readonly legalDescription: string | null;
  readonly leaseId: string;
  readonly type: string;
  readonly share: Decimal;
  readonly divisionOrderNri: Decimal | null;
  readonly operator: string | null;
}

export interface Lease {
  readonly id: string;
  readonly evidenceId: string;
  readonly netAcres: Decimal;
  readonly royalty: Decimal;
  readonly overriding: Decimal;
  readonly expiresOn: string | null;
  readonly heldByProduction: boolean;
}

export interface ProductionLine {
  readonly id: string;
  readonly assetId: string;
  readonly periodEnd: string;
  readonly product: string;
  readonly volume: Decimal;
  readonly revenue: Decimal;
  readonly salesType: string | null;
}

export interface BookedLiability {
  readonly id: string;
  readonly assetId: string | null;
  readonly kind: string;
  readonly description: string | null;
  readonly booked: Decimal;
}

/** An estimate the evidence gives: a confirmed entry (id) or a document sentence (quote). */
export interface LiabilityEstimate {
  readonly kind: string;
  readonly assetRef: string | null;
  readonly amount: Decimal;
  readonly currency: string | null;
  readonly evidenceId: string | null;
  readonly quote: PackRuleQuote | null;
}

export interface EnergyRows {
  readonly plants: readonly Plant[];
  readonly interests: readonly Interest[];
  readonly leases: readonly Lease[];
  readonly production: readonly ProductionLine[];
  readonly liabilities: readonly BookedLiability[];
  /** Confirmed entries. */
  readonly reserves: readonly { id: string; category: string; volume: Decimal }[];
  readonly reserveValues: readonly { id: string; category: string; value: Decimal }[];
  readonly declines: readonly { id: string; percent: Decimal }[];
  readonly estimates: readonly LiabilityEstimate[];
}

const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));

/** The registers and schedules by type; malformed rows (no id, no date) are left out, never guessed. */
export function energyRows(evidence: readonly PackRuleEvidence[]): EnergyRows {
  const plants: Plant[] = [];
  const interests: Interest[] = [];
  const leases: Lease[] = [];
  const production: ProductionLine[] = [];
  const liabilities: BookedLiability[] = [];
  const reserves: { id: string; category: string; volume: Decimal }[] = [];
  const reserveValues: { id: string; category: string; value: Decimal }[] = [];
  const declines: { id: string; percent: Decimal }[] = [];
  const estimates: LiabilityEstimate[] = [];
  for (const row of evidence) {
    if (row.evidenceType === ENERGY_EVIDENCE.PLANT && field(row, 'plant_id')) {
      const year = field(row, 'commissioned_year');
      const factor = decimal(row, 'capacity_factor_pct');
      plants.push({
        id: field(row, 'plant_id'),
        evidenceId: row.id,
        name: field(row, 'name') || field(row, 'plant_id'),
        fuel: field(row, 'fuel').toLowerCase(),
        capacityMw: decimal(row, 'capacity_mw') ?? new D(0),
        commissionedYear: /^\d{4}(\.0+)?$/.test(year) ? Number(year.slice(0, 4)) : null,
        capacityFactor: factor ? factor.div(100) : null,
        ppaCounterparty: field(row, 'ppa_counterparty') || null,
        ppaExpiresOn: dateField(row, 'ppa_expires_on'),
      });
    } else if (row.evidenceType === ENERGY_EVIDENCE.INTEREST && field(row, 'interest_id') && field(row, 'lease_id')) {
      interests.push({
        id: field(row, 'interest_id'),
        evidenceId: row.id,
        name: field(row, 'name') || field(row, 'interest_id'),
        legalDescription: field(row, 'legal_description') || null,
        leaseId: field(row, 'lease_id'),
        type: field(row, 'interest_type').toLowerCase(),
        share: decimal(row, 'interest_share') ?? new D(0),
        divisionOrderNri: decimal(row, 'division_order_nri'),
        operator: field(row, 'operator') || null,
      });
    } else if (row.evidenceType === ENERGY_EVIDENCE.LEASE && field(row, 'lease_id')) {
      leases.push({
        id: field(row, 'lease_id'),
        evidenceId: row.id,
        netAcres: decimal(row, 'net_acres') ?? new D(0),
        royalty: decimal(row, 'royalty_rate') ?? new D(0),
        overriding: decimal(row, 'overriding_royalty') ?? new D(0),
        expiresOn: dateField(row, 'expires_on'),
        heldByProduction: yes(field(row, 'held_by_production')),
      });
    } else if (row.evidenceType === ENERGY_EVIDENCE.PRODUCTION && field(row, 'asset_id') && dateField(row, 'period_end')) {
      production.push({
        id: row.id,
        assetId: field(row, 'asset_id'),
        periodEnd: dateField(row, 'period_end') as string,
        product: field(row, 'product').toLowerCase(),
        volume: decimal(row, 'volume') ?? new D(0),
        revenue: decimal(row, 'gross_revenue') ?? new D(0),
        salesType: field(row, 'sales_type').toLowerCase() || null,
      });
    } else if (row.evidenceType === ENERGY_EVIDENCE.LIABILITY && field(row, 'kind')) {
      liabilities.push({ id: row.id, assetId: field(row, 'asset_id') || null, kind: field(row, 'kind').toLowerCase(), description: field(row, 'description') || null, booked: decimal(row, 'booked_amount') ?? new D(0) });
    } else if (row.evidenceType === ENERGY_ENTRY.RESERVES && decimal(row, 'value')) {
      reserves.push({ id: row.id, category: field(row, 'category').toUpperCase(), volume: decimal(row, 'value') as Decimal });
    } else if (row.evidenceType === ENERGY_ENTRY.RESERVE_VALUE && decimal(row, 'value')) {
      reserveValues.push({ id: row.id, category: field(row, 'category').toUpperCase(), value: decimal(row, 'value') as Decimal });
    } else if (row.evidenceType === ENERGY_ENTRY.DECLINE && decimal(row, 'value')) {
      declines.push({ id: row.id, percent: decimal(row, 'value') as Decimal });
    } else if (row.evidenceType === ENERGY_ENTRY.ESTIMATE && decimal(row, 'value') && field(row, 'kind')) {
      estimates.push({ kind: field(row, 'kind').toLowerCase(), assetRef: field(row, 'asset_ref') || null, amount: decimal(row, 'value') as Decimal, currency: field(row, 'currency') || null, evidenceId: row.id, quote: null });
    }
  }
  return {
    plants: byId(plants),
    interests: byId(interests),
    leases: byId(leases),
    production: production.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.id.localeCompare(b.id)),
    liabilities: byId(liabilities),
    reserves,
    reserveValues,
    declines,
    estimates,
  };
}

/** The hold period a document states ("hold period of 7 years"), else the pack's default. */
export function energyHoldYears(pages: readonly { readonly text: string }[]): { years: number; stated: boolean } {
  for (const page of pages) {
    const match = /hold(?:ing)? period of (\d{1,2}) years/i.exec(page.text.replace(/\s+/g, ' '));
    const years = match ? Number(match[1]) : 0;
    if (years >= 1 && years <= 30) return { years, stated: true };
  }
  return { years: ENERGY_DEFAULT_HOLD_YEARS, stated: false };
}

const cap = (text: string) => (text.length > 400 ? text.slice(0, 400) : text);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });

/** The obligation a sentence speaks of, most specific first. */
export function liabilityKindOf(text: string): string | null {
  if (/coal ash|ash pond|ash impoundment|\bCCR\b|coal combustion residual/i.test(text)) return 'ccr';
  if (/decommission|asset retirement|plugging and abandon|plug and abandon|retirement obligation/i.test(text)) return 'aro';
  if (/reclamation/i.test(text)) return 'reclamation';
  if (/remediation|contamination|clean-?up/i.test(text)) return 'remediation';
  return null;
}

/** Liability estimates the reports and permits state: a sentence with an estimate, an obligation and an amount. */
export function documentEstimates(pages: readonly PackRulePage[]): LiabilityEstimate[] {
  const found: LiabilityEstimate[] = [];
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      if (!/\bestimat/i.test(sentence)) continue;
      const kind = liabilityKindOf(sentence);
      const money = moneyIn(sentence);
      if (!kind || !money || !money.amount.gt(0)) continue;
      found.push({ kind, assetRef: null, amount: money.amount, currency: money.currency, evidenceId: null, quote: quoteOf(page, sentence) });
    }
  }
  return found;
}

/** The annual decline a reserve report assumes ("assumes an annual decline of 12%"), read from its sentence. */
export function documentDecline(pages: readonly PackRulePage[]): { percent: Decimal; quote: PackRuleQuote } | null {
  const pattern = /assum\w*\s+(?:an?\s+)?(?:average\s+)?annual\s+(?:production\s+)?decline(?:\s+rate)?\s+of\s+(\d{1,2}(?:\.\d+)?)\s?%/i;
  for (const page of pages) {
    const sentence = sentences(page.text).find((candidate) => pattern.test(candidate));
    const match = sentence ? pattern.exec(sentence) : null;
    if (sentence && match?.[1]) return { percent: new D(match[1]), quote: quoteOf(page, sentence) };
  }
  return null;
}

/** True when a page reads as a reserve report (or reserves were confirmed from one). */
export function reserveReportOnFile(rows: EnergyRows, pages: readonly PackRulePage[]): boolean {
  return rows.reserves.length > 0 || rows.reserveValues.length > 0 || pages.some((page) => /\b(reserve report|reserves report|proved developed producing)\b/i.test(page.text));
}

/** The last production period end: the date every trailing figure runs to. */
export function analysisDate(rows: EnergyRows): string | null {
  return rows.production.at(-1)?.periodEnd ?? null;
}

const boe = (line: ProductionLine) => (line.product === 'gas' ? line.volume.div(6) : line.product === 'oil' || line.product === 'ngl' ? line.volume : new D(0));

export interface AssetProduction {
  readonly assetId: string;
  readonly trailingBoe: Decimal;
  readonly priorBoe: Decimal;
  readonly trailingMwh: Decimal;
  readonly trailingRevenue: Decimal;
  readonly contractedRevenue: Decimal;
  readonly months: number;
  /** 1 − trailing ÷ prior BOE; null without a prior year. */
  readonly decline: Decimal | null;
  readonly lineIds: readonly string[];
}

export interface ProductionModel {
  readonly analysisDate: string | null;
  readonly trailingFrom: string | null;
  readonly byAsset: ReadonlyMap<string, AssetProduction>;
  readonly interestTrailingBoe: Decimal;
  readonly interestPriorBoe: Decimal;
  readonly interestDecline: Decimal | null;
  readonly interestTrailingRevenue: Decimal;
  readonly plantTrailingRevenue: Decimal;
  readonly plantContractedRevenue: Decimal;
}

/** Trailing and prior-year production by asset, the portfolio decline and contract coverage. */
export function productionModel(rows: EnergyRows): ProductionModel {
  const latest = analysisDate(rows);
  if (!latest) return { analysisDate: null, trailingFrom: null, byAsset: new Map(), interestTrailingBoe: new D(0), interestPriorBoe: new D(0), interestDecline: null, interestTrailingRevenue: new D(0), plantTrailingRevenue: new D(0), plantContractedRevenue: new D(0) };
  const trailingFrom = addYears(latest, -1);
  const priorFrom = addYears(latest, -2);
  const interests = new Set(rows.interests.map((interest) => interest.id));
  const plants = new Set(rows.plants.map((plant) => plant.id));
  const entries = new Map<string, { trailingBoe: Decimal; priorBoe: Decimal; trailingMwh: Decimal; trailingRevenue: Decimal; contractedRevenue: Decimal; months: Set<string>; lineIds: string[] }>();
  for (const line of rows.production) {
    const entry = entries.get(line.assetId) ?? { trailingBoe: new D(0), priorBoe: new D(0), trailingMwh: new D(0), trailingRevenue: new D(0), contractedRevenue: new D(0), months: new Set<string>(), lineIds: [] };
    if (line.periodEnd > trailingFrom) {
      entry.trailingBoe = entry.trailingBoe.plus(boe(line));
      if (line.product === 'power') entry.trailingMwh = entry.trailingMwh.plus(line.volume);
      entry.trailingRevenue = entry.trailingRevenue.plus(line.revenue);
      if (line.salesType === 'contracted') entry.contractedRevenue = entry.contractedRevenue.plus(line.revenue);
      entry.months.add(line.periodEnd.slice(0, 7));
      entry.lineIds.push(line.id);
    } else if (line.periodEnd > priorFrom) {
      entry.priorBoe = entry.priorBoe.plus(boe(line));
    }
    entries.set(line.assetId, entry);
  }
  const byAsset = new Map<string, AssetProduction>(
    [...entries.entries()].map(([assetId, entry]) => [
      assetId,
      { assetId, trailingBoe: entry.trailingBoe, priorBoe: entry.priorBoe, trailingMwh: entry.trailingMwh, trailingRevenue: entry.trailingRevenue, contractedRevenue: entry.contractedRevenue, months: entry.months.size, decline: entry.priorBoe.gt(0) ? new D(1).minus(entry.trailingBoe.div(entry.priorBoe)) : null, lineIds: entry.lineIds },
    ]),
  );
  const sum = (ids: Set<string>, pick: (asset: AssetProduction) => Decimal) => [...byAsset.values()].filter((asset) => ids.has(asset.assetId)).reduce((total, asset) => total.plus(pick(asset)), new D(0));
  const trailingBoe = sum(interests, (asset) => asset.trailingBoe);
  const priorBoe = sum(interests, (asset) => asset.priorBoe);
  return {
    analysisDate: latest,
    trailingFrom,
    byAsset,
    interestTrailingBoe: trailingBoe,
    interestPriorBoe: priorBoe,
    interestDecline: priorBoe.gt(0) ? new D(1).minus(trailingBoe.div(priorBoe)) : null,
    interestTrailingRevenue: sum(interests, (asset) => asset.trailingRevenue),
    plantTrailingRevenue: sum(plants, (asset) => asset.trailingRevenue),
    plantContractedRevenue: sum(plants, (asset) => asset.contractedRevenue),
  };
}

/** A plant's capacity factor from its trailing generation, when twelve months are on file. */
export function computedCapacityFactor(plant: Plant, production: ProductionModel): Decimal | null {
  const asset = production.byAsset.get(plant.id);
  if (!asset || asset.months < 12 || !plant.capacityMw.gt(0)) return null;
  return asset.trailingMwh.div(plant.capacityMw.times(8760));
}

export interface DecimalCheck {
  readonly interestId: string;
  readonly name: string;
  readonly leaseId: string;
  readonly stated: Decimal;
  readonly computed: Decimal;
  /** Stated − computed. */
  readonly difference: Decimal;
  readonly direction: 'OVERPAID' | 'UNDERPAID';
  /** |difference| × the interest's trailing gross revenue. */
  readonly yearly: Decimal;
  readonly evidenceIds: readonly string[];
}

/** The NRI the lease royalty chain supports for an interest, or null when its lease or type is unknown. */
export function recomputedNri(interest: Interest, lease: Lease | undefined): Decimal | null {
  if (!lease) return null;
  if (interest.type === 'working') return interest.share.times(new D(1).minus(lease.royalty).minus(lease.overriding));
  if (interest.type === 'mineral' || interest.type === 'royalty') return interest.share.times(lease.royalty);
  return null;
}

/** Division-order decimals recomputed from the lease chain; only the ones that differ beyond the tolerance. */
export function decimalChecks(rows: EnergyRows, production: ProductionModel): DecimalCheck[] {
  const leases = new Map(rows.leases.map((lease) => [lease.id, lease]));
  return rows.interests.flatMap((interest): DecimalCheck[] => {
    const lease = leases.get(interest.leaseId);
    const computed = recomputedNri(interest, lease);
    if (!computed || !interest.divisionOrderNri) return [];
    const difference = interest.divisionOrderNri.minus(computed);
    if (!difference.abs().gt(ENERGY_THRESHOLDS.decimalTolerance)) return [];
    const revenue = production.byAsset.get(interest.id)?.trailingRevenue ?? new D(0);
    return [
      {
        interestId: interest.id,
        name: interest.name,
        leaseId: interest.leaseId,
        stated: interest.divisionOrderNri,
        computed,
        difference,
        direction: difference.gt(0) ? 'OVERPAID' : 'UNDERPAID',
        yearly: difference.abs().times(revenue),
        evidenceIds: [interest.evidenceId, ...(lease ? [lease.evidenceId] : [])],
      },
    ];
  });
}

export interface LeaseExposure {
  readonly analysisDate: string | null;
  readonly holdYears: number;
  readonly holdEnds: string | null;
  readonly totalAcres: Decimal;
  readonly exposedAcres: Decimal;
  readonly share: Decimal | null;
  readonly leases: readonly { id: string; evidenceId: string; netAcres: Decimal; expiresOn: string }[];
  /** Not held by production and already past the primary term at the analysis date. */
  readonly lapsed: readonly string[];
}

/** Acreage not held by production whose primary term ends inside the hold. */
export function leaseExposure(rows: EnergyRows, date: string | null, holdYears: number): LeaseExposure {
  const holdEnds = date ? addYears(date, holdYears) : null;
  const totalAcres = rows.leases.reduce((total, lease) => total.plus(lease.netAcres), new D(0));
  const exposed = date && holdEnds ? rows.leases.filter((lease) => !lease.heldByProduction && lease.expiresOn !== null && lease.expiresOn > date && lease.expiresOn <= holdEnds) : [];
  const lapsed = date ? rows.leases.filter((lease) => !lease.heldByProduction && lease.expiresOn !== null && lease.expiresOn <= date).map((lease) => lease.id) : [];
  const exposedAcres = exposed.reduce((total, lease) => total.plus(lease.netAcres), new D(0));
  return {
    analysisDate: date,
    holdYears,
    holdEnds,
    totalAcres,
    exposedAcres,
    share: totalAcres.gt(0) && date ? exposedAcres.div(totalAcres) : null,
    leases: exposed.map((lease) => ({ id: lease.id, evidenceId: lease.evidenceId, netAcres: lease.netAcres, expiresOn: lease.expiresOn as string })).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.id.localeCompare(b.id)),
    lapsed,
  };
}

/** Whole months from one date to a later one (a part month counts; month end to month end is whole months). */
export function monthsBetween(from: string, to: string): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  const monthEnd = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate() === Number(from.slice(8, 10));
  return to.slice(8, 10) > from.slice(8, 10) && !monthEnd ? months + 1 : months;
}

export interface LiabilityLine {
  readonly kind: string;
  readonly assetId: string | null;
  readonly assetName: string | null;
  readonly estimate: Decimal;
  readonly currency: string | null;
  readonly booked: Decimal;
  readonly gap: Decimal;
  readonly status: 'UNBOOKED' | 'SHORTFALL' | 'COVERED';
  readonly estimateIds: readonly string[];
  readonly quotes: readonly PackRuleQuote[];
  readonly bookedIds: readonly string[];
}

export interface LiabilityModel {
  readonly lines: readonly LiabilityLine[];
  readonly bookedTotal: Decimal;
  readonly estimateTotal: Decimal;
  /** Schedule lines no evidence estimate speaks of. */
  readonly bookedOnly: readonly BookedLiability[];
}

/**
 * Evidence-based obligations against the seller's booked figures. Estimates from confirmed entries
 * and from document sentences merge (one stating the same kind and amount is one estimate); per kind
 * and asset the largest estimate stands. Booked lines match by kind, and by asset where both name one.
 */
export function liabilityModel(rows: EnergyRows, pages: readonly PackRulePage[]): LiabilityModel {
  const assets = [...rows.plants.map((plant) => ({ id: plant.id, name: plant.name })), ...rows.interests.map((interest) => ({ id: interest.id, name: interest.name }))];
  const resolve = (text: string | null) => {
    if (!text) return null;
    const lower = text.toLowerCase();
    return assets.find((asset) => asset.id.toLowerCase() === lower || asset.name.toLowerCase() === lower) ?? assets.find((asset) => lower.includes(asset.name.toLowerCase()) || lower.includes(asset.id.toLowerCase())) ?? null;
  };
  const all = [...rows.estimates, ...documentEstimates(pages)];
  const groups = new Map<string, { kind: string; asset: { id: string; name: string } | null; estimates: LiabilityEstimate[] }>();
  for (const estimate of all) {
    const asset = resolve(estimate.assetRef) ?? resolve(estimate.quote?.quote ?? null);
    const key = `${estimate.kind}|${asset?.id ?? ''}`;
    const group = groups.get(key) ?? { kind: estimate.kind, asset, estimates: [] };
    group.estimates.push(estimate);
    groups.set(key, group);
  }
  const matched = new Set<string>();
  const lines: LiabilityLine[] = [...groups.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || (a.asset?.id ?? '').localeCompare(b.asset?.id ?? ''))
    .map((group) => {
      const largest = group.estimates.reduce((best, estimate) => (estimate.amount.gt(best.amount) ? estimate : best));
      // The same kind and amount read from a document and confirmed as an entry is one estimate, cited both ways.
      const same = group.estimates.filter((estimate) => estimate.amount.eq(largest.amount));
      const booked = rows.liabilities.filter((line) => line.kind === group.kind && (!group.asset || !line.assetId || line.assetId === group.asset.id));
      for (const line of booked) matched.add(line.id);
      const bookedTotal = booked.reduce((total, line) => total.plus(line.booked), new D(0));
      const gap = largest.amount.minus(bookedTotal);
      const status = !bookedTotal.gt(0) ? 'UNBOOKED' : gap.gt(bookedTotal.times(ENERGY_THRESHOLDS.aroMargin)) ? 'SHORTFALL' : 'COVERED';
      return {
        kind: group.kind,
        assetId: group.asset?.id ?? null,
        assetName: group.asset?.name ?? null,
        estimate: largest.amount,
        currency: same.find((estimate) => estimate.currency)?.currency ?? null,
        booked: bookedTotal,
        gap,
        status,
        estimateIds: same.flatMap((estimate) => (estimate.evidenceId ? [estimate.evidenceId] : [])),
        quotes: same.flatMap((estimate) => (estimate.quote ? [estimate.quote] : [])),
        bookedIds: booked.map((line) => line.id),
      } satisfies LiabilityLine;
    });
  return {
    lines,
    bookedTotal: rows.liabilities.reduce((total, line) => total.plus(line.booked), new D(0)),
    estimateTotal: lines.reduce((total, line) => total.plus(line.estimate), new D(0)),
    bookedOnly: rows.liabilities.filter((line) => !matched.has(line.id)),
  };
}

export interface PpaCliff {
  readonly plantId: string;
  readonly name: string;
  readonly evidenceId: string;
  readonly expiresOn: string;
  readonly counterparty: string | null;
  readonly trailingRevenue: Decimal;
  readonly contractedRevenue: Decimal;
  /** Contracted ÷ trailing revenue; null with no revenue on file. */
  readonly contractedShare: Decimal | null;
  readonly lineIds: readonly string[];
}

/** Plants whose PPA ends inside the hold: the contracted share of their revenue that turns merchant. */
export function ppaCliffs(rows: EnergyRows, production: ProductionModel, holdYears: number): PpaCliff[] {
  const date = production.analysisDate;
  if (!date) return [];
  const holdEnds = addYears(date, holdYears);
  return rows.plants.flatMap((plant): PpaCliff[] => {
    if (!plant.ppaExpiresOn || plant.ppaExpiresOn <= date || plant.ppaExpiresOn > holdEnds) return [];
    const asset = production.byAsset.get(plant.id);
    const trailing = asset?.trailingRevenue ?? new D(0);
    const contracted = asset?.contractedRevenue ?? new D(0);
    return [{ plantId: plant.id, name: plant.name, evidenceId: plant.evidenceId, expiresOn: plant.ppaExpiresOn, counterparty: plant.ppaCounterparty, trailingRevenue: trailing, contractedRevenue: contracted, contractedShare: trailing.gt(0) ? contracted.div(trailing) : null, lineIds: asset?.lineIds ?? [] }];
  });
}

/** Reserves and their discounted values by category, exactly as the confirmed report entries state them. */
export function reservesByCategory(rows: EnergyRows) {
  const categories = ['PDP', 'PDNP', 'PUD'] as const;
  return categories.map((category) => {
    const volumes = rows.reserves.filter((entry) => entry.category === category);
    const values = rows.reserveValues.filter((entry) => entry.category === category);
    return {
      category,
      volume: volumes.length ? volumes.reduce((total, entry) => total.plus(entry.volume), new D(0)) : null,
      value: values.length ? values.reduce((total, entry) => total.plus(entry.value), new D(0)) : null,
      ids: [...volumes, ...values].map((entry) => entry.id),
    };
  });
}

/** The decline the report assumes: a confirmed entry first, else the report's own sentence. */
export function assumedDecline(rows: EnergyRows, pages: readonly PackRulePage[]): { percent: Decimal; evidenceId: string | null; quote: PackRuleQuote | null } | null {
  const [entry] = rows.declines;
  if (entry) return { percent: entry.percent, evidenceId: entry.id, quote: null };
  const read = documentDecline(pages);
  return read ? { percent: read.percent, evidenceId: null, quote: read.quote } : null;
}
