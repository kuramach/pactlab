import { TREND_CONFIDENCES, TREND_DIRECTIONS, TREND_MAGNITUDES, VALUE_LEVERS } from '@pactlab/domain';
import { z } from 'zod';

const fraction = z.preprocess((value) => (typeof value === 'string' ? value.trim() : value), z.string().regex(/^-?\d(\.\d{1,6})?$/, 'A fraction such as 0.12 (12 %)'));
const weight = z.string().regex(/^(0|1|2)(\.\d{1,2})?$/, 'A weight from 0 to 2').refine((value) => Number(value) <= 2, 'A weight from 0 to 2');

/** One override of a baseline trend in a user's scenario; the baseline itself never changes. */
const overrideSchema = z.strictObject({
  direction: z.enum(TREND_DIRECTIONS).optional(),
  magnitude: z.enum(TREND_MAGNITUDES).optional(),
  weight: weight.optional(),
});

const customTrendSchema = z.strictObject({
  key: z.string().regex(/^custom\.[a-z0-9_-]{2,40}$/, 'Keys look like custom.rates_stay_high'),
  label: z.string().trim().min(3).max(120),
  direction: z.enum(TREND_DIRECTIONS),
  magnitude: z.enum(TREND_MAGNITUDES),
  confidence: z.enum(TREND_CONFIDENCES),
  narrative: z.string().trim().min(3).max(800),
  effects: z.array(z.strictObject({ lever: z.enum(VALUE_LEVERS), whenUp: z.union([z.literal(1), z.literal(-1)]) })).min(1).max(4),
  weight: weight.default('1'),
});

export const foresightScenarioInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  baseGrowth: fraction.refine((value) => Number(value) > -0.5 && Number(value) < 2, 'Growth between −50 % and 200 %'),
  baseMargin: fraction.refine((value) => Number(value) > 0 && Number(value) < 1, 'Margin between 0 % and 100 %'),
  overrides: z.record(z.string().min(1).max(80), overrideSchema).default({}),
  customTrends: z.array(customTrendSchema).max(10).default([]),
});
export type ForesightScenarioInput = z.infer<typeof foresightScenarioInputSchema>;
export const updateForesightScenarioSchema = foresightScenarioInputSchema.extend({ expectedVersion: z.number().int().min(1) });
export type UpdateForesightScenarioInput = z.infer<typeof updateForesightScenarioSchema>;

export const foresightQuestionSchema = z.strictObject({
  question: z.string().trim().min(3).max(1000),
  scenarioId: z.uuid().nullable().default(null),
  speak: z.boolean().default(false),
});
export type ForesightQuestionInput = z.infer<typeof foresightQuestionSchema>;

/** A spoken question: 16-bit mono PCM, base64, up to about a minute at 16 kHz. */
export const foresightVoiceQuestionSchema = z.strictObject({
  audio: z.string().max(3_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  sampleRate: z.union([z.literal(8000), z.literal(16000), z.literal(44100), z.literal(48000)]),
  scenarioId: z.uuid().nullable().default(null),
  speak: z.boolean().default(false),
});
export type ForesightVoiceQuestionInput = z.infer<typeof foresightVoiceQuestionSchema>;

export const foresightScenarioParamsSchema = z.strictObject({ dealId: z.uuid(), scenarioId: z.uuid() });

export interface ForesightTrendView {
  key: string;
  label: string;
  category: 'MACRO' | 'SECTOR' | 'CUSTOM';
  direction: (typeof TREND_DIRECTIONS)[number];
  magnitude: (typeof TREND_MAGNITUDES)[number];
  confidence: (typeof TREND_CONFIDENCES)[number];
  narrative: string;
  provenance: 'AI' | 'USER';
  /** True when a scenario changed an AI trend (it then shows as the user's). */
  adjusted: boolean;
  weight: string;
  effects: { lever: (typeof VALUE_LEVERS)[number]; whenUp: 1 | -1 }[];
}

export interface ForesightProjectionView {
  engineVersion: string;
  currency: string;
  assumptions: { startValue: string; startValueSource: string; baseGrowth: string; baseMargin: string; rateToMultiple: string };
  impacts: { trendKey: string; trendLabel: string; provenance: 'AI' | 'USER'; lever: string; change: string; explanation: string }[];
  path: { year: number; low: string; base: string; high: string }[];
  sensitivity: { trendKey: string; trendLabel: string; year5Change: string }[];
}

export interface ForesightLineView {
  id: string | null;
  name: string;
  kind: 'BASELINE' | 'SCENARIO';
  version: number | null;
  baseGrowth: string;
  baseMargin: string;
  trends: ForesightTrendView[];
  overrides: Record<string, { direction?: string; magnitude?: string; weight?: string }>;
  customTrends: z.infer<typeof customTrendSchema>[];
  projection: ForesightProjectionView | null;
}

export interface ForesightView {
  baseline: { id: string; asOf: string; modelId: string; promptVersion: string } | null;
  lines: ForesightLineView[];
  /** Why there is no projection yet (no valuation run and no asking price). */
  projectionUnavailable: string | null;
  questions: { id: string; via: 'TEXT' | 'VOICE'; question: string; answer: string; reliesOn: string[]; askedAt: string; scenarioName: string | null }[];
  canEdit: boolean;
  ai: { enabled: boolean };
  voice: { speechToText: boolean; textToSpeech: boolean };
}

export interface ForesightAnswerView {
  id: string;
  question: string;
  answer: string;
  reliesOn: string[];
  /** MP3 of the answer, base64, when a spoken reply was asked for and voice is available. */
  audio: string | null;
}
