/**
 * Regulatory & deal certainty (T-091). Deterministic checks over structured
 * deal inputs: no probability of clearance, no outcome prediction — each check
 * shows its inputs and states what it found. Every amount is a decimal string.
 */

export type RegPhase = 'PRE' | 'DILIGENCE';
export type RegSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** One site of either merging party or a rival, in one local market. */
export interface Site {
  readonly siteId: string;
  /** ACQUIRER and TARGET are the merging parties; anything else is a rival. */
  readonly party: 'ACQUIRER' | 'TARGET' | 'RIVAL';
  /** The rival's name (or the party's banner group) — shares are by firm. */
  readonly firm: string;
  readonly market: string;
  readonly region: string;
  readonly banner: string;
  /** Only full-service sites compete in the relevant market (a pack setting). */
  readonly fullService: boolean;
  /** Annual sales, decimal string. Shares are computed from it. */
  readonly sales: string;
  /** A performance measure for the cherry-pick test (e.g. EBITDA margin), decimal string. */
  readonly performance: string;
  readonly unionized: boolean;
  /** Collective bargaining agreement id, when unionized. */
  readonly cbaId: string | null;
  readonly distributionCenter: string;
  readonly systems: string;
}

/** A divestiture (remedy) package: which sites move, and to whom. */
export interface RemedyPackage {
  readonly id: string;
  readonly revision: number;
  readonly date: string;
  readonly siteIds: readonly string[];
  /** Distribution centers and systems transferred with the sites. */
  readonly distributionCenters: readonly string[];
  readonly systemsTransferred: readonly string[];
  readonly buyer: string;
}

export interface RemedyBuyer {
  readonly name: string;
  /** Retail sites the buyer runs today in this business. */
  readonly retailSitesOperated: number;
  readonly yearsOperatingRetail: number;
  /** Prior remedies involving this buyer or a party that failed, with a short source-cited note. */
  readonly precedents: readonly { readonly year: number; readonly note: string; readonly source: string }[];
}

/** The merger agreement's deal-certainty terms (Part 3). */
export interface DealCertaintyTerms {
  readonly signedOn: string;
  readonly outsideDate: string;
  readonly effortsStandard: 'REASONABLE_BEST_EFFORTS' | 'HELL_OR_HIGH_WATER' | 'COMMERCIALLY_REASONABLE';
  /** The most sites the acquirer must divest to obtain clearance (the divestiture cap). */
  readonly divestitureCap: number;
  readonly currency: string;
  readonly terminationFees: readonly { readonly payer: 'ACQUIRER' | 'TARGET'; readonly amount: string; readonly trigger: string }[];
  /** Where each term is stated in the agreement (citations). */
  readonly sources: Readonly<Record<string, string>>;
}

/** One round of regulator feedback on the remedy. */
export interface FeedbackRound {
  readonly round: number;
  readonly date: string;
  readonly regulator: string;
  /** Criticisms by topic (e.g. COHERENCE, CHERRY_PICK, BUYER, SIZE). */
  readonly criticisms: readonly { readonly topic: string; readonly substance: string }[];
}

/** A package revision answers some feedback topics. */
export interface PackageRevision {
  readonly revision: number;
  readonly date: string;
  readonly addresses: readonly string[];
}

/** A pledge made to regulators or the counterparty (Part 4). */
export interface Commitment {
  readonly id: string;
  readonly text: string;
  readonly measurement: string | null;
  readonly enforcementParty: string | null;
  readonly durationMonths: number | null;
}

/** What a check surfaced: the defect, its phase, and the numbers behind it. */
export interface RegFinding {
  /** Stable id of the check that raised it (the findings-key item it maps to). */
  readonly check: string;
  readonly phase: RegPhase;
  readonly title: string;
  readonly description: string;
  readonly severity: RegSeverity;
  /** Deal risk always works against price or certainty here. */
  readonly direction: -1;
  /** The inputs the reader can check (market names, counts, ratios). */
  readonly inputs: Readonly<Record<string, string | number | readonly string[]>>;
}
