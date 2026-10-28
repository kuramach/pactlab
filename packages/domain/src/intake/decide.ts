import type { PackDefinition } from '../packs/registry';
import { categoriesForPack, categoryDefinition, type IntakeCategory, type IntakeRoute } from './categories';

/**
 * Where a file stands in intake.
 * - UNCLASSIFIED: arrived before intake existed, or classification has not run.
 * - FILED: its category is settled, by the AI (clear) or by a person.
 * - NEEDS_YOU: the AI was unsure and asked a person.
 * - NOT_READ: the file may not be sent to AI (excluded or prohibited data);
 *   a person files it.
 */
export const INTAKE_STATES = ['UNCLASSIFIED', 'FILED', 'NEEDS_YOU', 'NOT_READ'] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

export const CATEGORY_SOURCES = ['AI', 'PERSON'] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

/**
 * The confidence a category needs before the AI files it alone, by route.
 * Files that feed numbers need more certainty than files kept for reading.
 * Tuned against the demo-data scenarios (ADR 0016); recorded with the prompt version.
 */
export const AUTO_FILE_CONFIDENCE: Readonly<Record<IntakeRoute['kind'], number>> = {
  IMPORT: 0.9,
  BALANCE_SHEET: 0.9,
  EXTRACT: 0.8,
  FILE: 0.75,
};

/** A runner-up this close to the top choice means the AI cannot tell them apart. */
export const AMBIGUITY_MARGIN = 0.15;

export interface ClassificationProposal {
  /** As the model returned it; may not be a category offered for this pack. */
  readonly category: string;
  readonly confidence: number;
  readonly alternatives: readonly { readonly category: string; readonly confidence: number }[];
  /** The model's own question for a person, when it has one. */
  readonly question: string | null;
}

export type IntakeDecision =
  | { readonly state: 'FILED'; readonly category: IntakeCategory }
  | {
      readonly state: 'NEEDS_YOU';
      /** The best guess shown to the person, when it is a valid category. */
      readonly category: IntakeCategory | null;
      readonly question: string;
    };

/** "a balance sheet", "an income statement (P&L)". */
function named(category: string): string {
  const text = categoryDefinition(category as IntakeCategory).label;
  const lower = /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
  return `${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower}`;
}

/**
 * Clear → filed; unclear → ask. Deterministic over the model's proposal, so
 * the rule is code under test, not model prose.
 */
export function decideIntake(pack: PackDefinition, proposal: ClassificationProposal): IntakeDecision {
  const offered = new Set<string>(categoriesForPack(pack).map((category) => category.id));
  if (!offered.has(proposal.category)) {
    return { state: 'NEEDS_YOU', category: null, question: proposal.question ?? 'What is this file?' };
  }
  const category = proposal.category as IntakeCategory;
  const route = categoryDefinition(category).route.kind;
  const runnerUp = proposal.alternatives
    .filter((alternative) => alternative.category !== category && offered.has(alternative.category))
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (runnerUp && proposal.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) {
    return {
      state: 'NEEDS_YOU',
      category,
      question: proposal.question ?? `Is this ${named(category)} or ${named(runnerUp.category)}?`,
    };
  }
  if (proposal.confidence < AUTO_FILE_CONFIDENCE[route]) {
    return {
      state: 'NEEDS_YOU',
      category,
      question: proposal.question ?? `Is this ${named(category)}?`,
    };
  }
  if (proposal.question) return { state: 'NEEDS_YOU', category, question: proposal.question };
  return { state: 'FILED', category };
}
