/**
 * The language an AI job writes its prose in (T-174, ADR 0067). The caller asks for a target
 * language as an explicit job parameter; the gateway writes in it only on a model evaluated in
 * that language (ADR 0034: an evaluation passed in English does not bless another language).
 * Otherwise the output is written in the model's evaluated default and labelled as such: never a
 * silent switch. JSON keys, enums, quotes and figures are never translated: a quote must match its
 * page exactly.
 */
export const AI_OUTPUT_LANGUAGES = ['en', 'de', 'fr', 'ja'] as const;
export type AiOutputLanguage = (typeof AI_OUTPUT_LANGUAGES)[number];

/** The language every serving model is evaluated in today: the golden set and injection probes are English. */
export const EVALUATED_DEFAULT_LANGUAGE: AiOutputLanguage = 'en';

const LANGUAGE_NAMES: Readonly<Record<AiOutputLanguage, string>> = { en: 'English', de: 'German', fr: 'French', ja: 'Japanese' };

/**
 * Which languages each serving model has passed its evaluation in, by model ID. A model not listed
 * is evaluated in English only. Kept in step with docs/runbooks/ai-models.md ("Languages"); an
 * entry is added only with the evaluation run that justifies it.
 */
export const MODEL_LANGUAGE_EVALUATIONS: Readonly<Record<string, readonly AiOutputLanguage[]>> = {};

export function evaluatedLanguagesOf(modelId: string, evaluations: Readonly<Record<string, readonly AiOutputLanguage[]>> = MODEL_LANGUAGE_EVALUATIONS): readonly AiOutputLanguage[] {
  const listed = evaluations[modelId] ?? [];
  return listed.includes(EVALUATED_DEFAULT_LANGUAGE) ? listed : [EVALUATED_DEFAULT_LANGUAGE, ...listed];
}

/** What a run recorded about its language: what was asked, what was written, and why they differ. */
export interface OutputLanguageRecord {
  readonly requested: AiOutputLanguage;
  readonly written: AiOutputLanguage;
  /** True when the model is not evaluated in the requested language and wrote its evaluated default. */
  readonly fallback: boolean;
  /** The label a reader sees beside the output when it fell back; null otherwise. */
  readonly label: string | null;
}

export function resolveOutputLanguage(requested: AiOutputLanguage, evaluated: readonly AiOutputLanguage[]): OutputLanguageRecord {
  if (evaluated.includes(requested)) return { requested, written: requested, fallback: false, label: null };
  const written = evaluated.includes(EVALUATED_DEFAULT_LANGUAGE) ? EVALUATED_DEFAULT_LANGUAGE : (evaluated[0] ?? EVALUATED_DEFAULT_LANGUAGE);
  return {
    requested,
    written,
    fallback: true,
    label: `Written in ${LANGUAGE_NAMES[written]}: this model is not yet evaluated in ${LANGUAGE_NAMES[requested]}.`,
  };
}

/** The instruction added to a prompt's system text when it writes in a language other than English. */
export function withOutputLanguage(system: string, language: AiOutputLanguage): string {
  if (language === EVALUATED_DEFAULT_LANGUAGE) return system;
  return `${system}\n\nWrite every free-text field for the reader in ${LANGUAGE_NAMES[language]}. Keep JSON keys, enum values, identifiers, figures and quotes exactly as given: a quote must match its source text character for character.`;
}
