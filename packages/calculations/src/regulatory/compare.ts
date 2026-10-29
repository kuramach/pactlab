import type Decimal from 'decimal.js';
import { D } from '../metrics/decimal';
import { buyerViability, cherryPick, coherence, headroom, incoherentPackage, localConcentration, type CoherenceScore } from './checks';
import type { DealCertaintyTerms, RegFinding, RemedyBuyer, RemedyPackage, Site } from './types';

/**
 * Candidate remedy packages side by side (T-091 Part 2, scenario builder).
 * Every candidate — an imported revision or an analyst-built scenario — runs
 * through the same deterministic checks, plus the one question a package
 * exists to answer: after the divested sites pass to the remedy buyer, which
 * overlap markets still meet the 2023 presumption? No probabilities; each
 * column shows its numbers.
 */

/** The footprint after divestiture: the package's sites belong to the remedy buyer, a rival of the merged firm. */
export function afterDivestiture(sites: readonly Site[], remedy: RemedyPackage): Site[] {
  const divested = new Set(remedy.siteIds);
  const buyer = remedy.buyer || 'REMEDY BUYER';
  return sites.map((site) => (divested.has(site.siteId) ? { ...site, party: 'RIVAL' as const, firm: buyer } : site));
}

/** Overlap markets that still meet the presumption once the package is divested. */
export function residualPresumed(sites: readonly Site[], remedy: RemedyPackage): string[] {
  return localConcentration(afterDivestiture(sites, remedy))
    .filter((market) => market.presumed)
    .map((market) => market.market);
}

const earnings = (sites: readonly Site[], remedy: RemedyPackage): Decimal => {
  const divested = new Set(remedy.siteIds);
  return sites.filter((site) => divested.has(site.siteId)).reduce((total: Decimal, site) => total.plus(new D(site.sales).mul(site.performance)), new D(0));
};

/** Annual earnings of the divested sites (sales × performance margin), a whole-unit decimal string. */
export function divestedEarnings(sites: readonly Site[], remedy: RemedyPackage): string {
  return earnings(sites, remedy).toDecimalPlaces(0).toString();
}

/** Value given up to clear: divested earnings × the analyst's multiple, rounded once, a decimal string. */
export function remedyCost(sites: readonly Site[], remedy: RemedyPackage, multiple: string): string {
  return earnings(sites, remedy).mul(multiple).toDecimalPlaces(0).toString();
}

/** The largest fee the acquirer could owe if clearance fails, a decimal string ('0' when none). */
export function acquirerFeeExposure(terms: DealCertaintyTerms): string {
  return terms.terminationFees
    .filter((fee) => fee.payer === 'ACQUIRER')
    .reduce((max: Decimal, fee) => D.max(max, new D(fee.amount)), new D(0))
    .toString();
}

export type PackageVerdict = 'RESOLVES' | 'RESOLVES_WITH_DEFECTS' | 'LEAVES_OVERLAP';

export interface PackageComparison {
  readonly id: string;
  readonly label: string;
  readonly sites: number;
  /** Presumed overlap markets before any remedy. */
  readonly presumedBefore: number;
  /** Markets still presumed after this package is divested. */
  readonly residualPresumed: readonly string[];
  /** Cap minus sites offered; null without terms. Negative when the package exceeds the cap. */
  readonly unusedHeadroom: number | null;
  readonly coherence: CoherenceScore;
  readonly divestedEarnings: string;
  /** Null without an analyst multiple. */
  readonly remedyCost: string | null;
  /** The workbench checks this package trips. */
  readonly defects: readonly RegFinding[];
  /**
   * LEAVES_OVERLAP when a presumed market survives the package; otherwise
   * RESOLVES_WITH_DEFECTS when any workbench check fires, else RESOLVES.
   * A description of the inputs, never a prediction of clearance.
   */
  readonly verdict: PackageVerdict;
}

