import type { PackId } from './packs/registry';

/**
 * Foresight (T-073; codename Nostradamus — never user-facing): five-year
 * trend lines for a deal, the user's own scenarios layered on top, and the
 * projected value of the business under those assumptions. Trend lines are
 * structured objects, not paragraphs. The AI proposes direction, size band
 * and confidence only; every number comes from a versioned impact table.
 */
export const TREND_DIRECTIONS = ['UP', 'FLAT', 'DOWN'] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];
export const TREND_MAGNITUDES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TrendMagnitude = (typeof TREND_MAGNITUDES)[number];
export const TREND_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TrendConfidence = (typeof TREND_CONFIDENCES)[number];
export const TREND_PROVENANCES = ['AI', 'USER'] as const;
export type TrendProvenance = (typeof TREND_PROVENANCES)[number];

/** What a trend moves in the value of the business. */
export const VALUE_LEVERS = ['GROWTH', 'MARGIN', 'MULTIPLE', 'DISCOUNT_RATE'] as const;
export type ValueLever = (typeof VALUE_LEVERS)[number];

export interface TrendDefinition {
  /** Stable key, e.g. `macro.rates` or `multifamily.rent_growth`. */
  readonly key: string;
  readonly label: string;
  readonly category: 'MACRO' | 'SECTOR';
  /** The question the trend answers, as the model is asked it. */
  readonly question: string;
  /** How the trend moving UP affects each lever (+1 raises the lever, −1 lowers it). DOWN is the opposite. */
  readonly effects: readonly { readonly lever: ValueLever; readonly whenUp: 1 | -1 }[];
}

/** The baseline set every pact gets: the macro questions that move any business. */
export const GENERIC_TRENDS: readonly TrendDefinition[] = [
  { key: 'macro.geopolitical', label: 'Geopolitical conflict', category: 'MACRO', question: 'Over five years, does geopolitical conflict affecting this business rise, hold or ease?', effects: [{ lever: 'GROWTH', whenUp: -1 }, { lever: 'DISCOUNT_RATE', whenUp: 1 }] },
  { key: 'macro.rates', label: 'Inflation and interest rates', category: 'MACRO', question: 'Over five years, do inflation and policy interest rates rise, hold or fall?', effects: [{ lever: 'DISCOUNT_RATE', whenUp: 1 }, { lever: 'MARGIN', whenUp: -1 }] },
  { key: 'macro.trade', label: 'Trade and tariffs', category: 'MACRO', question: 'Over five years, do trade barriers and tariffs that touch this business rise, hold or fall?', effects: [{ lever: 'MARGIN', whenUp: -1 }, { lever: 'GROWTH', whenUp: -1 }] },
  { key: 'macro.regulation', label: 'Government and regulatory posture', category: 'MACRO', question: 'Over five years, does regulation of this sector tighten, hold or loosen?', effects: [{ lever: 'MARGIN', whenUp: -1 }] },
  { key: 'macro.market', label: 'Equity and credit market cycle', category: 'MACRO', question: 'Over five years, do equity and credit markets that set exit prices strengthen, hold or weaken?', effects: [{ lever: 'MULTIPLE', whenUp: 1 }] },
];

const sector = (key: string, label: string, question: string, effects: TrendDefinition['effects']): TrendDefinition => ({ key, label, category: 'SECTOR', question, effects });

