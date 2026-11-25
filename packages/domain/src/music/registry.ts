/**
 * Music rights (T-140, ADR 0041): a buyer acquiring music publishing and master recording rights.
 * This file is the registry of the catalog's register entries a person confirms from documents
 * and the income sources statements report. Pactlab organises evidence and flags gaps for the
 * parties and their counsel: it is not legal advice, and it makes no determination that title is
 * good or that a termination notice is valid.
 */

/** Where statement income comes from. */
export const MUSIC_INCOME_SOURCES = ['performance', 'mechanical', 'sync', 'neighbouring', 'streaming'] as const;
export type MusicIncomeSource = (typeof MUSIC_INCOME_SOURCES)[number];
export const MUSIC_INCOME_SOURCE_LABELS = {
  performance: 'Performance',
  mechanical: 'Mechanical',
  sync: 'Sync',
  neighbouring: 'Neighbouring rights',
  streaming: 'Streaming',
} as const satisfies Record<MusicIncomeSource, string>;

/** A grant in the chain of title. Registrations and assignments evidence title; licences and admin grants do not transfer it. */
export const MUSIC_GRANT_TYPES = ['registration', 'assignment', 'license', 'administration', 'work_for_hire'] as const;
export type MusicGrantType = (typeof MUSIC_GRANT_TYPES)[number];
export const MUSIC_TITLE_EVIDENCE: readonly MusicGrantType[] = ['registration', 'assignment', 'work_for_hire'];

/**
 * Register entries read from documents (`music.extract`): AI proposes each with its exact quote;
 * a person confirms (optionally correcting) or rejects. Only CONFIRMED entries join the register,
 * income and termination views and the catalog checks.
 */
export const MUSIC_ITEM_KINDS = ['SPLIT', 'GRANT', 'INCOME', 'ADVANCE_BALANCE', 'ENCUMBRANCE'] as const;
export type MusicItemKind = (typeof MUSIC_ITEM_KINDS)[number];

export interface MusicItemDefinition {
  readonly label: string;
  /** What `value` holds. */
  readonly value: 'PERCENT' | 'MONEY' | 'NONE';
  /** What `detail` holds (a writer reference, a grant type, an income source, a secured party). */
  readonly detail: string | null;
  /** What `date` holds, if anything. */
  readonly date: string | null;
  /** The register evidence type a confirmed entry stands in for, when it feeds the checks. */
  readonly evidenceType: string | null;
  /** True when the entry names the work it belongs to. */
  readonly work: boolean;
}

export const MUSIC_ITEM_REGISTRY = {
  SPLIT: { label: 'Writer split', value: 'PERCENT', detail: 'Writer reference', date: null, evidenceType: 'music.split', work: true },
  GRANT: { label: 'Grant in the chain of title', value: 'NONE', detail: 'Grant type', date: 'Executed on', evidenceType: 'music.grant', work: true },
  INCOME: { label: 'Statement income', value: 'MONEY', detail: 'Income source', date: 'Period end', evidenceType: 'music.royalty_line', work: true },
  ADVANCE_BALANCE: { label: 'Unrecouped advance balance', value: 'MONEY', detail: null, date: null, evidenceType: null, work: false },
  ENCUMBRANCE: { label: 'Lien or claim', value: 'MONEY', detail: 'Secured party or claimant', date: null, evidenceType: null, work: false },
} as const satisfies Record<MusicItemKind, MusicItemDefinition>;

export const MUSIC_ITEM_STATUSES = ['PROPOSED', 'CONFIRMED', 'REJECTED'] as const;
export type MusicItemStatus = (typeof MUSIC_ITEM_STATUSES)[number];
export const MUSIC_ITEM_ORIGINS = ['AI', 'PERSON'] as const;
export type MusicItemOrigin = (typeof MUSIC_ITEM_ORIGINS)[number];

// Thresholds, the default hold period and the termination conventions live with the arithmetic
// (`@pactlab/calculations` packs/music/catalog.ts) and are returned with every result.

export const MUSIC_GUARDRAIL =
  'Diligence support only: not legal advice. Pactlab makes no determination that title is good or that a termination notice is valid — it organises the evidence and flags gaps for the parties and their counsel.';

/** Absence is shown as absence: a missing statement period is a gap, never an estimate. */
export const MUSIC_NO_INVENTED_INCOME = 'Income comes only from statements, registries and adapters. A missing statement period is shown as a gap, never estimated.';
