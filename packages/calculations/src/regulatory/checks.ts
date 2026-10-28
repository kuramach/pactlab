import type Decimal from 'decimal.js';
import { D } from '../metrics/decimal';
import type { Commitment, DealCertaintyTerms, FeedbackRound, PackageRevision, RegFinding, RemedyBuyer, RemedyPackage, Site } from './types';

/**
 * The structural presumption of the 2023 Merger Guidelines (U.S. DOJ/FTC,
 * 18 December 2023, Guideline 1): post-merger HHI above 1,800 with a change
 * above 100, or a merged share above 30% with a change above 100.
 */
export const MERGER_GUIDELINES_2023 = {
  source: 'U.S. Department of Justice and Federal Trade Commission, Merger Guidelines (18 December 2023), Guideline 1',
  highlyConcentratedHhi: 1800,
  significantChange: 100,
  presumedShare: '0.30',
} as const;

const pct = (value: Decimal) => `${value.mul(100).toDecimalPlaces(1).toString()}%`;
const sum = (values: readonly Decimal[]) => values.reduce((total, value) => total.plus(value), new D(0));
const median = (values: readonly Decimal[]) => {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  if (sorted.length === 0) return new D(0);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as Decimal) : (sorted[mid - 1] as Decimal).plus(sorted[mid] as Decimal).div(2);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ------------------------------------------------------------------ Part 1: Pre screen

export interface MarketConcentration {
  readonly market: string;
  readonly hhiBefore: number;
  readonly hhiAfter: number;
  readonly delta: number;
  readonly mergedShare: string;
  /** Full-service competitors before and after the merger. */
  readonly firmsBefore: number;
  readonly firmsAfter: number;
  readonly presumed: boolean;
}

/** Per local market: HHI before and after, by full-service sales, and whether the 2023 presumption is met. National share never leads. */
export function localConcentration(sites: readonly Site[]): MarketConcentration[] {
  const markets = [...new Set(sites.map((site) => site.market))].sort();
  return markets.flatMap((market) => {
    const here = sites.filter((site) => site.market === market && site.fullService);
    const merging = here.filter((site) => site.party !== 'RIVAL');
    if (!here.some((site) => site.party === 'ACQUIRER') || !here.some((site) => site.party === 'TARGET')) return [];
    const total = sum(here.map((site) => new D(site.sales)));
    if (total.lte(0)) return [];
    const byFirm = (rows: readonly Site[], merged: boolean) => {
      const totals = new Map<string, Decimal>();
      for (const site of rows) {
        const firm = merged && site.party !== 'RIVAL' ? 'MERGED' : `${site.party}:${site.firm}`;
        totals.set(firm, (totals.get(firm) ?? new D(0)).plus(site.sales));
      }
      return totals;
    };
    const hhi = (totals: Map<string, Decimal>) => sum([...totals.values()].map((sales) => sales.div(total).mul(100).pow(2))).toDecimalPlaces(0).toNumber();
    const before = byFirm(here, false);
    const after = byFirm(here, true);
    const hhiBefore = hhi(before);
    const hhiAfter = hhi(after);
    const delta = hhiAfter - hhiBefore;
    const mergedShare = sum(merging.map((site) => new D(site.sales))).div(total);
    const g = MERGER_GUIDELINES_2023;
    const presumed = delta > g.significantChange && (hhiAfter > g.highlyConcentratedHhi || mergedShare.gt(g.presumedShare));
    return [{ market, hhiBefore, hhiAfter, delta, mergedShare: mergedShare.toDecimalPlaces(4).toString(), firmsBefore: before.size, firmsAfter: after.size, presumed }];
  });
}

/** Overlap pockets: local markets where the merger meets the presumption — and those where the pair are the only full-service competitors. */
export function overlapPockets(sites: readonly Site[]): RegFinding[] {
  const markets = localConcentration(sites);
  const presumed = markets.filter((market) => market.presumed);
  if (presumed.length === 0) return [];
  const monopolies = presumed.filter((market) => market.firmsAfter === 1).map((market) => market.market);
  return [
    {
      check: 'overlap-pockets',
      phase: 'PRE',
      title: `Overlap pockets in ${presumed.length} local markets`,
      description:
        `In ${presumed.length} of ${markets.length} overlapping local markets the merger meets the structural presumption of the 2023 Merger Guidelines (post-merger HHI above 1,800 with a rise above 100, or a share above 30%).` +
        (monopolies.length > 0 ? ` In ${monopolies.length} of them the two parties are the only full-service competitors: ${monopolies.join(', ')}.` : ''),
      severity: monopolies.length > 0 || presumed.length >= 10 ? 'CRITICAL' : 'HIGH',
      direction: -1,
      inputs: {
        source: MERGER_GUIDELINES_2023.source,
        presumedMarkets: presumed.map((market) => market.market),
        onlyFullServiceCompetitors: monopolies,
        overlappingMarkets: markets.length,
      },
    },
  ];
}

