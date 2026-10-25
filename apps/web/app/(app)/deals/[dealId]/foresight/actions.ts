'use server';

import { foresightQuestionSchema, foresightScenarioInputSchema, foresightVoiceQuestionSchema, updateForesightScenarioSchema, type ForesightAnswerView } from '@pactlab/contracts';
import { TREND_DIRECTIONS, TREND_MAGNITUDES } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';
import { percentToFraction } from './format';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/foresight?outcome=${outcome}`);
const failure = (kind: string, code?: string) => (code ? `error-${code}` : kind);

export async function generateBaseline(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/foresight/trend-sets`, {});
  back(dealId, result.kind === 'ok' ? 'ok-generated' : failure(result.kind, 'code' in result ? result.code : undefined));
}

/** Save a scenario from the editor: assumptions in percent, overrides per trend, one optional custom trend. */
export async function saveScenario(dealId: string, scenarioId: string | null, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || (scenarioId && !uuid.safeParse(scenarioId).success)) redirect('/deals');
  const overrides: Record<string, { direction?: string; magnitude?: string; weight?: string }> = {};
  for (const key of formData.getAll('trendKey').map(String)) {
    const direction = String(formData.get(`direction:${key}`) ?? '');
    const magnitude = String(formData.get(`magnitude:${key}`) ?? '');
    const weight = String(formData.get(`weight:${key}`) ?? '').trim();
    const override: { direction?: string; magnitude?: string; weight?: string } = {};
    if ((TREND_DIRECTIONS as readonly string[]).includes(direction)) override.direction = direction;
    if ((TREND_MAGNITUDES as readonly string[]).includes(magnitude)) override.magnitude = magnitude;
    if (weight !== '' && weight !== '1') override.weight = weight;
    if (Object.keys(override).length > 0) overrides[key] = override;
  }
  const customLabel = String(formData.get('customLabel') ?? '').trim();
  const customTrends = customLabel
    ? [
        {
          key: `custom.${customLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'trend'}`,
          label: customLabel,
          direction: String(formData.get('customDirection') ?? 'UP'),
          magnitude: String(formData.get('customMagnitude') ?? 'MEDIUM'),
          confidence: String(formData.get('customConfidence') ?? 'MEDIUM'),
          narrative: String(formData.get('customNarrative') ?? '').trim() || customLabel,
          effects: [{ lever: String(formData.get('customLever') ?? 'GROWTH'), whenUp: Number(formData.get('customSign') ?? 1) === -1 ? -1 : 1 }],
        },
      ]
    : JSON.parse(String(formData.get('keepCustomTrends') ?? '[]') || '[]');
  const body = { name: formData.get('name'), baseGrowth: percentToFraction(String(formData.get('baseGrowth') ?? '')) ?? 'invalid', baseMargin: percentToFraction(String(formData.get('baseMargin') ?? '')) ?? 'invalid', overrides, customTrends };
  const parsed = scenarioId ? updateForesightScenarioSchema.safeParse({ ...body, expectedVersion: Number(formData.get('expectedVersion')) }) : foresightScenarioInputSchema.safeParse(body);
  if (!parsed.success) return back(dealId, `invalid-${String(parsed.error.issues[0]?.path[0] ?? 'scenario')}`);
  const result = scenarioId ? await apiSend('PUT', `/v1/deals/${dealId}/foresight/scenarios/${scenarioId}`, parsed.data) : await apiPost(`/v1/deals/${dealId}/foresight/scenarios`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-scenario' : failure(result.kind, 'code' in result ? result.code : undefined));
}

export type AskOutcome = { ok: true; answer: ForesightAnswerView } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  AI_OFF: 'AI is not switched on for this environment yet.',
  AI_ACCESS: 'AI is unavailable: the AWS sign-in for this environment has expired. An operator needs to sign in again.',
  AI_THROTTLED: 'AI is busy right now. Try again in a minute.',
  AI_UNAVAILABLE: 'The model call failed. Try again in a moment.',
  UNGROUNDED_ANSWER: 'The answer did not rest on this deal’s trends or assumptions, so it was not shown. Try asking about a specific trend.',
  NO_BASELINE: 'Generate the AI baseline first.',
  VOICE_UNAVAILABLE: 'Voice is not available in this environment — type your question instead.',
  VOICE_FAILED: 'The recording could not be transcribed. Try again or type the question.',
  NOTHING_HEARD: 'Nothing was heard. Try again a little closer to the microphone.',
};

export async function askForesight(dealId: string, input: unknown): Promise<AskOutcome> {
  if (!uuid.safeParse(dealId).success) return { ok: false, message: 'Not found.' };
  const parsed = foresightQuestionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Ask a question of a few words or more.' };
  const result = await apiPost<ForesightAnswerView>(`/v1/deals/${dealId}/foresight/questions`, parsed.data);
  if (result.kind === 'ok') return { ok: true, answer: result.data };
  return { ok: false, message: MESSAGES[('code' in result && result.code) || ''] ?? 'The question could not be answered. Try again.' };
}

export async function askForesightByVoice(dealId: string, input: unknown): Promise<AskOutcome> {
  if (!uuid.safeParse(dealId).success) return { ok: false, message: 'Not found.' };
  const parsed = foresightVoiceQuestionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'The recording was too long or empty. Keep it under a minute.' };
  const result = await apiPost<ForesightAnswerView>(`/v1/deals/${dealId}/foresight/voice-questions`, parsed.data);
  if (result.kind === 'ok') return { ok: true, answer: result.data };
  return { ok: false, message: MESSAGES[('code' in result && result.code) || ''] ?? 'The question could not be answered. Try again.' };
}