export function comparePackages(input: {
  readonly sites: readonly Site[];
  readonly candidates: readonly { readonly label: string; readonly remedy: RemedyPackage }[];
  readonly terms?: DealCertaintyTerms | null;
  readonly buyer?: RemedyBuyer | null;
  readonly multiple?: string | null;
}): PackageComparison[] {
  const presumedBefore = localConcentration(input.sites).filter((market) => market.presumed).length;
  return input.candidates.map(({ label, remedy }) => {
    const residual = residualPresumed(input.sites, remedy);
    const defects = [
      ...(input.terms ? headroom(input.terms, remedy) : []),
      ...(input.terms && remedy.siteIds.length > input.terms.divestitureCap ? [overCap(input.terms, remedy)] : []),
      ...cherryPick(input.sites, remedy),
      ...incoherentPackage(input.sites, remedy),
      ...(input.buyer ? buyerViability(input.buyer, remedy) : []),
    ];
    return {
      id: remedy.id,
      label,
      sites: remedy.siteIds.length,
      presumedBefore,
      residualPresumed: residual,
      unusedHeadroom: input.terms ? input.terms.divestitureCap - remedy.siteIds.length : null,
      coherence: coherence(input.sites, remedy),
      divestedEarnings: divestedEarnings(input.sites, remedy),
      remedyCost: input.multiple ? remedyCost(input.sites, remedy, input.multiple) : null,
      defects,
      verdict: residual.length > 0 ? 'LEAVES_OVERLAP' : defects.length > 0 ? 'RESOLVES_WITH_DEFECTS' : 'RESOLVES',
    };
  });
}

/** A package beyond the cap is outside what the acquirer agreed to give up: the agreement's certainty terms apply. */
function overCap(terms: DealCertaintyTerms, remedy: RemedyPackage): RegFinding {
  const over = remedy.siteIds.length - terms.divestitureCap;
  return {
    check: 'over-cap',
    phase: 'DILIGENCE',
    title: `Package exceeds the divestiture cap by ${over} sites`,
    description: `The agreement caps divestitures at ${terms.divestitureCap} sites; this package offers ${remedy.siteIds.length}. Beyond the cap the acquirer is not bound to divest, so the package needs the parties' agreement — and the termination-fee terms decide who bears the cost if they do not agree.`,
    severity: 'HIGH',
    direction: -1,
    inputs: { cap: terms.divestitureCap, offered: remedy.siteIds.length, over, capSource: terms.sources['divestitureCap'] ?? '' },
  };
}

/**
 * Build a scenario from a base package: add every merging-party site of the
 * chosen party in the named markets, add and remove named sites. The result
 * is an explicit site list — what is stored and compared — so a scenario
 * never changes after the footprint is re-imported.
 */
export function buildScenario(input: {
  readonly sites: readonly Site[];
  readonly id: string;
  readonly base: RemedyPackage | null;
  readonly buyer: string;
  readonly addMarkets: readonly string[];
  /** Which party's sites the market rule divests. */
  readonly divestingParty: 'ACQUIRER' | 'TARGET';
  readonly addSites: readonly string[];
  readonly removeSites: readonly string[];
  /** Transfer the distribution centers and systems of every site in the package. */
  readonly transferOperations: boolean;
}): { remedy: RemedyPackage; unknownSites: string[] } {
  const known = new Map(input.sites.map((site) => [site.siteId, site]));
  const markets = new Set(input.addMarkets);
  const chosen = new Set(input.base?.siteIds ?? []);
  for (const site of input.sites) if (markets.has(site.market) && site.party === input.divestingParty && site.fullService) chosen.add(site.siteId);
  const unknownSites = [...input.addSites, ...input.removeSites].filter((id) => !known.has(id));
  for (const id of input.addSites) if (known.has(id) && known.get(id)?.party !== 'RIVAL') chosen.add(id);
  for (const id of input.removeSites) chosen.delete(id);
  const siteIds = [...chosen].filter((id) => known.has(id)).sort();
  const sold = siteIds.map((id) => known.get(id) as Site);
  const distributionCenters = input.transferOperations
    ? [...new Set(sold.map((site) => site.distributionCenter))].filter(Boolean).sort()
    : (input.base?.distributionCenters ?? []).filter((dc) => sold.some((site) => site.distributionCenter === dc));
  const systemsTransferred = input.transferOperations
    ? [...new Set(sold.map((site) => site.systems))].filter(Boolean).sort()
    : (input.base?.systemsTransferred ?? []).filter((system) => sold.some((site) => site.systems === system));
  return {
    remedy: { id: input.id, revision: input.base?.revision ?? 0, date: '', siteIds, distributionCenters, systemsTransferred, buyer: input.buyer },
    unknownSites,
  };
}