/** Labor as a theory of harm: union density and shared bargaining agreements in the markets where the parties overlap. */
export function laborExposure(sites: readonly Site[], options: { densityThreshold?: string; minMarkets?: number } = {}): RegFinding[] {
  const threshold = new D(options.densityThreshold ?? '0.5');
  const overlap = localConcentration(sites).filter((market) => market.presumed).map((market) => market.market);
  const exposed = overlap.filter((market) => {
    const merging = sites.filter((site) => site.market === market && site.party !== 'RIVAL');
    const density = new D(merging.filter((site) => site.unionized).length).div(Math.max(merging.length, 1));
    const sharedCba = new Set(merging.filter((site) => site.party === 'ACQUIRER' && site.cbaId).map((site) => site.cbaId));
    const overlapping = merging.some((site) => site.party === 'TARGET' && site.cbaId && sharedCba.has(site.cbaId));
    return density.gte(threshold) && overlapping;
  });
  if (exposed.length < (options.minMarkets ?? 3)) return [];
  return [
    {
      check: 'labor-exposure',
      phase: 'PRE',
      title: `Labor-market overlap in ${exposed.length} markets`,
      description: `In ${exposed.length} overlap markets most of the parties' sites are unionized and both parties' workers bargain under the same agreements — a labor-market theory of harm (fewer employers for the same workers) regulators have run in grocery.`,
      severity: 'HIGH',
      direction: -1,
      inputs: { markets: exposed, densityThreshold: threshold.toString() },
    },
  ];
}

// ------------------------------------------------------------------ Part 2: remedy workbench

/** Unused headroom: the package against the divestiture cap the agreement allows. */
export function headroom(terms: DealCertaintyTerms, remedy: RemedyPackage, options: { minimumUnused?: string } = {}): RegFinding[] {
  const offered = remedy.siteIds.length;
  const unused = terms.divestitureCap - offered;
  const share = new D(unused).div(terms.divestitureCap);
  if (unused <= 0 || share.lt(options.minimumUnused ?? '0.05')) return [];
  return [
    {
      check: 'unused-headroom',
      phase: 'DILIGENCE',
      title: `Package leaves ${unused} sites of divestiture headroom unused`,
      description: `The agreement allows divesting up to ${terms.divestitureCap} sites; the package offers ${offered}. ${unused} sites (${pct(share)}) of the room the parties agreed to spend on clearance is unspent — regulators read an unused cap as a remedy sized to the buyer's preference, not to the harm.`,
      severity: share.gte('0.1') ? 'HIGH' : 'MEDIUM',
      direction: -1,
      inputs: { cap: terms.divestitureCap, offered, unused, capSource: terms.sources['divestitureCap'] ?? '' },
    },
  ];
}

/** Cherry-pick test: does the divested set perform materially worse than what the acquirer keeps in the same markets? */
export function cherryPick(sites: readonly Site[], remedy: RemedyPackage, options: { gap?: string } = {}): RegFinding[] {
  const divested = new Set(remedy.siteIds);
  const markets = new Set(sites.filter((site) => divested.has(site.siteId)).map((site) => site.market));
  const kept = sites.filter((site) => site.party !== 'RIVAL' && markets.has(site.market) && !divested.has(site.siteId));
  const sold = sites.filter((site) => divested.has(site.siteId));
  if (sold.length === 0 || kept.length === 0) return [];
  const soldMedian = median(sold.map((site) => new D(site.performance)));
  const keptMedian = median(kept.map((site) => new D(site.performance)));
  if (keptMedian.lte(0)) return [];
  const shortfall = new D(1).minus(soldMedian.div(keptMedian));
  if (shortfall.lt(options.gap ?? '0.1')) return [];
  return [
    {
      check: 'cherry-pick',
      phase: 'DILIGENCE',
      title: 'Divested sites perform materially worse than those kept',
      description: `In the markets the package touches, the median divested site's performance is ${soldMedian.toDecimalPlaces(4).toString()} against ${keptMedian.toDecimalPlaces(4).toString()} for the sites the parties keep — ${pct(shortfall)} weaker. A package skewed to weaker sites is read as setting the buyer up to fail.`,
      severity: shortfall.gte('0.2') ? 'HIGH' : 'MEDIUM',
      direction: -1,
      inputs: { divestedSites: sold.length, keptSites: kept.length, divestedMedian: soldMedian.toString(), keptMedian: keptMedian.toString() },
    },
  ];
}

