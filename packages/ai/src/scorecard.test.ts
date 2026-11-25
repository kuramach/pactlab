import { describe, expect, it } from 'vitest';
import { matchesPick, SCORECARD } from './scorecard';

describe('model scorecard (docs/model-scorecard.md)', () => {
  it('covers every routing job, each with a primary or a model to evaluate', () => {
    expect(SCORECARD.map((entry) => entry.job).sort()).toEqual(['classification', 'contract_scrub', 'deep_review', 'document_qa', 'extraction', 'fast', 'vision']);
    for (const entry of SCORECARD) expect(entry.picks.some((pick) => pick.role !== 'fallback'), entry.job).toBe(true);
  });

  it("matches picks against Bedrock's ids and names, never a near miss", () => {
    const opus = { modelId: 'us.anthropic.claude-opus-5-5', name: 'Claude Opus 5.5' };
    expect(matchesPick({ name: 'Claude Opus 5.5' }, opus)).toBe(true);
    expect(matchesPick({ name: 'Claude Opus 5.5' }, { modelId: 'us.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6' })).toBe(false);
    expect(matchesPick({ name: 'Claude Haiku 5.5' }, { modelId: 'us.anthropic.claude-haiku-5-5', name: 'Claude Haiku 5.5' })).toBe(true);
    expect(matchesPick({ name: 'Gemini 3.1 Pro' }, { modelId: 'google.gemini-3-1-pro-v1:0', name: 'Gemini 3.1 Pro' })).toBe(true);
    expect(matchesPick({ name: 'Gemini 3.1 Pro' }, { modelId: 'google.gemini-3-1-flash', name: 'Gemini 3.1 Flash' })).toBe(false);
    expect(matchesPick({ name: 'GPT-5.5' }, { modelId: 'openai.gpt-5-5-v1:0', name: 'GPT-5.5' })).toBe(true);
    // A variant scores differently (scorecard: never merged).
    expect(matchesPick({ name: 'GPT-5.5' }, { modelId: 'openai.gpt-5-5-mini', name: 'GPT-5.5 mini' })).toBe(false);
    expect(matchesPick({ name: 'Claude Haiku 5.5' }, { modelId: 'anthropic.claude-haiku-5-5-20261001-v1:0', name: 'Claude Haiku 5.5' })).toBe(true);
  });
});
