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

/** One five-year series for a metric (T-094 B10): values in percent a year, as decimal strings. */
export interface ForesightSeriesView {
  values: string[];
  version: number;
  sourceName: string | null;
  sourceUrl: string | null;
  asOf: string | null;
  rationale: string | null;
  modelId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface ForesightMetricView {
  key: string;
  label: string;
  help: string;
  /** Percent a year at which the metric neither helps nor hurts value. */
  neutral: string;
  external: ForesightSeriesView | null;
  ai: ForesightSeriesView | null;
  user: ForesightSeriesView | null;
}

export interface ForesightOutcomeView {
  /** Year 0 is today; value rounded to three significant figures. */
  path: { year: number; calendarYear: number; value: string }[];
  drivers: { key: string; label: string; year5Change: string }[];
  /** Which series each metric used in this set, e.g. "AI forecast" or "Published (IMF)". */
  basis: { key: string; used: 'AI' | 'EXTERNAL' | 'USER' | 'NEUTRAL' }[];
}

export interface ForesightForecastsView {
  /** NONE until the first refresh starts; the tab never waits on it. */
  status: 'NONE' | 'RUNNING' | 'READY' | 'PARTIAL' | 'FAILED';
  notes: string[];
  refreshedAt: string | null;
  years: number[];
  /** IMF area the published forecasts are for (USA, EURO, GBR), or null. */
  area: string | null;
  metrics: ForesightMetricView[];
  outcomes: {
    currency: string;
    startValue: string;
    startValueSource: string;
    baseGrowth: string;
    engineVersion: string;
    /** Published + AI forecasts (AI where it exists, else the published series). */
    reference: ForesightOutcomeView;
    /** The user's forecasts where entered, the reference set elsewhere. */
    user: ForesightOutcomeView;
  } | null;
}

/** The user's own five-year path for one metric (percent a year). */
export const foresightUserForecastSchema = z.strictObject({
  metricKey: z.string().trim().min(1).max(80),
  values: z.array(z.string().trim().regex(/^-?\d{1,3}(\.\d{1,2})?$/, 'A percent such as 2.5 or -1')).length(5),
});
export type ForesightUserForecastInput = z.infer<typeof foresightUserForecastSchema>;

export interface ForesightView {
  baseline: { id: string; asOf: string; modelId: string; promptVersion: string } | null;
  forecasts: ForesightForecastsView;
  lines: ForesightLineView[];
  /**
   * The cited enforcement-climate entries (T-091 posture signals) behind the
   * government-posture trend — one record, shared with the regulatory screen.
   * Evidence for the person forecasting; it never moves a line by itself.
   */
  posture: {
    trendKey: 'macro.regulation';
    summary: { signals: number; tightening: number; holding: number; loosening: number; latest: string | null; lean: 'TIGHTENING' | 'HOLDING' | 'LOOSENING' | 'MIXED' | null };
    signals: { id: string; date: string; authority: string; scope: 'GUIDELINES' | 'COMPARABLE_CASE' | 'SECTOR_SIGNAL'; direction: 'TIGHTENING' | 'HOLDING' | 'LOOSENING'; signal: string; citation: { documentId: string; pageNumber: number } }[];
  };
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