export interface CoherenceScore {
  readonly score: number;
  readonly banners: number;
  /** Share of divested sites whose distribution center moves with them. */
  readonly distributionCovered: string;
  readonly systemsCovered: string;
  /** Regions where the package mixes banners and brings no distribution center. */
  readonly patchworkRegions: readonly string[];
}

/** Can the package stand alone as an operating business? Scored 0–100 from distribution, systems, banners and clustering. Every input is shown. */
export function coherence(sites: readonly Site[], remedy: RemedyPackage): CoherenceScore {
  const divested = new Set(remedy.siteIds);
  const sold = sites.filter((site) => divested.has(site.siteId));
  if (sold.length === 0) return { score: 100, banners: 0, distributionCovered: '1', systemsCovered: '1', patchworkRegions: [] };
  const dcs = new Set(remedy.distributionCenters);
  const systems = new Set(remedy.systemsTransferred);
  const distribution = new D(sold.filter((site) => dcs.has(site.distributionCenter)).length).div(sold.length);
  const systemsShare = new D(sold.filter((site) => systems.has(site.systems)).length).div(sold.length);
  const banners = new Set(sold.map((site) => site.banner)).size;
  const regions = [...new Set(sold.map((site) => site.region))].sort();
  const patchworkRegions = regions.filter((region) => {
    const here = sold.filter((site) => site.region === region);
    return new Set(here.map((site) => site.banner)).size > 1 && !here.some((site) => dcs.has(site.distributionCenter));
  });
  const clustering = new D(1).minus(new D(patchworkRegions.length).div(Math.max(regions.length, 1)));
  const bannerScore = new D(1).div(banners);
  const score = distribution.mul(35).plus(systemsShare.mul(25)).plus(clustering.mul(25)).plus(bannerScore.mul(15)).toDecimalPlaces(0).toNumber();
  return { score, banners, distributionCovered: distribution.toDecimalPlaces(4).toString(), systemsCovered: systemsShare.toDecimalPlaces(4).toString(), patchworkRegions };
}

export function incoherentPackage(sites: readonly Site[], remedy: RemedyPackage, options: { threshold?: number } = {}): RegFinding[] {
  const result = coherence(sites, remedy);
  if (result.score >= (options.threshold ?? 60)) return [];
  return [
    {
      check: 'incoherent-package',
      phase: 'DILIGENCE',
      title: `Divestiture package scores ${result.score}/100 for coherence`,
      description: `The package spans ${result.banners} banners; ${pct(new D(result.distributionCovered))} of its sites keep their distribution center and ${pct(new D(result.systemsCovered))} their store systems. In ${result.patchworkRegions.length} regions it mixes banners with no distribution behind them: ${result.patchworkRegions.join(', ')}. A patchwork has to be stitched into a business by the buyer — the risk regulators reject.`,
      severity: result.score < 40 ? 'HIGH' : 'MEDIUM',
      direction: -1,
      inputs: { score: result.score, banners: result.banners, distributionCovered: result.distributionCovered, systemsCovered: result.systemsCovered, patchworkRegions: result.patchworkRegions },
    },
  ];
}