/** Each pack's own questions (ADR 0008 packs); a pack without any uses the generic set alone. */
export const PACK_TRENDS: Readonly<Partial<Record<PackId, readonly TrendDefinition[]>>> = {
  SOFTWARE_SAAS: [
    sector('saas.it_spend', 'Enterprise software spend', 'Over five years, does customer spending on software like this grow faster, hold or slow?', [{ lever: 'GROWTH', whenUp: 1 }]),
    sector('saas.ai_disruption', 'AI substitution risk', 'Over five years, does AI substitution pressure on this product rise, hold or fall?', [{ lever: 'GROWTH', whenUp: -1 }, { lever: 'MULTIPLE', whenUp: -1 }]),
  ],
  FINTECH: [
    sector('fintech.regulation', 'Financial regulation posture', 'Over five years, does financial-services regulation for this model tighten, hold or loosen?', [{ lever: 'MARGIN', whenUp: -1 }, { lever: 'MULTIPLE', whenUp: -1 }]),
    sector('fintech.credit', 'Credit losses', 'Over five years, do credit losses in this lending segment rise, hold or fall?', [{ lever: 'MARGIN', whenUp: -1 }]),
  ],
  MULTIFAMILY: [
    sector('multifamily.supply', 'Housing supply', 'Over five years, does new rental housing supply in this market rise, hold or fall?', [{ lever: 'GROWTH', whenUp: -1 }]),
    sector('multifamily.rent_growth', 'Rent growth', 'Over five years, does market rent growth accelerate, hold or slow?', [{ lever: 'GROWTH', whenUp: 1 }]),
    sector('multifamily.cap_rates', 'Cap rates', 'Over five years, do cap rates for this property type rise, hold or fall?', [{ lever: 'MULTIPLE', whenUp: -1 }]),
  ],
  HOTELS: [
    sector('hotels.travel_demand', 'Travel demand', 'Over five years, does travel demand for this market grow, hold or decline?', [{ lever: 'GROWTH', whenUp: 1 }]),
    sector('hotels.labor', 'Labor costs', 'Over five years, do hotel labor costs rise, hold or fall?', [{ lever: 'MARGIN', whenUp: -1 }]),
  ],
  HEALTHCARE: [sector('healthcare.reimbursement', 'Reimbursement policy', 'Over five years, do reimbursement rates for these services rise, hold or fall?', [{ lever: 'GROWTH', whenUp: 1 }, { lever: 'MARGIN', whenUp: 1 }])],
  SMALL_CLINICS: [sector('healthcare.reimbursement', 'Reimbursement policy', 'Over five years, do reimbursement rates for these services rise, hold or fall?', [{ lever: 'GROWTH', whenUp: 1 }, { lever: 'MARGIN', whenUp: 1 }])],
  HOSPITALS: [sector('healthcare.reimbursement', 'Reimbursement policy', 'Over five years, do reimbursement rates for these services rise, hold or fall?', [{ lever: 'GROWTH', whenUp: 1 }, { lever: 'MARGIN', whenUp: 1 }])],
  // Funding-market climate for the founder's timing question (T-083): scenarios, never a prophecy.
  VENTURE_RAISE: [
    sector('venture.deployment', 'Venture deployment pace', 'Over five years, does venture capital deployment into companies at this stage rise, hold or fall?', [{ lever: 'MULTIPLE', whenUp: 1 }, { lever: 'GROWTH', whenUp: 1 }]),
    sector('venture.round_pricing', 'Seed and Series A pricing', 'Over five years, do median seed and Series A pre-money valuations rise, hold or fall?', [{ lever: 'MULTIPLE', whenUp: 1 }]),
    sector('venture.exit_window', 'IPO and acquisition window', 'Over five years, do IPO and acquisition exits for venture-backed companies open up, hold or close?', [{ lever: 'MULTIPLE', whenUp: 1 }]),
    sector('venture.down_rounds', 'Down rounds and bridges', 'Over five years, do down rounds and bridge rounds become more common, hold or become rarer?', [{ lever: 'MULTIPLE', whenUp: -1 }, { lever: 'DISCOUNT_RATE', whenUp: 1 }]),
    sector('venture.sector_heat', 'Sector heat (including the AI premium)', 'Over five years, does investor appetite for this sector, including any AI premium, rise, hold or fall?', [{ lever: 'MULTIPLE', whenUp: 1 }]),
  ],
  COMMERCIAL_PROPERTY: [sector('commercial.occupancy', 'Office and retail occupancy', 'Over five years, does occupancy for this property type rise, hold or fall?', [{ lever: 'GROWTH', whenUp: 1 }])],
};

/** The trend questions for a deal of this pack: the generic set plus the pack's own. */
export function trendDefinitionsFor(pack: PackId | null): readonly TrendDefinition[] {
  return [...GENERIC_TRENDS, ...(pack ? (PACK_TRENDS[pack] ?? []) : [])];
}

/** A trend line as stored and shown: always dated, versioned and labelled by provenance. */
export interface TrendLine {
  readonly key: string;
  readonly label: string;
  readonly category: 'MACRO' | 'SECTOR' | 'CUSTOM';
  readonly direction: TrendDirection;
  readonly magnitude: TrendMagnitude;
  readonly confidence: TrendConfidence;
  readonly narrative: string;
  readonly provenance: TrendProvenance;
  /** Custom trends name their levers; defined trends take theirs from the definition. */
  readonly effects: readonly { readonly lever: ValueLever; readonly whenUp: 1 | -1 }[];
  /** 0–2: how much this trend counts in a scenario (1 = as is). */
  readonly weight: string;
}
