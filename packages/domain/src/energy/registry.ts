/**
 * Energy generation & rights (T-142, ADR 0043): a buyer acquiring power plants, energy businesses
 * and oil & gas mineral, royalty and working interests. Two evidence families — generation assets
 * and oil & gas interests — share one title and liability core. This file is the registry of the
 * entries a person confirms from documents and the codes the imports use. Pactlab organises
 * evidence and flags gaps for the parties and their counsel and engineers: it is not legal,
 * engineering or regulatory advice, it makes no title determination and it certifies no reserves.
 */

/** Plant fuels the plant register uses. */
export const ENERGY_FUELS = ['coal', 'gas', 'wind', 'solar', 'hydro', 'storage', 'other'] as const;
export type EnergyFuel = (typeof ENERGY_FUELS)[number];

/** Oil & gas interest types; each has its own net-revenue-interest formula over the lease royalty chain. */
export const ENERGY_INTEREST_TYPES = ['working', 'mineral', 'royalty'] as const;
export type EnergyInterestType = (typeof ENERGY_INTEREST_TYPES)[number];

/** Production products: oil, gas and NGLs for interests (in BOE for the decline analysis), power for plants. */
export const ENERGY_PRODUCTS = ['oil', 'gas', 'ngl', 'power'] as const;
export type EnergyProduct = (typeof ENERGY_PRODUCTS)[number];

/** Environmental and retirement obligations, on the seller's schedule and in the evidence. */
export const ENERGY_LIABILITY_KINDS = ['remediation', 'ccr', 'reclamation', 'aro'] as const;
export type EnergyLiabilityKind = (typeof ENERGY_LIABILITY_KINDS)[number];
export const ENERGY_LIABILITY_LABELS = {
  remediation: 'Environmental remediation',
  ccr: 'Coal ash (CCR) closure',
  reclamation: 'Site reclamation',
  aro: 'Asset retirement / decommissioning',
} as const satisfies Record<EnergyLiabilityKind, string>;

/** Reserve categories as a third-party engineering report states them; the platform never estimates its own. */
export const ENERGY_RESERVE_CATEGORIES = ['PDP', 'PDNP', 'PUD'] as const;
export type EnergyReserveCategory = (typeof ENERGY_RESERVE_CATEGORIES)[number];
export const ENERGY_RESERVE_LABELS = {
  PDP: 'Proved developed producing',
  PDNP: 'Proved developed non-producing',
  PUD: 'Proved undeveloped',
} as const satisfies Record<EnergyReserveCategory, string>;

/**
 * Entries read from documents (`energy.extract`): AI proposes each with its exact quote; a person
 * confirms (optionally correcting) or rejects. Only CONFIRMED entries feed the reserves, decline and
 * liability models and the checks.
 */
export const ENERGY_ITEM_KINDS = ['RESERVES', 'RESERVE_VALUE', 'DECLINE_ASSUMPTION', 'LIABILITY_ESTIMATE'] as const;
export type EnergyItemKind = (typeof ENERGY_ITEM_KINDS)[number];

export interface EnergyItemDefinition {
  readonly label: string;
  /** What `value` holds. */
  readonly value: 'VOLUME' | 'MONEY' | 'PERCENT';
  /** What `detail` holds, and the codes it may take. */
  readonly detail: { readonly label: string; readonly codes: readonly string[] } | null;
  /** The evidence type a confirmed entry stands in for in the models and checks. */
  readonly evidenceType: string;
}

export const ENERGY_ITEM_REGISTRY = {
  RESERVES: { label: 'Reserves (third-party report)', value: 'VOLUME', detail: { label: 'Reserve category', codes: ENERGY_RESERVE_CATEGORIES }, evidenceType: 'energy.reserves' },
  RESERVE_VALUE: { label: 'Reserve value, discounted (third-party report)', value: 'MONEY', detail: { label: 'Reserve category', codes: ENERGY_RESERVE_CATEGORIES }, evidenceType: 'energy.reserve_value' },
  DECLINE_ASSUMPTION: { label: 'Annual decline the reserve report assumes', value: 'PERCENT', detail: null, evidenceType: 'energy.decline_assumption' },
  LIABILITY_ESTIMATE: { label: 'Liability estimate (report or permit)', value: 'MONEY', detail: { label: 'Obligation', codes: ENERGY_LIABILITY_KINDS }, evidenceType: 'energy.liability_estimate' },
} as const satisfies Record<EnergyItemKind, EnergyItemDefinition>;

export const ENERGY_ITEM_STATUSES = ['PROPOSED', 'CONFIRMED', 'REJECTED'] as const;
export type EnergyItemStatus = (typeof ENERGY_ITEM_STATUSES)[number];
export const ENERGY_ITEM_ORIGINS = ['AI', 'PERSON'] as const;
export type EnergyItemOrigin = (typeof ENERGY_ITEM_ORIGINS)[number];

// Thresholds, the default hold period and the decimal conventions live with the arithmetic
// (`@pactlab/calculations` packs/energy/assets.ts) and are returned with every result.

export const ENERGY_GUARDRAIL =
  'Diligence support only: not legal, engineering or regulatory advice. Pactlab makes no title determination and certifies no reserves — it organises the evidence and flags gaps for the parties and their counsel and engineers.';

/** Absence is shown as absence: production, reserves and liabilities come only from reports, permits and imports. */
export const ENERGY_NO_INVENTED_FIGURES =
  'Production, reserves and liability figures come only from reports, permits, schedules and imports. Reserve figures are the third-party engineering report’s, cited as such; a missing report is a gap finding, never an estimate.';