/** The remedy buyer assessed like any counterparty: operating record in this business, at this scale, and precedent. */
export function buyerViability(buyer: RemedyBuyer, remedy: RemedyPackage, options: { minimumScale?: string } = {}): RegFinding[] {
  const scale = new D(buyer.retailSitesOperated).div(Math.max(remedy.siteIds.length, 1));
  const thin = scale.lt(options.minimumScale ?? '0.25');
  if (!thin && buyer.precedents.length === 0) return [];
  return [
    {
      check: 'buyer-viability',
      phase: 'DILIGENCE',
      title: `${buyer.name} has a thin record running stores at this scale`,
      description:
        `${buyer.name} runs ${buyer.retailSitesOperated} retail sites today and would take on ${remedy.siteIds.length} (${pct(scale)} of the package's size in its existing retail operation).` +
        (buyer.precedents.length > 0 ? ` Precedent: ${buyer.precedents.map((precedent) => `${precedent.year} — ${precedent.note}`).join('; ')}.` : ''),
      severity: thin && buyer.precedents.length > 0 ? 'CRITICAL' : 'HIGH',
      direction: -1,
      inputs: { retailSitesOperated: buyer.retailSitesOperated, packageSites: remedy.siteIds.length, yearsOperatingRetail: buyer.yearsOperatingRetail, precedentSources: buyer.precedents.map((precedent) => precedent.source) },
    },
  ];
}

/** Regulator feedback that no later package revision answered, aging visibly. */
export function unaddressedFeedback(rounds: readonly FeedbackRound[], revisions: readonly PackageRevision[], asOf: string): RegFinding[] {
  const open = rounds.flatMap((round) =>
    round.criticisms
      .filter((criticism) => !revisions.some((revision) => revision.date > round.date && revision.addresses.includes(criticism.topic)))
      .map((criticism) => ({ round, criticism, revisionsSince: revisions.filter((revision) => revision.date > round.date).length })),
  );
  return open.map(({ round, criticism, revisionsSince }) => ({
    check: 'unaddressed-feedback',
    phase: 'DILIGENCE',
    title: `Regulator feedback round ${round.round} unanswered for ${daysBetween(round.date, asOf)} days`,
    description: `${round.regulator}, ${round.date}: “${criticism.substance}” (${criticism.topic.toLowerCase()}). ${revisionsSince} package revision${revisionsSince === 1 ? '' : 's'} since; none addresses it.`,
    severity: daysBetween(round.date, asOf) > 90 ? 'HIGH' : 'MEDIUM',
    direction: -1,
    inputs: { round: round.round, topic: criticism.topic, raisedOn: round.date, revisionsSince, daysOpen: daysBetween(round.date, asOf) },
  }));
}

// ------------------------------------------------------------------ Part 3: covenants

export interface CertaintyStatus {
  readonly elapsedDays: number;
  readonly daysToOutsideDate: number;
  /** Termination fees each side could pay, by payer, decimal strings. */
  readonly feeExposure: Readonly<Record<'ACQUIRER' | 'TARGET', string>>;
}

export function certaintyStatus(terms: DealCertaintyTerms, asOf: string): CertaintyStatus {
  const exposure = (payer: 'ACQUIRER' | 'TARGET') => sum(terms.terminationFees.filter((fee) => fee.payer === payer).map((fee) => new D(fee.amount))).toString();
  return {
    elapsedDays: daysBetween(terms.signedOn, asOf),
    daysToOutsideDate: daysBetween(asOf, terms.outsideDate),
    feeExposure: { ACQUIRER: exposure('ACQUIRER'), TARGET: exposure('TARGET') },
  };
}

// ------------------------------------------------------------------ Part 4: commitment quality

export type CommitmentGrade = 'VERIFIABLE' | 'PARTIAL' | 'UNVERIFIABLE';

/** Is there a way to measure it, someone to enforce it, and a term? A pledge with none earns no credit with a regulator. */
export function gradeCommitment(commitment: Commitment): CommitmentGrade {
  const parts = [commitment.measurement, commitment.enforcementParty, commitment.durationMonths].filter((part) => part !== null && part !== '').length;
  if (parts === 3) return 'VERIFIABLE';
  return commitment.measurement === null && commitment.enforcementParty === null ? 'UNVERIFIABLE' : 'PARTIAL';
}

export function unverifiablePledges(commitments: readonly Commitment[]): RegFinding[] {
  return commitments
    .filter((commitment) => gradeCommitment(commitment) === 'UNVERIFIABLE')
    .map((commitment) => ({
      check: 'unverifiable-pledge',
      phase: 'DILIGENCE',
      title: 'Pledge with no measurement or enforcement',
      description: `“${commitment.text}” — no measurement mechanism, no party who can enforce it${commitment.durationMonths ? `, ${commitment.durationMonths} months` : ', no term'}. A pledge like this earns no credit with a regulator and should not be counted on.`,
      severity: 'MEDIUM',
      direction: -1,
      inputs: { commitment: commitment.id },
    }));
}
